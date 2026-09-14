/**
 * Behaviour tests for the commit-plan flow using fake git/AI dependencies.
 *
 * They pin the guarantees the UI relies on: plans are repaired before display,
 * commit messages can never carry a duplicated prefix, and single-message
 * regeneration only ever sends the hunks of that one commit.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CommitPlanFlow, CommitPlanFlowDeps } from "../src/webview/CommitPlanFlow";
import { AIService } from "../src/services/AIService";
import { GitService } from "../src/services/GitService";
import { CommitPlan } from "../src/types/messages";
import { ParsedFileDiff, parseUnifiedDiff } from "../src/services/DiffParser";

const STAGED_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
 line one
+line added
 line three
@@ -20,2 +21,2 @@
-old value
+new value
`;

interface Captured {
  messages: Array<Record<string, unknown>>;
  logs: Array<{ message: string; type?: string }>;
  loading: boolean[];
  errors: string[];
  committed: Array<{ message: string; changes: Array<{ file: string; hunks: number[] }> }>;
  messageRequests: Array<{ subject: string; diff: string }>;
}

/** Build the flow with fakes and capture everything it does. */
function createFlow(
  plan: CommitPlan,
  messageDraft?: Record<string, unknown>
): { flow: CommitPlanFlow; captured: Captured; files: ParsedFileDiff[] } {
  const files = parseUnifiedDiff(STAGED_DIFF);
  const captured: Captured = {
    messages: [],
    logs: [],
    loading: [],
    errors: [],
    committed: [],
    messageRequests: []
  };

  const git = {
    getParsedStagedDiff: async () => files,
    getStagedFileDiffs: async () => [],
    getGitSnapshot: async () => ({
      staged: files.length,
      unstaged: 0,
      filesSignature: "sig",
      files
    }),
    getCurrentBranch: async () => "main",
    getStagedFiles: async () => [],
    commitHunkPlan: async (commits: Captured["committed"]) => {
      captured.committed = commits;
      return { committed: commits.length, skipped: 0 };
    }
  } as unknown as GitService;

  const ai = {
    getProviderConfig: () => ({ label: "Test Provider" }),
    generatePlan: async () => plan,
    generateCommitMessage: async (context: { subject: string; diff: string }) => {
      captured.messageRequests.push({ subject: context.subject, diff: context.diff });
      return (
        messageDraft || {
          type: "fix",
          subject: "handle empty responses",
          body: ["Handle empty response bodies gracefully.", "- add a guard"],
          overview: "Guards against empty responses."
        }
      );
    }
  } as unknown as AIService;

  const deps: CommitPlanFlowDeps = {
    git,
    ai,
    workspaceName: "repo",
    post: (message) => captured.messages.push(message as unknown as Record<string, unknown>),
    log: (message, type) => captured.logs.push({ message, type }),
    setLoading: (value) => captured.loading.push(value),
    handleError: (error) => captured.errors.push(String(error)),
    showInformationMessage: () => undefined,
    showWarningMessage: () => undefined
  };

  return { flow: new CommitPlanFlow(deps), captured, files };
}


test("generate posts a plan whose commits reference real files and hunks", async () => {
  const { flow, captured } = createFlow({
    commits: [
      {
        id: "1",
        type: "feat",
        subject: "feat: add a line",
        body: ["Adds a line.", "- first"],
        changes: [{ file: "./src/app.ts", hunks: [0] }]
      }
    ]
  });

  await flow.generate();

  const planMessage = captured.messages.find((message) => message.command === "planGenerated");
  assert.ok(planMessage, "expected a planGenerated message");
  const plan = planMessage?.plan as {
    commits: Array<{ subject: string; changes: Array<{ file: string; hunks: number[] }> }>;
  };
  assert.equal(plan.commits.length, 1);
  assert.equal(plan.commits[0].subject, "add a line");
  assert.deepEqual(plan.commits[0].changes, [{ file: "src/app.ts", hunks: [0, 1] }]);
  assert.deepEqual(captured.errors, []);
});

