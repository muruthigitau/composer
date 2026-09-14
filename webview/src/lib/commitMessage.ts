/**
 * Commit-message helpers shared by the webview components.
 *
 * These mirror the extension-host rules so the editor input can never produce
 * a duplicated type prefix such as `feat: feat: ...`.
 */

/** Conventional commit types accepted by the composer. */
export const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "style",
  "test",
  "chore",
  "perf",
  "ci",
  "build",
  "revert",
] as const;

/** A parsed conventional-commit subject. */
export interface ParsedTypeSubject {
  type: string;
  scope?: string;
  subject: string;
}

/** Normalize a raw type string to a supported type (falls back to chore). */
export function normalizeCommitType(type: string): string {
  const lower = (type || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return (COMMIT_TYPES as readonly string[]).includes(lower) ? lower : "chore";
}

/**
 * Split an editor value into its type, scope and description.
 *
 * Accepts `feat: x`, `feat(scope): x`, `feat - x` and repeated prefixes such as
 * `feat: feat(theme): x`.
 */
export function parseTypeSubject(value: string): ParsedTypeSubject {
  let remaining = (value || "").trim();
  let type = "chore";
  let scope: string | undefined;

  const prefix =
    /^([A-Za-z]+)\s*(?:\(([^()]*)\)\s*)?!?\s*[:\u2013\u2014-]\s*([\s\S]*)$/;
  for (let guard = 0; guard < 4; guard++) {
    const match = remaining.match(prefix);
    if (!match) {
      break;
    }
    const candidate = match[1].toLowerCase();
    if (!(COMMIT_TYPES as readonly string[]).includes(candidate)) {
      break;
    }
    type = candidate;
    scope = scope ?? (match[2] ? match[2].trim() : undefined);
    remaining = match[3].trim();
  }

  return {
    type,
    scope,
    subject: remaining
      .replace(/^[:\-]\s*/, "")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

/** Render the editor value for a type/scope/subject triple. */
export function formatTypeSubject(
  type: string,
  subject: string,
  scope?: string,
): string {
  const resolvedType = normalizeCommitType(type);
  const cleanedScope = (scope || "").trim();
  return `${resolvedType}${cleanedScope ? `(${cleanedScope})` : ""}: ${(subject || "").trim()}`;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Return a diff containing only the requested hunks of a file diff.
 *
 * Used so the diff viewer shows exactly what the selected commit will contain.
 */
export function filterDiffToHunks(diffText: string, hunkIndices: number[]): string {
  if (!diffText) {
    return diffText;
  }

  const wanted = new Set(hunkIndices || []);
  const lines = diffText.split("\n");
  const out: string[] = [];
  let include = false;
  let hunkIndex = -1;

  for (const line of lines) {
    if (HUNK_HEADER.test(line)) {
      hunkIndex += 1;
      include = wanted.has(hunkIndex);
    }
    if (include) {
      out.push(line);
    }
  }

  return include || out.length > 0 ? out.join("\n") : diffText;
}
