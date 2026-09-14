/**
 * Tests for commit-plan normalization: full hunk coverage, no duplicate hunk
 * assignment, no empty commits and the maxCommits limit.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CommitPlan } from "../src/types/messages";
import { parseUnifiedDiff } from "../src/services/DiffParser";
import { normalizePlan } from "../src/services/PlanNormalizer";

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 line one
+line added
 line three
@@ -20,3 +21,3 @@
 context
-old value
+new value
 context
diff --git a/docs/readme.md b/docs/readme.md
index 3333333..4444444 100644
--- a/docs/readme.md
+++ b/docs/readme.md
@@ -1,2 +1,3 @@
+# Title
+
 Intro
`;

/** Build an AI plan from a compact commit description. */
function plan(
  commits: Array<{
    id: string;
    type: string;
    subject: string;
    changes: Array<{ file: string; hunks: number[] }>;
    body?: string[];
  }>
): CommitPlan {
  return {
    commits: commits.map((commit) => ({
      ...commit,
      body: commit.body || ["Summary paragraph.", "- bullet"]
    }))
  };
}

test("normalizePlan keeps a valid plan unchanged", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "1", type: "feat", subject: "feat: add a line", changes: [{ file: "src/app.ts", hunks: [0] }] },
      { id: "2", type: "fix", subject: "fix: update value", changes: [{ file: "src/app.ts", hunks: [1] }] },
      { id: "3", type: "docs", subject: "docs: add title", changes: [{ file: "docs/readme.md", hunks: [0] }] }
    ]),
    files
  );

  assert.equal(result.plan.commits.length, 3);
  assert.equal(result.coveredHunks, 3);
  assert.equal(result.totalHunks, 3);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.plan.commits[0].subject, "add a line");
  assert.equal(result.plan.commits[0].type, "feat");
});

test("normalizePlan adds unreferenced files to existing commits", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "1", type: "feat", subject: "add a line", changes: [{ file: "src/app.ts", hunks: [0] }] }
    ]),
    files
  );

  const covered = result.plan.commits.flatMap((commit) =>
    commit.changes.flatMap((change) => change.hunks.map((hunk) => `${change.file}#${hunk}`))
  );
  assert.deepEqual(covered.sort(), ["docs/readme.md#0", "src/app.ts#0", "src/app.ts#1"]);
  assert.equal(result.coveredHunks, 3);
  assert.ok(result.warnings.some((warning) => warning.includes("were added to commits")));
});

test("normalizePlan assigns hunks the AI never mentioned", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "1", type: "feat", subject: "add a line", changes: [{ file: "src/app.ts", hunks: [0] }] },
      { id: "2", type: "docs", subject: "update docs", changes: [{ file: "docs/readme.md", hunks: [0] }] }
    ]),
    files
  );

  const appCommit = result.plan.commits.find((commit) => commit.subject === "add a line");
  assert.ok(appCommit);
  assert.deepEqual(appCommit?.changes[0].hunks, [0, 1]);
  assert.equal(result.coveredHunks, 3);
});

test("normalizePlan never assigns the same hunk to two commits", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "1", type: "feat", subject: "first", changes: [{ file: "src/app.ts", hunks: [0, 1] }] },
      { id: "2", type: "fix", subject: "second", changes: [{ file: "src/app.ts", hunks: [1] }] }
    ]),
    files
  );

  const seen = new Set<string>();
  for (const commit of result.plan.commits) {
    for (const change of commit.changes) {
      for (const hunk of change.hunks) {
        const key = `${change.file}#${hunk}`;
        assert.ok(!seen.has(key), `hunk ${key} assigned twice`);
        seen.add(key);
      }
    }
  }
});

test("normalizePlan drops commits with no valid hunks", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "1", type: "feat", subject: "real", changes: [{ file: "src/app.ts", hunks: [0] }] },
      { id: "2", type: "fix", subject: "ghost", changes: [{ file: "src/app.ts", hunks: [99] }] }
    ]),
    files
  );

  assert.equal(result.plan.commits.length, 1);
  assert.equal(result.plan.commits[0].subject, "real");
  assert.ok(result.warnings.length > 0);
});

test("normalizePlan resolves AI paths that do not match exactly", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "1", type: "feat", subject: "prefixed", changes: [{ file: "b/src/app.ts", hunks: [0] }] },
      { id: "2", type: "docs", subject: "suffixed", changes: [{ file: "./docs/readme.md", hunks: [0] }] }
    ]),
    files
  );

  assert.equal(result.plan.commits.length, 2);
  assert.equal(result.plan.commits[0].changes[0].file, "src/app.ts");
  assert.equal(result.plan.commits[1].changes[0].file, "docs/readme.md");
});

test("normalizePlan creates a fallback commit when the AI returns nothing", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan({ commits: [] }, files);

  assert.equal(result.plan.commits.length, 1);
  assert.equal(result.coveredHunks, 3);
  assert.equal(result.plan.commits[0].type, "chore");
  assert.ok(result.warnings.some((warning) => warning.includes("fallback")));
});

test("normalizePlan keeps commit ids unique and ordered", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "a", type: "feat", subject: "one", changes: [{ file: "src/app.ts", hunks: [0] }] },
      { id: "b", type: "fix", subject: "two", changes: [{ file: "src/app.ts", hunks: [1] }] }
    ]),
    files
  );

  assert.deepEqual(
    result.plan.commits.map((commit) => commit.id),
    ["1", "2"]
  );
});

test("normalizePlan preserves the AI scope and breaking flag", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    {
      commits: [
        {
          id: "1",
          type: "feat",
          scope: "API Gateway",
          breaking: true,
          subject: "feat: add endpoint",
          body: ["Adds an endpoint."],
          changes: [{ file: "src/app.ts", hunks: [0, 1] }]
        }
      ]
    },
    files
  );

  const commit = result.plan.commits[0];
  assert.equal(commit.scope, "apigateway");
  assert.equal(commit.breaking, true);
  assert.equal(commit.subject, "add endpoint");
});

test("normalizePlan extracts a scope written inside the subject", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "1", type: "fix", subject: "fix(ui): correct totals", changes: [{ file: "src/app.ts", hunks: [0, 1] }] }
    ]),
    files
  );

  assert.equal(result.plan.commits[0].scope, "ui");
  assert.equal(result.plan.commits[0].subject, "correct totals");
});

test("normalizePlan keeps every commit (no commit-count limit)", () => {
  const files = parseUnifiedDiff(DIFF);
  const result = normalizePlan(
    plan([
      { id: "1", type: "feat", subject: "one", changes: [{ file: "src/app.ts", hunks: [0] }] },
      { id: "2", type: "fix", subject: "two", changes: [{ file: "src/app.ts", hunks: [1] }] },
      { id: "3", type: "docs", subject: "three", changes: [{ file: "docs/readme.md", hunks: [0] }] }
    ]),
    files
  );

  assert.equal(result.plan.commits.length, 3);
  assert.equal(result.coveredHunks, 3);
  assert.ok(!result.warnings.some((warning) => warning.includes("limit")));
});