test("execute formats each commit message without duplicating the type prefix", async () => {
  const { flow, captured } = createFlow({ commits: [] });

  await flow.execute({
    commits: [
      {
        id: "1",
        type: "feat",
        subject: "refactor: add a line",
        overview: "Adds a line.\n- first bullet",
        files: [],
        changes: [{ file: "src/app.ts", hunks: [0] }]
      }
    ],
    summary: ""
  });

  assert.equal(captured.committed.length, 1);
  assert.equal(captured.committed[0].message.split("\n")[0], "feat: add a line");
  assert.deepEqual(captured.committed[0].changes, [{ file: "src/app.ts", hunks: [0] }]);
});

test("execute includes the commit scope in the final message", async () => {
  const { flow, captured } = createFlow({ commits: [] });

  await flow.execute({
    commits: [
      {
        id: "1",
        type: "feat",
        scope: "api",
        subject: "add retry endpoint",
        overview: "Adds a retry endpoint.",
        files: [],
        changes: [{ file: "src/app.ts", hunks: [0] }]
      }
    ],
    summary: ""
  });

  assert.equal(captured.committed.length, 1);
  assert.equal(captured.committed[0].message.split("\n")[0], "feat(api): add retry endpoint");
});

test("execute reports an error when nothing matches the staged diff", async () => {
  const { flow, captured } = createFlow({ commits: [] });

  await flow.execute({
    commits: [
      {
        id: "1",
        type: "chore",
        subject: "stale",
        overview: "",
        files: [],
        changes: [{ file: "does/not/exist.ts", hunks: [0] }]
      }
    ],
    summary: ""
  });

  assert.equal(captured.committed.length, 0);
  assert.equal(captured.errors.length, 1);
  assert.match(captured.errors[0], /match the current staged changes/);
});

test("generate falls back to a single commit when the AI returns an empty plan", async () => {
  const { flow, captured } = createFlow({ commits: [] });

  await flow.generate();

  const planMessage = captured.messages.find((message) => message.command === "planGenerated");
  assert.ok(planMessage);
  const plan = planMessage?.plan as { commits: Array<{ type: string; changes: unknown[] }> };
  assert.equal(plan.commits.length, 1);
  assert.equal(plan.commits[0].type, "chore");
  assert.ok(
    (planMessage?.warnings as string[]).some((warning) => warning.includes("fallback"))
  );
});

test("regenerate sends only the hunks of the selected commit", async () => {
  const { flow, captured } = createFlow({
    commits: [
      {
        id: "1",
        type: "feat",
        subject: "first",
        body: ["First."],
        changes: [{ file: "src/app.ts", hunks: [0] }]
      },
      {
        id: "2",
        type: "fix",
        subject: "second",
        body: ["Second."],
        changes: [{ file: "src/app.ts", hunks: [1] }]
      }
    ]
  });

  await flow.generate();
  await flow.regenerate("2");

  assert.equal(captured.messageRequests.length, 1);
  assert.equal(captured.messageRequests[0].subject, "second");
  assert.match(captured.messageRequests[0].diff, /HUNK 1/);
  assert.doesNotMatch(captured.messageRequests[0].diff, /HUNK 0 /);

  const regenerated = captured.messages.find((message) => message.command === "singleRegenerated");
  assert.ok(regenerated);
  const commit = regenerated?.commit as { subject: string; type: string };
  assert.equal(commit.type, "fix");
  assert.equal(commit.subject, "handle empty responses");
});

test("regenerate falls back to a full plan when the commit is unknown", async () => {
  const { flow, captured } = createFlow({ commits: [] });

  await flow.regenerate("missing");

  assert.equal(captured.messageRequests.length, 0);
  assert.equal(captured.errors.length, 0);
  assert.ok(captured.logs.some((entry) => entry.message.includes("Reading staged Git changes")));
  assert.equal(captured.messages.filter((m) => m.command === "planGenerated").length, 1);
});
