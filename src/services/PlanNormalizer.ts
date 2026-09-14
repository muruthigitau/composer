/**
 * Commit-plan validation and repair.
 *
 * The AI plan is a *proposal*: it can reference files that are not staged,
 * hunk indices that do not exist, or forget some hunks entirely. This module
 * turns that proposal into a plan that is guaranteed to be executable:
 *
 *  - every referenced file exists in the staged diff (paths are resolved),
 *  - every hunk is assigned to exactly one commit (no duplicates),
 *  - no staged hunk is left unreferenced (leftovers are merged in),
 *  - no commit is left with zero files.
 *
 * There is no limit on the number of commits.
 *
 * The normalizer is pure (no VS Code / AI dependencies) so it can be tested
 * against real diff fixtures.
 */

import { Change, CommitGroup, CommitPlan } from "../types/messages";
import { ParsedFileDiff, resolvePath } from "./DiffParser";
import { normalizeType, parseSubject } from "./CommitMessage";

/** Outcome of normalizing a proposed plan. */
export interface PlanNormalizationResult {
  /** A plan that can be applied to the staged changes without leftovers. */
  plan: CommitPlan;
  /** Human-readable notes about anything the normalizer had to repair. */
  warnings: string[];
  /** Total number of hunks in the staged diff. */
  totalHunks: number;
  /** Number of hunks covered by the returned plan. */
  coveredHunks: number;
}

interface WorkingCommit {
  group: CommitGroup;
  changes: Change[];
  files: Set<string>;
}

/** Longest shared directory prefix length between two paths. */
function sharedPrefixLength(a: string, b: string): number {
  const left = a.split("/").slice(0, -1);
  const right = b.split("/").slice(0, -1);
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) {
    shared++;
  }
  return shared;
}

/** Normalize the type/subject/body of a commit group. */
function normalizeGroup(group: CommitGroup, index: number): CommitGroup {
  const parsed = parseSubject(group.subject || group.overview || "");
  const type = normalizeType(group.type || parsed.type || "chore");
  const subject = parsed.subject || "update staged changes";
  const body = Array.isArray(group.body) ? group.body.map(String).filter((line) => line.trim()) : [];
  const scope = normalizeScope(group.scope) ?? parsed.scope;
  const breaking = Boolean(group.breaking) || parsed.breaking;

  return {
    ...group,
    id: group.id || String(index + 1),
    type,
    scope,
    breaking: breaking || undefined,
    subject,
    body: body.length > 0 ? body : group.overview ? [group.overview] : ["Update staged changes."]
  };
}

