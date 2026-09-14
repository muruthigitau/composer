/**
 * Tests for unified-diff parsing, path resolution, patch building and the
 * compact annotated diff sent to the AI.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAnnotatedDiff,
  buildFilePatch,
  countHunks,
  normalizePath,
  parseUnifiedDiff,
  resolvePath,
  shrinkAnnotatedDiff,
  toFileDiffs
} from "../src/services/DiffParser";

const TWO_HUNK_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import { a } from "./a";
+import { b } from "./b";
 
-const x = 1;
+const x = 2;
 export default x;
@@ -40,3 +41,4 @@ export function run() {
   const value = 1;
-  return value;
+  const doubled = value * 2;
+  return doubled;
 }
`;

const ADDED_FILE_DIFF = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export const created = true;
+export const answer = 42;
+export const name = "new";
`;

test("parseUnifiedDiff extracts files, hunks and line counts", () => {
  const files = parseUnifiedDiff(TWO_HUNK_DIFF);
  assert.equal(files.length, 1);

  const [file] = files;
  assert.equal(file.path, "src/app.ts");
  assert.equal(file.status, "MODIFIED");
  assert.equal(file.hunks.length, 2);
  assert.equal(file.hunks[0].index, 0);
  assert.equal(file.hunks[1].index, 1);
  assert.equal(file.additions, 4);
  assert.equal(file.deletions, 2);
  assert.equal(files[0].hunks[1].newStart, 41);
});

test("parseUnifiedDiff detects added files", () => {
  const [file] = parseUnifiedDiff(ADDED_FILE_DIFF);
  assert.equal(file.path, "src/new.ts");
  assert.equal(file.status, "ADDED");
  assert.equal(file.additions, 3);
  assert.equal(countHunks([file]), 1);
});

test("parseUnifiedDiff returns nothing for empty input", () => {
  assert.deepEqual(parseUnifiedDiff(""), []);
  assert.deepEqual(parseUnifiedDiff("   \n"), []);
});

test("parseUnifiedDiff marks binary patches and keeps them applicable", () => {
  const diff = `diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
GIT binary patch
literal 3
LcmZQzU|;|M0{{m;
`;
  const [file] = parseUnifiedDiff(diff);
  assert.equal(file.isBinary, true);
  assert.equal(file.hunks.length, 0);
  assert.match(buildFilePatch(file, []), /GIT binary patch/);
});

test("buildFilePatch includes only the requested hunks", () => {
  const [file] = parseUnifiedDiff(TWO_HUNK_DIFF);
  const firstOnly = buildFilePatch(file, [0]);
  assert.match(firstOnly, /import \{ b \}/);
  assert.doesNotMatch(firstOnly, /const doubled/);

  const secondOnly = buildFilePatch(file, [1]);
  assert.match(secondOnly, /const doubled/);
  assert.doesNotMatch(secondOnly, /import \{ b \}/);
});

test("buildFilePatch sorts hunks and ignores out-of-range indices", () => {
  const [file] = parseUnifiedDiff(TWO_HUNK_DIFF);
  const patch = buildFilePatch(file, [1, 0, 99]);
  assert.ok(patch.indexOf("import { b }") < patch.indexOf("const doubled"));
});

test("buildFilePatch returns an empty string when no hunk matches", () => {
  const [file] = parseUnifiedDiff(TWO_HUNK_DIFF);
  assert.equal(buildFilePatch(file, []), "");
  assert.equal(buildFilePatch(file, [7]), "");
});

test("normalizePath strips prefixes, separators and case", () => {
  assert.equal(normalizePath("b/Src/App.TS"), "src/app.ts");
  assert.equal(normalizePath("./src\\app.ts"), "src/app.ts");
  assert.equal(normalizePath("/src/app.ts"), "src/app.ts");
});

test("resolvePath matches exact, prefixed, suffixed and basename forms", () => {
  const candidates = ["src/services/app.ts", "webview/src/App.tsx"];
  assert.equal(resolvePath("src/services/app.ts", candidates), "src/services/app.ts");
  assert.equal(resolvePath("b/src/services/app.ts", candidates), "src/services/app.ts");
  assert.equal(resolvePath("./services/app.ts", candidates), "src/services/app.ts");
  assert.equal(resolvePath("webview/src/App.tsx", candidates), "webview/src/App.tsx");
  assert.equal(resolvePath("App.tsx", candidates), "webview/src/App.tsx");
  assert.equal(resolvePath("missing/file.ts", candidates), undefined);
  assert.equal(resolvePath("", candidates), undefined);
});

test("buildAnnotatedDiff prints authoritative hunk indices and drops noise", () => {
  const annotated = buildAnnotatedDiff(parseUnifiedDiff(TWO_HUNK_DIFF + ADDED_FILE_DIFF));
  assert.match(annotated, /FILE: src\/app\.ts \[modified \+4 -2 hunks=2\]/);
  assert.match(annotated, /HUNK 0 @@ -1,4 \+1,5 @@/);
  assert.match(annotated, /HUNK 1 @@ -40,3 \+41,4 @@/);
  assert.match(annotated, /FILE: src\/new\.ts \[added/);
  assert.doesNotMatch(annotated, /^index /m);
  assert.doesNotMatch(annotated, /^diff --git /m);
  assert.doesNotMatch(annotated, /^\+\+\+ /m);
});

test("buildAnnotatedDiff omits hunks once the size limit is reached", () => {
  const annotated = buildAnnotatedDiff(parseUnifiedDiff(TWO_HUNK_DIFF), 10);
  assert.match(annotated, /diff omitted/);
  assert.doesNotMatch(annotated, /import \{ b \}/);
});

test("shrinkAnnotatedDiff keeps every file header and trims hunk bodies", () => {
  const annotated = buildAnnotatedDiff(parseUnifiedDiff(TWO_HUNK_DIFF + ADDED_FILE_DIFF));
  const shrunk = shrinkAnnotatedDiff(annotated, 140);

  assert.ok(shrunk.length < annotated.length);
  assert.match(shrunk, /FILE: src\/app\.ts/);
  assert.match(shrunk, /FILE: src\/new\.ts/);
  assert.doesNotMatch(shrunk, /const doubled/);
  assert.match(shrunk, /context limit reached/);
});

test("shrinkAnnotatedDiff returns the input unchanged when it already fits", () => {
  const annotated = buildAnnotatedDiff(parseUnifiedDiff(TWO_HUNK_DIFF));
  assert.equal(shrinkAnnotatedDiff(annotated, 100000), annotated);
});

test("toFileDiffs produces the webview shape", () => {
  const diffs = toFileDiffs(parseUnifiedDiff(TWO_HUNK_DIFF + ADDED_FILE_DIFF));
  assert.equal(diffs.length, 2);
  assert.equal(diffs[0].status, "MODIFIED");
  assert.equal(diffs[1].status, "ADDED");
  assert.match(diffs[0].diffText, /diff --git a\/src\/app\.ts/);
});
