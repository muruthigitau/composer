/**
 * Unified-diff parsing utilities.
 *
 * This module is the single source of truth for turning raw `git diff` output
 * into structured files/hunks. It is intentionally free of VS Code, Node and
 * AI dependencies so the composer can use identical parsing for:
 *
 *  - rendering per-file diffs in the webview,
 *  - building the compact, hunk-indexed diff sent to the AI,
 *  - constructing precise `git apply` patches when committing only some hunks.
 */

/** A single `@@` hunk inside a file diff. */
export interface ParsedHunk {
  /** Zero-based index of the hunk within its file. */
  index: number;
  /** The raw `@@ -a,b +c,d @@` header line. */
  header: string;
  /** Raw hunk body lines (verbatim, including `\ No newline` markers). */
  lines: string[];
  /** Starting line number in the old file. */
  oldStart: number;
  /** Starting line number in the new file. */
  newStart: number;
}

/** A single file section of a unified diff. */
export interface ParsedFileDiff {
  /** Repo-relative path of the file in the new revision. */
  path: string;
  /** Previous path, present for renames/copies. */
  previousPath?: string;
  /** Change status derived from the diff headers. */
  status: "ADDED" | "MODIFIED" | "DELETED" | "RENAMED";
  /** Every line before the first hunk (`diff --git`, `index`, `---`, `+++`). */
  headerLines: string[];
  /** Parsed hunks; empty for binary files. */
  hunks: ParsedHunk[];
  /** Number of added lines. */
  additions: number;
  /** Number of deleted lines. */
  deletions: number;
  /** True when the diff contains a binary patch instead of hunks. */
  isBinary: boolean;
  /** Raw block for binary files, required to re-apply their patch. */
  binaryPatch?: string;
}

