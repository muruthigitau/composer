/**
 * Tolerant extraction of a commit plan from model output.
 *
 * Real providers are inconsistent: they wrap JSON in prose, emit one object per
 * line, return a bare commit object instead of `{"commits": [...]}`, wrap the
 * plan in `{"plan": {...}}`, truncate the tail when they run out of output
 * tokens, or leak chain-of-thought text before the answer.
 *
 * This module recovers whatever usable commit objects the response contains
 * instead of failing the whole generation, which is what makes plan generation
 * reliable across a wide range of models.
 */

import { Change, CommitGroup } from "../types/messages";

/** True when an object has the shape of a commit group. */
function looksLikeCommit(value: Record<string, unknown>): boolean {
  const hasSubject = typeof value.subject === "string" && value.subject.trim().length > 0;
  const hasType = typeof value.type === "string";
  const hasChanges =
    Array.isArray(value.changes) || Array.isArray(value.hunks) || Array.isArray(value.files);
  return hasSubject || (hasType && hasChanges);
}

/**
 * Find every balanced JSON value (`{...}` / `[...]`) in arbitrary text.
 *
 * The scan is string-aware, so braces inside strings do not confuse it. When
 * the text ends mid-value the remainder is returned so it can be repaired.
 */
export function scanJsonValues(text: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char !== "{" && char !== "[") {
      continue;
    }
    const end = findBalancedEnd(text, index);
    if (end === -1) {
      values.push(text.slice(index));
      break;
    }
    values.push(text.slice(index, end + 1));
    index = end;
  }

  return values;
}

/** Index of the closing bracket that balances the one at `start`, or -1. */
function findBalancedEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === "}" || char === "]") {
      const expected = stack.pop();
      if (expected !== char) {
        return index;
      }
      if (stack.length === 0) {
        return index;
      }
    }
  }

  return -1;
}

/** Remove trailing commas before `}` / `]` (a common model mistake). */
function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, "$1");
}

/** Close unterminated strings/brackets so a truncated value can still parse. */
function closeTruncated(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if ((char === "}" || char === "]") && stack.length > 0) stack.pop();
  }

  let repaired = text;
  if (inString) {
    repaired += '"';
  }
  repaired = repaired.replace(/,\s*$/, "");
  while (stack.length > 0) {
    repaired += stack.pop();
  }
  return repaired;
}

/** Parse one candidate, applying repairs when needed. */
function tryParse(candidate: string): unknown {
  for (const attempt of [candidate, stripTrailingCommas(candidate), closeTruncated(candidate)]) {
    try {
      return JSON.parse(attempt);
    } catch {
      // Try the next repair strategy.
    }
  }
  return undefined;
}

/** Collect commit groups from any nested shape the model produced. */
function collectCommits(value: unknown, out: CommitGroup[], depth = 0): void {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectCommits(item, out, depth + 1));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.commits)) {
    collectCommits(record.commits, out, depth + 1);
    return;
  }
  if (record.plan !== undefined) {
    collectCommits(record.plan, out, depth + 1);
    return;
  }
  if (looksLikeCommit(record)) {
    out.push(coerceCommit(record));
    return;
  }

  // Keyed maps such as {"commit1": {...}} are only unwrapped when they contain
  // nothing commit-like themselves.
  const nested = Object.values(record).filter(
    (entry) => entry !== null && typeof entry === "object"
  );
  if (nested.length > 0 && nested.length <= 50) {
    nested.forEach((entry) => collectCommits(entry, out, depth + 1));
  }
}

