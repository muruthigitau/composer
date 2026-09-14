/**
 * Integration tests for GitService.
 *
 * They run against a throw-away git repository and verify the guarantee that
 * matters most: every planned commit contains exactly the hunks it owns, and
 * changes that no commit consumed stay staged.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { GitService } from "../src/services/GitService";

/** Run a git command in a repository and return stdout. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Create an isolated repository with deterministic commit settings. */
function createRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commit-composer-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "tests@example.com"]);
  git(dir, ["config", "user.name", "Commit Composer Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

/** Build a 30-line file so changes 20 lines apart form two separate hunks. */
function buildFile(secondLine: string, lastLine: string): string {
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  lines[1] = secondLine;
  lines[29] = lastLine;
  return `${lines.join("\n")}\n`;
}

/** Read a file from a git revision. */
function show(repo: string, rev: string, file: string): string {
  return git(repo, ["show", `${rev}:${file}`]);
}

test("commitHunkPlan creates one commit per hunk of the same file", async () => {
  const repo = createRepo();
  const file = "src/app.ts";
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, file), buildFile("line 2", "line 30"));
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "chore: initial"]);
  const base = git(repo, ["rev-parse", "HEAD"]).trim();
  assert.match(show(repo, base, file), /line 2\n/);

  fs.writeFileSync(path.join(repo, file), buildFile("line 2 changed", "line 30 changed"));
  git(repo, ["add", "."]);

  const service = new GitService(repo);
  const staged = await service.getParsedStagedDiff();
  assert.equal(staged.length, 1);
  assert.equal(staged[0].hunks.length, 2, "expected two independent hunks");

  const result = await service.commitHunkPlan([
    { message: "feat: change the second line", changes: [{ file, hunks: [0] }] },
    { message: "feat: change the last line", changes: [{ file, hunks: [1] }] }
  ]);

  assert.deepEqual(result, { committed: 2, skipped: 0 });

  const subjects = git(repo, ["log", "--format=%s", "-2"]).trim().split("\n");
  assert.deepEqual(subjects, ["feat: change the last line", "feat: change the second line"]);

  // The first commit contains only the first hunk.
  const firstCommit = show(repo, "HEAD~1", file);
  assert.match(firstCommit, /line 2 changed/);
  assert.match(firstCommit, /line 30\n/);

  const headContent = show(repo, "HEAD", file);
  assert.match(headContent, /line 2 changed/);
  assert.match(headContent, /line 30 changed/);

  // Everything was consumed, so nothing is left staged.
  assert.equal((await service.getStagedFiles()).length, 0);
  assert.equal(await service.isWorkingTreeClean(), true);
});


test("commitHunkPlan leaves unconsumed hunks staged", async () => {
  const repo = createRepo();
  const file = "src/app.ts";
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, file), buildFile("line 2", "line 30"));
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "chore: initial"]);

  fs.writeFileSync(path.join(repo, file), buildFile("line 2 changed", "line 30 changed"));
  git(repo, ["add", "."]);

  const service = new GitService(repo);
  const result = await service.commitHunkPlan([
    { message: "feat: change only the second line", changes: [{ file, hunks: [0] }] }
  ]);

  assert.deepEqual(result, { committed: 1, skipped: 0 });

  const headContent = show(repo, "HEAD", file);
  assert.match(headContent, /line 2 changed/);
  assert.match(headContent, /line 30\n/);

  // The remaining hunk is still staged for the user.
  assert.deepEqual(await service.getStagedFiles(), [file]);
  const remaining = await service.getParsedStagedDiff();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].hunks.length, 1);
  assert.equal(await service.isWorkingTreeClean(), false);
});

test("commitHunkPlan skips commits without applicable hunks", async () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "chore: initial"]);

  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  git(repo, ["add", "."]);

  const service = new GitService(repo);
  const result = await service.commitHunkPlan([
    { message: "feat: real change", changes: [{ file: "a.txt", hunks: [0] }] },
    { message: "feat: stale plan", changes: [{ file: "a.txt", hunks: [9] }] }
  ]);

  assert.equal(result.committed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(git(repo, ["log", "--format=%s", "-1"]).trim(), "feat: real change");
});

test("commitHunkPlan handles added and deleted files", async () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "keep.txt"), "keep\n");
  fs.writeFileSync(path.join(repo, "gone.txt"), "gone\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "chore: initial"]);

  fs.rmSync(path.join(repo, "gone.txt"));
  fs.writeFileSync(path.join(repo, "created.txt"), "created\n");
  git(repo, ["add", "-A"]);

  const service = new GitService(repo);
  const staged = await service.getParsedStagedDiff();
  const created = staged.find((file) => file.path === "created.txt");
  const removed = staged.find((file) => file.path === "gone.txt");
  assert.equal(created?.status, "ADDED");
  assert.equal(removed?.status, "DELETED");

  const result = await service.commitHunkPlan([
    { message: "feat: add created file", changes: [{ file: "created.txt", hunks: [] }] },
    { message: "chore: remove gone file", changes: [{ file: "gone.txt", hunks: [] }] }
  ]);

  assert.deepEqual(result, { committed: 2, skipped: 0 });
  assert.equal(git(repo, ["ls-tree", "--name-only", "HEAD"]).includes("created.txt"), true);
  assert.equal(fs.existsSync(path.join(repo, "gone.txt")), false);
});

test("status, branch and commit helpers reflect the repository", async () => {
  const repo = createRepo();
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "feat: initial"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  git(repo, ["add", "."]);
  fs.writeFileSync(path.join(repo, "b.txt"), "untracked\n");

  const service = new GitService(repo);
  const counts = await service.getStatusCounts();
  assert.equal(counts.staged, 1);
  assert.equal(counts.unstaged, 1);
  assert.equal(await service.getCurrentBranch(), "main");
  assert.equal(await service.hasLocalBranch("main"), true);
  assert.equal(await service.hasLocalBranch("missing"), false);
  assert.equal(await service.refExists("HEAD"), true);

  git(repo, ["commit", "-q", "-m", "feat: second"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\nthree\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "feat: third"]);

  const commits = await service.getCommitsBetween("HEAD~2", "HEAD");
  assert.deepEqual(
    commits.map((commit) => commit.subject),
    ["feat: third", "feat: second"]
  );
});