const FILE_HEADER = "diff --git ";
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Split raw unified diff text into one block per file.
 *
 * Splitting on `diff --git ` at the start of a line is safe: every line inside
 * a hunk body is prefixed with ` `, `+`, `-` or `\`, so a file header can only
 * appear between files.
 */
function splitFileBlocks(diff: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] | undefined;

  for (const line of diff.split("\n")) {
    if (line.startsWith(FILE_HEADER)) {
      current = [line];
      blocks.push(current);
      continue;
    }
    if (current) {
      current.push(line);
    }
  }

  return blocks;
}

/** Extract the new-file path from a file block's headers. */
function resolvePathFromHeaders(lines: string[]): { path: string; previousPath?: string } {
  const header = lines[0] || "";
  const headerMatch = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
  let path = headerMatch ? headerMatch[2] : "";
  let previousPath = headerMatch ? headerMatch[1] : undefined;

  for (const line of lines) {
    if (line.startsWith("rename from ")) {
      previousPath = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      path = line.slice("rename to ".length).trim();
    } else if (line.startsWith("+++ ")) {
      const candidate = line.slice(4).trim();
      if (candidate !== "/dev/null") {
        path = candidate.replace(/^[ab]\//, "");
      }
    } else if (line.startsWith("--- ") && !path) {
      const candidate = line.slice(4).trim();
      if (candidate !== "/dev/null") {
        previousPath = candidate.replace(/^[ab]\//, "");
      }
    }
  }

  return { path, previousPath: path === previousPath ? undefined : previousPath };
}

/**
 * Parse raw unified diff text into structured per-file, per-hunk data.
 *
 * @param diff Raw output of `git diff` (with or without `--binary`).
 * @returns One entry per changed file, in diff order.
 */
export function parseUnifiedDiff(diff: string): ParsedFileDiff[] {
  if (!diff.trim()) {
    return [];
  }

  const files: ParsedFileDiff[] = [];

  for (const block of splitFileBlocks(diff)) {
    const { path, previousPath } = resolvePathFromHeaders(block);
    if (!path) {
      continue;
    }

    const isBinary =
      block.some((l) => l.startsWith("GIT binary patch")) ||
      block.some((l) => /^Binary files .* differ$/.test(l));

    let status: ParsedFileDiff["status"] = "MODIFIED";
    if (block.some((l) => l.startsWith("new file mode"))) status = "ADDED";
    else if (block.some((l) => l.startsWith("deleted file mode"))) status = "DELETED";
    else if (block.some((l) => l.startsWith("rename from "))) status = "RENAMED";

    const headerLines: string[] = [];
    const hunks: ParsedHunk[] = [];
    let currentHunk: ParsedHunk | undefined;
    let additions = 0;
    let deletions = 0;

    for (const line of block) {
      const hunkMatch = line.match(HUNK_HEADER);
      if (hunkMatch) {
        currentHunk = {
          index: hunks.length,
          header: line,
          lines: [],
          oldStart: Number(hunkMatch[1]),
          newStart: Number(hunkMatch[3])
        };
        hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) {
        headerLines.push(line);
        continue;
      }

      currentHunk.lines.push(line);
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }

    files.push({
      path,
      previousPath,
      status,
      headerLines,
      hunks,
      additions,
      deletions,
      isBinary,
      binaryPatch: isBinary ? block.join("\n") : undefined
    });
  }

  return files;
}

/**
 * Normalize a path for comparison purposes only (never for patching).
 *
 * Handles Windows separators, `a/`/`b/` prefixes, leading `./`, absolute
 * prefixes and case differences so AI-emitted paths can be matched back to
 * real staged paths.
 */
export function normalizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^[ab]\//, "")
    .replace(/^\/+/, "")
    .trim()
    .toLowerCase();
}

/**
 * Resolve a caller/AI supplied path against the real diffed file paths.
 *
 * Resolution order: exact match, normalized match, suffix match, basename
 * match. Returns `undefined` when nothing matches.
 */
export function resolvePath(target: string, candidates: string[]): string | undefined {
  if (!target || target.trim().length === 0) {
    return undefined;
  }

  const exact = candidates.find((c) => c === target);
  if (exact) {
    return exact;
  }

  const normalizedTarget = normalizePath(target);
  const normalized = candidates.filter((c) => normalizePath(c) === normalizedTarget);
  if (normalized.length > 0) {
    return normalized[0];
  }

  const suffixMatches = candidates.filter((c) => normalizePath(c).endsWith(`/${normalizedTarget}`));
  if (suffixMatches.length > 0) {
    return suffixMatches[0];
  }

  const baseName = normalizedTarget.split("/").pop() || normalizedTarget;
  const baseMatches = candidates.filter((c) => normalizePath(c).split("/").pop() === baseName);
  return baseMatches.length === 1 ? baseMatches[0] : undefined;
}

/**
 * Build an applicable patch containing only the requested hunks of one file.
 *
 * @param file Parsed file diff (must include the original header lines).
 * @param hunkIndices Zero-based hunk indices to include.
 * @returns Patch text, or an empty string when nothing can be included.
 */
export function buildFilePatch(file: ParsedFileDiff, hunkIndices: number[]): string {
  if (file.isBinary) {
    return file.binaryPatch ? `${file.binaryPatch}\n` : "";
  }

  const unique = [...new Set(hunkIndices)].sort((a, b) => a - b);
  const hunks = unique.map((index) => file.hunks[index]).filter((h): h is ParsedHunk => !!h);
  if (hunks.length === 0) {
    return "";
  }

  const lines = [...file.headerLines, ...hunks.flatMap((h) => [h.header, ...h.lines])];
  return `${lines.join("\n")}\n`;
}

/** Total number of hunks across all files. */
export function countHunks(files: ParsedFileDiff[]): number {
  return files.reduce((total, file) => total + file.hunks.length, 0);
}


/** Compact status label used in the AI-facing annotated diff. */
function statusLabel(file: ParsedFileDiff): string {
  if (file.isBinary) return "binary";
  return file.status.toLowerCase();
}

/**
 * Build a compact, hunk-indexed diff for the AI.
 *
 * Compared to a raw `git diff` this drops `diff --git`, `index`, `---` and
 * `+++` header lines (replaced by one `FILE:` line carrying the authoritative
 * hunk count) and replaces binary patches with a one-line marker. The AI only
 * ever sees hunk indices that exist, which eliminates hallucinated indices and
 * unknown file paths.
 *
 * @param files Parsed file diffs.
 * @param maxChars Soft cap on the returned text length. Files beyond the cap
 *   are listed without their hunks; the plan normalizer still guarantees that
 *   their changes end up in some commit.
 */
export function buildAnnotatedDiff(files: ParsedFileDiff[], maxChars = 200_000): string {
  const parts: string[] = [];
  let length = 0;

  for (const file of files) {
    const rename = file.previousPath ? ` renamed-from=${file.previousPath}` : "";
    const head =
      `FILE: ${file.path} [${statusLabel(file)}${rename} +${file.additions} ` +
      `-${file.deletions} hunks=${file.hunks.length}]`;

    if (file.isBinary) {
      const line = `${head}\n(binary file - contents omitted)`;
      parts.push(line);
      length += line.length;
      continue;
    }

    const body: string[] = [head];
    for (const hunk of file.hunks) {
      body.push(`HUNK ${hunk.index} ${hunk.header}`);
      body.push(...hunk.lines);
    }

    const text = body.join("\n");
    if (length + text.length > maxChars) {
      const omitted = `${head}\n(diff omitted - size limit reached)`;
      parts.push(omitted);
      length += omitted.length;
      continue;
    }

    parts.push(text);
    length += text.length;
  }

  return parts.join("\n\n");
}

/**
 * Shrink an annotated diff produced by {@link buildAnnotatedDiff} so it fits a
 * smaller context window.
 *
 * Every `FILE:` header is always kept (the AI must still see all files); hunk
 * bodies are kept only while the character budget allows. Hunk indices are
 * still printed, and the final `hunks=` count in each header tells the model
 * how many hunks exist, so it can either list the indices it saw or send an
 * empty `hunks` array to mean "the whole file".
 *
 * @param annotated Text from `buildAnnotatedDiff`.
 * @param maxChars Character budget for the returned text.
 */
export function shrinkAnnotatedDiff(annotated: string, maxChars: number): string {
  if (annotated.length <= maxChars) {
    return annotated;
  }

  const blocks = annotated.split("\n\n").filter((block) => block.trim().length > 0);
  if (blocks.length === 0) {
    return annotated;
  }

  // Reserve space for every FILE header so the model still sees all files.
  const headers = blocks.map((block) => block.split("\n")[0]);
  const headerBudget = headers.reduce((total, header) => total + header.length + 1, 0);
  let bodyBudget = maxChars - headerBudget;
  let truncated = false;

  return blocks
    .map((block, index) => {
      const lines = block.split("\n");
      const body = lines.slice(1);
      const parts = [headers[index]];

      for (const line of body) {
        if (bodyBudget - (line.length + 1) < 0) {
          truncated = true;
          break;
        }
        bodyBudget -= line.length + 1;
        parts.push(line);
      }

      return parts.join("\n");
    })
    .join("\n\n")
    .concat(truncated ? "\n\n(hunk bodies omitted - context limit reached)" : "");
}

/** Map parsed file diffs onto the webview `FileDiff` shape. */
export function toFileDiffs(files: ParsedFileDiff[]): {
  path: string;
  status: "ADDED" | "MODIFIED" | "DELETED";
  additions: number;
  deletions: number;
  diffText: string;
}[] {
  return files.map((file) => ({
    path: file.path,
    status: file.status === "ADDED" ? "ADDED" : file.status === "DELETED" ? "DELETED" : "MODIFIED",
    additions: file.additions,
    deletions: file.deletions,
    diffText: file.isBinary
      ? `diff --git a/${file.path} b/${file.path}\nBinary file (not shown)`
      : [...file.headerLines, ...file.hunks.flatMap((h) => [h.header, ...h.lines])].join("\n")
  }));
}
