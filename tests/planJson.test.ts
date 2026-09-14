/**
 * Tests for tolerant commit-plan extraction.
 *
 * Every case here reproduces a real provider behaviour that previously broke
 * plan generation: prose before the JSON, a bare commit object instead of
 * `{"commits": [...]}`, concatenated JSON objects, truncated output and
 * trailing commas.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCommitGroups, extractJsonObjectWithKeys, scanJsonValues } from "../src/ai/planJson";

const COMMIT = {
  type: "feat",
  subject: "add dark mode",
  body: ["Adds a dark mode toggle.", "- persist the choice"],
  changes: [{ file: "src/app.ts", hunks: [0] }]
};

test("extracts commits from the canonical wrapper", () => {
  const groups = extractCommitGroups(JSON.stringify({ commits: [COMMIT] }));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "feat");
  assert.deepEqual(groups[0].changes, [{ file: "src/app.ts", hunks: [0] }]);
});

test("extracts commits from a fenced code block", () => {
  const groups = extractCommitGroups(`Here you go:\n\`\`\`json\n{"commits":[${JSON.stringify(COMMIT)}]}\n\`\`\``);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].subject, "add dark mode");
});

test("extracts a bare commit object returned at the top level", () => {
  const groups = extractCommitGroups(JSON.stringify(COMMIT));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].subject, "add dark mode");
});

test("extracts concatenated JSON objects (JSON lines)", () => {
  const second = { ...COMMIT, subject: "fix totals" };
  const raw = `${JSON.stringify(COMMIT)}\n${JSON.stringify(second)}\n`;
  const groups = extractCommitGroups(raw);
  assert.deepEqual(
    groups.map((group) => group.subject),
    ["add dark mode", "fix totals"]
  );
});

test("salvages commits that follow chain-of-thought prose", () => {
  const raw = `We need answer only JSON. Need create commit plan.
Let me think about the grouping.

${JSON.stringify(COMMIT)}`;
  const groups = extractCommitGroups(raw);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].subject, "add dark mode");
});

test("extracts commits from a top-level array", () => {
  const groups = extractCommitGroups(JSON.stringify([COMMIT]));
  assert.equal(groups.length, 1);
});

test("extracts commits nested under a plan wrapper", () => {
  const groups = extractCommitGroups(JSON.stringify({ plan: { commits: [COMMIT] } }));
  assert.equal(groups.length, 1);
});

test("repairs truncated JSON by closing open brackets", () => {
  const raw = `{"commits":[{"type":"refactor","subject":"extract controller","changes":[{"file":"src/a.ts","hunks":[1`;
  const groups = extractCommitGroups(raw);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].subject, "extract controller");
});

test("repairs trailing commas", () => {
  const raw = `{"commits":[{"type":"fix","subject":"handle blanks","changes":[],},],}`;
  const groups = extractCommitGroups(raw);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].subject, "handle blanks");
});

test("drops duplicate commits", () => {
  const raw = JSON.stringify({ commits: [COMMIT, COMMIT] });
  assert.equal(extractCommitGroups(raw).length, 1);
});

test("ignores objects that are not commits", () => {
  assert.deepEqual(extractCommitGroups('{"summary":"nothing here"}'), []);
  assert.deepEqual(extractCommitGroups("No JSON at all, sorry."), []);
  assert.deepEqual(extractCommitGroups(""), []);
});

test("accepts file strings without hunk indices", () => {
  const raw = JSON.stringify({
    commits: [{ type: "docs", subject: "update readme", changes: ["README.md"] }]
  });
  const groups = extractCommitGroups(raw);
  assert.deepEqual(groups[0].changes, [{ file: "README.md", hunks: [] }]);
});

test("recovers the reported Gemini payload (bare object, truncated body)", () => {
  // Verbatim shape of the response that previously failed with
  // "Unexpected non-whitespace character after JSON at position 1341".
  const raw = `{
    "id": "1",
    "type": "refactor",
    "scope": "ui",
    "subject": "Extract webview logic to ComposerController",
    "body": [
      "The \`CommitComposerPanel\` class has been refactored to delegate all business logic.",
      "The \`ComposerController\` now handles messages from the webview and interacts with GitService.`;

  const groups = extractCommitGroups(raw);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "refactor");
  assert.equal(groups[0].scope, "ui");
  assert.equal(groups[0].subject, "Extract webview logic to ComposerController");
  assert.ok(groups[0].body.length >= 1);
});

test("salvages the valid first object when extra text follows the JSON", () => {
  const raw = '{"commits":[{"type":"feat","subject":"add toggle","changes":[]}]}\n\nHope this helps!';
  const groups = extractCommitGroups(raw);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].subject, "add toggle");
});

test("scanJsonValues is string aware", () => {
  const values = scanJsonValues('text {"a":"brace } inside","b":{"c":1}} tail');
  assert.equal(values.length, 1);
  assert.equal(values[0], '{"a":"brace } inside","b":{"c":1}}');
});

test("extractJsonObjectWithKeys finds a payload wrapped in prose and fences", () => {
  const raw = 'Here is the PR:\n```json\n{"title":"feat: add sync","description":"%23 Summary"}\n```\nEnjoy!';
  const found = extractJsonObjectWithKeys(raw, ["title", "description"]);
  assert.equal(found?.title, "feat: add sync");
  assert.equal(found?.description, "%23 Summary");
});

test("extractJsonObjectWithKeys ignores unrelated objects", () => {
  const raw = '{"note":"nothing"} then {"description":"real"}';
  const found = extractJsonObjectWithKeys(raw, ["title", "description"]);
  assert.equal(found?.description, "real");
  assert.equal(extractJsonObjectWithKeys("no json here", ["title"]), undefined);
});
