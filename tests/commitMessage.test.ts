/**
 * Tests for conventional-commit message normalization.
 *
 * These cover the duplicate-prefix bug (`feat: feat(theme): x`), type
 * detection, scope/breaking handling, body formatting and PR title cleanup.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSubjectLine,
  formatCommitBody,
  formatCommitMessage,
  normalizeType,
  parseSubject,
  sanitizePrTitle
} from "../src/services/CommitMessage";

test("normalizeType accepts known types case-insensitively", () => {
  assert.equal(normalizeType("FEAT"), "feat");
  assert.equal(normalizeType(" fix "), "fix");
  assert.equal(normalizeType("refactor(ui)"), "refactor");
});

test("normalizeType falls back to chore for unknown types", () => {
  assert.equal(normalizeType("feature"), "chore");
  assert.equal(normalizeType(""), "chore");
  assert.equal(normalizeType("wip"), "chore");
});

test("parseSubject strips a single type prefix", () => {
  const parsed = parseSubject("feat: add dark mode toggle");
  assert.equal(parsed.type, "feat");
  assert.equal(parsed.subject, "add dark mode toggle");
  assert.equal(parsed.scope, undefined);
});

test("parseSubject strips duplicated prefixes", () => {
  const parsed = parseSubject("refactor: refactor: embed wizard in panel");
  assert.equal(parsed.type, "refactor");
  assert.equal(parsed.subject, "embed wizard in panel");
});

test("parseSubject strips repeated prefix with scope", () => {
  const parsed = parseSubject("feat: feat(theme): dark mode");
  assert.equal(parsed.type, "feat");
  assert.equal(parsed.scope, "theme");
  assert.equal(parsed.subject, "dark mode");
});

test("parseSubject understands scopes, breaking markers and dashes", () => {
  assert.deepEqual(parseSubject("fix(api)!: handle empty bodies"), {
    type: "fix",
    scope: "api",
    breaking: true,
    subject: "handle empty bodies"
  });
  assert.equal(parseSubject("docs - update readme").type, "docs");
  assert.equal(parseSubject("chore – tidy imports").subject, "tidy imports");
});

test("parseSubject keeps unknown leading words but drops the separator", () => {
  const parsed = parseSubject("update: retry logic");
  assert.equal(parsed.type, undefined);
  assert.equal(parsed.subject, "update retry logic");
});

test("parseSubject trims trailing punctuation and markdown noise", () => {
  assert.equal(parseSubject("fix: handle null values.").subject, "handle null values");
  assert.equal(parseSubject("## fix: `handle` null values").subject, "handle null values");
});

test("parseSubject truncates very long descriptions at a word boundary", () => {
  const long = "add a very long description that keeps going and going without ever stopping";
  const subject = parseSubject(`feat: ${long}`).subject;
  assert.ok(subject.length <= 68, `expected <= 68 characters, got ${subject.length}`);
  assert.ok(!subject.endsWith(" "));
});

test("buildSubjectLine never emits a duplicated prefix", () => {
  assert.equal(
    buildSubjectLine("feat", "feat(theme): add dark mode"),
    "feat(theme): add dark mode"
  );
  assert.equal(
    buildSubjectLine("fix", "feat: correct totals"),
    "fix: correct totals"
  );
});

test("buildSubjectLine keeps headers within the maximum length", () => {
  const header = buildSubjectLine("refactor", "x".repeat(200), { scope: "webview" });
  assert.ok(header.length <= 72, `expected <= 72 characters, got ${header.length}`);
});

test("formatCommitBody keeps a summary paragraph and bullet lines", () => {
  const body = formatCommitBody("feat: add thing", [
    "Add a thing that does something useful for the user.",
    "* first bullet",
    "2. second bullet"
  ]);
  assert.match(body, /^Add a thing that does something useful for the user\./);
  assert.match(body, /- first bullet/);
  assert.match(body, /- second bullet/);
});

test("formatCommitBody drops a paragraph that only repeats the header", () => {
  const body = formatCommitBody("feat: add dark mode", [
    "feat: add dark mode",
    "- toggle theme"
  ]);
  assert.equal(body, "- toggle theme");
});

test("formatCommitMessage produces header plus body", () => {
  const message = formatCommitMessage({
    type: "feat",
    subject: "feat: add dark mode",
    body: ["Adds a dark mode toggle to the settings page.", "- Persist the choice."]
  });
  const [header, blank, ...rest] = message.split("\n");
  assert.equal(header, "feat: add dark mode");
  assert.equal(blank, "");
  assert.match(rest.join("\n"), /Adds a dark mode toggle/);
  assert.match(rest.join("\n"), /- Persist the choice/);
});

test("formatCommitMessage returns just the header when there is no body", () => {
  const message = formatCommitMessage({ type: "chore", subject: "bump version", body: [] });
  assert.equal(message, "chore: bump version");
});

test("formatCommitMessage includes the conventional scope", () => {
  const message = formatCommitMessage({
    type: "feat",
    scope: "api",
    subject: "add retry endpoint",
    body: ["Adds a retry endpoint.", "- retries twice"]
  });
  assert.match(message.split("\n")[0], /^feat\(api\): add retry endpoint$/);
});

test("formatCommitMessage keeps a scope found inside the subject", () => {
  const message = formatCommitMessage({ type: "fix", subject: "fix(ui): correct totals", body: [] });
  assert.equal(message, "fix(ui): correct totals");
});

test("formatCommitMessage marks breaking changes", () => {
  const message = formatCommitMessage({ type: "feat", scope: "api", breaking: true, subject: "drop v1", body: [] });
  assert.equal(message, "feat(api)!: drop v1");
});

test("sanitizePrTitle removes markdown markers and duplicated prefixes", () => {
  assert.equal(sanitizePrTitle("## feat: feat: add invoice sync"), "feat: add invoice sync");
  assert.equal(sanitizePrTitle("%23%23 fix: leak"), "fix: leak");
});

test("sanitizePrTitle keeps titles without a conventional prefix", () => {
  assert.equal(sanitizePrTitle("Improve invoice retrieval"), "Improve invoice retrieval");
  assert.equal(sanitizePrTitle(""), "Update project files");
});

test("sanitizePrTitle collapses multi-line output to a single line", () => {
  const title = sanitizePrTitle("feat: add retry\n\nlogic for uploads");
  assert.equal(title, "feat: add retry logic for uploads");
});