/** Sanitize a conventional-commit scope, returning undefined when unusable. */
function normalizeScope(scope: string | undefined): string | undefined {
  const cleaned = String(scope ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}


/**
 * Normalize a proposed commit plan against the real staged diff.
 *
 * @param proposed Plan returned by the AI provider.
 * @param files Parsed staged diff (`git diff --cached --binary`).
 */
export function normalizePlan(proposed: CommitPlan, files: ParsedFileDiff[]): PlanNormalizationResult {
  const warnings: string[] = [];
  const candidates = files.map((file) => file.path);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const claimedHunks = new Map<string, Set<number>>();
  const claimedBinary = new Set<string>();
  const totalHunks = files.reduce((total, file) => total + file.hunks.length, 0);

  let invalidRefs = 0;

  const working: WorkingCommit[] = (proposed.commits || []).map((rawGroup, index) => {
    const group = normalizeGroup(rawGroup, index);
    const changesByPath = new Map<string, number[]>();

    for (const change of group.changes || []) {
      const path = resolvePath(change.file, candidates);
      const file = path ? byPath.get(path) : undefined;
      if (!file) {
        invalidRefs++;
        continue;
      }

      if (file.isBinary) {
        // Binary contents cannot be split by hunk: the whole file moves.
        claimedBinary.add(file.path);
        changesByPath.set(file.path, []);
        continue;
      }

      const fileClaims = claimedHunks.get(file.path) ?? new Set<number>();
      const valid: number[] = [];
      for (const rawIndex of Array.isArray(change.hunks) ? change.hunks : []) {
        const hunkIndex = Number(rawIndex);
        if (!Number.isInteger(hunkIndex) || hunkIndex < 0 || hunkIndex >= file.hunks.length) {
          invalidRefs++;
          continue;
        }
        if (fileClaims.has(hunkIndex)) {
          continue;
        }
        fileClaims.add(hunkIndex);
        valid.push(hunkIndex);
      }
      claimedHunks.set(file.path, fileClaims);

      if (valid.length > 0) {
        const existing = changesByPath.get(file.path) ?? [];
        changesByPath.set(file.path, [...existing, ...valid]);
      }
    }

    const changes: Change[] = [...changesByPath.entries()].map(([file, hunks]) => ({
      file,
      hunks: [...new Set(hunks)].sort((a, b) => a - b)
    }));

    return { group, changes, files: new Set(changes.map((change) => change.file)) };
  });

  if (invalidRefs > 0) {
    warnings.push(
      `${invalidRefs} hunk/file reference(s) in the AI plan were invalid and were dropped.`
    );
  }

  const active = working.filter((commit) => commit.changes.length > 0);
  const droppedCommits = working.length - active.length;
  if (droppedCommits > 0) {
    warnings.push(`${droppedCommits} commit(s) with no valid staged hunks were removed from the plan.`);
  }

  // ── Coverage: every staged hunk must land in exactly one commit ──
  const coverage = coverUnreferencedChanges(files, active, claimedHunks, claimedBinary);
  if (coverage.recovered > 0) {
    warnings.push(
      `${coverage.recovered} staged file(s) that the AI plan did not reference were added to commits.`
    );
  }
  if (coverage.addedFallbackCommit) {
    warnings.push("A fallback commit was created for staged changes the plan did not cover.");
  }

  const commits: CommitGroup[] = active.map((commit, index) => ({
    ...commit.group,
    id: String(index + 1),
    changes: commit.changes
  }));

  const coveredHunks = commits.reduce(
    (total, group) => total + group.changes.reduce((sum, change) => sum + change.hunks.length, 0),
    0
  );

  return { plan: { commits }, warnings, totalHunks, coveredHunks };
}

/** Create a fallback commit for changes the AI plan did not cover. */
function ensureFallbackCommit(active: WorkingCommit[]): WorkingCommit {
  const fallback: WorkingCommit = {
    group: {
      id: String(active.length + 1),
      type: "chore",
      subject: "include remaining staged changes",
      body: ["Include staged changes that the generated plan did not cover."],
      changes: []
    },
    changes: [],
    files: new Set<string>()
  };
  active.push(fallback);
  return fallback;
}

/** Add a change to a working commit, merging hunk indices when needed. */
function addChange(target: WorkingCommit, path: string, hunks: number[]): void {
  const existing = target.changes.find((change) => change.file === path);
  if (existing) {
    existing.hunks = [...new Set([...existing.hunks, ...hunks])].sort((a, b) => a - b);
  } else {
    target.changes.push({ file: path, hunks: [...hunks].sort((a, b) => a - b) });
  }
  target.files.add(path);
}

/**
 * Assign every staged hunk that no commit claimed to a sensible commit.
 *
 * @returns Number of files recovered and whether a fallback commit was created.
 */
function coverUnreferencedChanges(
  files: ParsedFileDiff[],
  active: WorkingCommit[],
  claimedHunks: Map<string, Set<number>>,
  claimedBinary: Set<string>
): { recovered: number; addedFallbackCommit: boolean } {
  let recovered = 0;
  let addedFallbackCommit = false;

  for (const file of files) {
    let unclaimed: number[];
    if (file.isBinary) {
      unclaimed = claimedBinary.has(file.path) ? [] : [-1];
    } else {
      const claims = claimedHunks.get(file.path) ?? new Set<number>();
      unclaimed = file.hunks.map((hunk) => hunk.index).filter((index) => !claims.has(index));
    }

    if (unclaimed.length === 0) {
      continue;
    }

    // Prefer a commit that already touches this file, then the commit with the
    // most similar path, then the newest commit, and finally a fallback.
    let target = active.find((commit) => commit.files.has(file.path));
    if (!target) {
      let best = -1;
      for (const commit of active) {
        for (const path of commit.files) {
          const score = sharedPrefixLength(path, file.path);
          if (score > best) {
            best = score;
            target = commit;
          }
        }
      }
    }
    if (!target) {
      target = active[active.length - 1];
    }
    if (!target) {
      target = ensureFallbackCommit(active);
      addedFallbackCommit = true;
    }

    addChange(target, file.path, unclaimed);

    if (file.isBinary) {
      claimedBinary.add(file.path);
    } else {
      const claims = claimedHunks.get(file.path) ?? new Set<number>();
      unclaimed.forEach((index) => claims.add(index));
      claimedHunks.set(file.path, claims);
    }
    recovered++;
  }

  return { recovered, addedFallbackCommit };
}