/** Normalize a raw commit object into the internal shape. */
function coerceCommit(record: Record<string, unknown>): CommitGroup {
  const rawChanges = Array.isArray(record.changes)
    ? record.changes
    : Array.isArray(record.files)
      ? record.files
      : [];

  const changes: Change[] = rawChanges
    .map((entry) => {
      if (typeof entry === "string") {
        return { file: entry, hunks: [] };
      }
      const change = (entry ?? {}) as Record<string, unknown>;
      const rawHunks = Array.isArray(change.hunks) ? change.hunks : [];
      return {
        file: String(change.file ?? change.path ?? ""),
        hunks: rawHunks.map(Number).filter((hunk) => Number.isFinite(hunk))
      };
    })
    .filter((change) => change.file.length > 0);

  return {
    id: record.id !== undefined ? String(record.id) : "",
    type: String(record.type ?? ""),
    scope: record.scope !== undefined ? String(record.scope) : undefined,
    breaking: record.breaking === true,
    subject: String(record.subject ?? ""),
    body: Array.isArray(record.body) ? record.body.map(String) : [],
    changes,
    reasoning: record.reasoning ? String(record.reasoning) : undefined,
    overview: record.overview ? String(record.overview) : undefined
  };
}

/** Remove duplicate commits (same type + subject) while preserving order. */
function dedupeCommits(commits: CommitGroup[]): CommitGroup[] {
  const seen = new Set<string>();
  const result: CommitGroup[] = [];

  for (const commit of commits) {
    const key = `${commit.type.toLowerCase()}|${commit.subject.trim().toLowerCase()}`;
    if (commit.subject.trim().length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(commit);
  }

  return result;
}

/** True when a parsed value is shaped like (possibly empty) plan output. */
function isPlanShaped(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0 || value.some((item) => isPlanShaped(item));
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.commits) || record.plan !== undefined) {
    return true;
  }
  return looksLikeCommit(record);
}

/**
 * Extract a commit plan from a raw model response.
 *
 * @param rawResponse Raw text returned by the provider.
 * @returns `found` when the reply contained plan-shaped JSON (even if empty),
 *   plus the recovered commit groups.
 */
export function extractPlan(rawResponse: string): { found: boolean; commits: CommitGroup[] } {
  const text = String(rawResponse ?? "");
  if (!text.trim()) {
    return { found: false, commits: [] };
  }

  // Drop code fences without destroying the payload inside them.
  const unfenced = text.replace(/```(?:json|jsonl)?\s*([\s\S]*?)```/g, "$1");
  const commits: CommitGroup[] = [];
  let found = false;

  for (const candidate of scanJsonValues(unfenced)) {
    const parsed = tryParse(candidate);
    if (parsed === undefined) {
      continue;
    }
    if (isPlanShaped(parsed)) {
      found = true;
    }
    collectCommits(parsed, commits);
  }

  return { found, commits: dedupeCommits(commits) };
}

/** Every parsed JSON value found in arbitrary model text. */
export function extractJsonValues(rawResponse: string): unknown[] {
  const text = String(rawResponse ?? "");
  if (!text.trim()) {
    return [];
  }

  const unfenced = text.replace(/```(?:json|jsonl)?\s*([\s\S]*?)```/g, "$1");
  const values: unknown[] = [];

  for (const candidate of scanJsonValues(unfenced)) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) {
      values.push(parsed);
    }
  }

  return values;
}

/**
 * Find a JSON object that contains at least one of the given keys.
 *
 * Used for non-plan payloads (PR title/description) where the model may wrap
 * the answer in prose or a code fence.
 *
 * @param rawResponse Raw model text.
 * @param keys Keys that must be present on the returned object.
 */
export function extractJsonObjectWithKeys(
  rawResponse: string,
  keys: string[]
): Record<string, unknown> | undefined {
  for (const value of extractJsonValues(rawResponse)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const record = value as Record<string, unknown>;
    if (keys.some((key) => record[key] !== undefined)) {
      return record;
    }
  }
  return undefined;
}

/**
 * Extract commit groups from a raw model response.
 *
 * @param rawResponse Raw text returned by the provider.
 * @returns The recovered commit groups (possibly empty).
 */
export function extractCommitGroups(rawResponse: string): CommitGroup[] {
  return extractPlan(rawResponse).commits;
}

