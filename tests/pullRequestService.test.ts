/**
 * Tests for Pull Request argument/URL construction.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCompareUrl,
  buildGhPrArgs,
  normalizeRemoteUrl
} from "../src/services/PullRequestService";

test("normalizeRemoteUrl converts ssh remotes to https", () => {
  assert.equal(
    normalizeRemoteUrl("git@github.com:owner/repo.git"),
    "https://github.com/owner/repo"
  );
  assert.equal(
    normalizeRemoteUrl("ssh://git@github.com/owner/repo.git"),
    "https://github.com/owner/repo"
  );
  assert.equal(
    normalizeRemoteUrl("https://github.com/owner/repo.git"),
    "https://github.com/owner/repo"
  );
});

test("buildGhPrArgs passes branch and body-file options in full", () => {
  const args = buildGhPrArgs({
    baseBranch: "main",
    headBranch: "feat/composer",
    title: "feat: improve composer",
    bodyFile: "/tmp/body.md"
  });

  assert.deepEqual(args, [
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    "feat/composer",
    "--title",
    "feat: improve composer",
    "--body-file",
    "/tmp/body.md"
  ]);
});

test("buildCompareUrl encodes branches, title and body exactly once", () => {
  const url = buildCompareUrl(
    "git@github.com:owner/repo.git",
    "main",
    "feat/composer",
    "feat: improve composer",
    "## Summary\nFixes the #1 issue."
  );

  assert.ok(url.startsWith("https://github.com/owner/repo/compare/main...feat%2Fcomposer?"));
  const query = new URLSearchParams(url.split("?")[1]);
  assert.equal(query.get("title"), "feat: improve composer");
  assert.equal(query.get("body"), "## Summary\nFixes the #1 issue.");
  assert.equal(query.get("expand"), "1");
});

test("buildCompareUrl returns an empty string for unusable remotes", () => {
  assert.equal(buildCompareUrl("file:///tmp/repo", "main", "dev", "t", "b"), "");
});
