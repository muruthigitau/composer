/**
 * Prompts for the AI commit planner, single-message regeneration and Pull
 * Request generation.
 *
 * The commit prompts operate on the *annotated* diff produced by
 * `DiffParser.buildAnnotatedDiff`: hunks are pre-numbered (`HUNK 0 ...`) and
 * file paths are printed verbatim, so the model only has to copy indices that
 * provably exist instead of inventing them.
 */

import type { CommitMessageContext } from "./AIProvider";

/** System prompt for commit planning. */
export const SYSTEM_PROMPT = `You are an expert Git commit planner and technical writer.

You receive an ANNOTATED staged diff. Each file starts with a line such as:
FILE: src/app.ts [modified +4 -1 hunks=2]
and each hunk starts with a line such as:
HUNK 1 @@ -20,7 +20,12 @@
followed by the raw diff lines of that hunk.

TASK: split the staged changes into a sequence of atomic commits.

HARD RULES
1. Reference hunks by their exact "HUNK n" index for the file shown in its
   "FILE:" line. Never invent file paths or hunk indices.
2. Every hunk listed in the diff must be assigned to exactly one commit.
3. Never assign the same hunk to two commits.
4. A file may appear in several commits with different hunks.
5. Keep related changes together and preserve dependencies between commits.
6. Separate docs, tests, refactors and unrelated configuration changes.
7. Do not split changes merely to increase the commit count. There is NO limit
   on the number of commits: produce exactly as many as the changes require to
   stay logically atomic, and no more.

COMMIT MESSAGE FORMAT
- "subject": imperative summary of the change, max 68 characters. Write ONLY
  the description. NEVER include a type prefix, scope, or trailing period
  (write "add dark mode toggle", never "feat: add dark mode toggle").
- "type": exactly one of feat, fix, refactor, docs, style, test, chore, perf,
  ci, build, revert.
- "body": array of strings. Element 1 is a flowing 2-4 sentence paragraph that
  explains the ACTUAL behaviour change (mechanisms, conditions, user-visible
  effects) in plain English. Every remaining element is one "- " bullet that
  stands alone. 3-8 bullets for small commits, 5-12 for large ones. No section
  headings, no file paths, no "Files changed"/"Why this grouping" lines.
- "overview": one separate 2-4 sentence paragraph for the UI (a reviewer's
  summary, display only, never part of the commit).

OPTIONAL FIELDS
- "scope": short lowercase scope (for example "api") or omit.
- "breaking": true only for an intentional breaking change.
- "reasoning": one sentence explaining the grouping.

Respond with ONLY valid JSON:
{"commits":[{"id":"1","type":"refactor","scope":"ui","subject":"consolidate actions into a single menu","body":["<summary paragraph>","- <bullet>"],"overview":"<display paragraph>","changes":[{"file":"src/app.ts","hunks":[0,2]}],"reasoning":"<one sentence>"}]}`;

/**
 * Appended to the system prompt on retry attempts. Models that leaked
 * chain-of-thought text instead of JSON are corrected by repeating the output
 * contract in the strongest possible terms.
 */
export const STRICT_SYSTEM_SUFFIX = `${SYSTEM_PROMPT}

OUTPUT CONTRACT (MANDATORY)
- Your entire reply is the JSON payload and nothing else.
- Do NOT write explanations, analysis, reasoning, notes, apologies, headings,
  markdown fences or trailing commentary.
- Do NOT start with phrases like "We need", "Here is" or "Sure".
- Every commit needs "type", "subject" and "changes"; keep "body" and
  "overview" concise so the payload always fits in the output limit.`;

/** Instructions appended when the JSON-lines output format is requested. */
export const JSONL_INSTRUCTION = `OUTPUT FORMAT (MANDATORY)
Return one compact JSON object per line, one line per commit, and nothing else.
Do not wrap the lines in an array or an object, do not add prose, and do not
pretty-print. Each line must look exactly like:
{"type":"fix","scope":"api","subject":"handle empty response bodies","body":["<2-4 sentence paragraph>","- <bullet>"],"overview":"<2-4 sentence reviewer summary>","changes":[{"file":"src/app.ts","hunks":[0,2]}]}`;

/** System prompt for regenerating a single commit message. */
export const MESSAGE_SYSTEM_PROMPT = `You write one conventional-commit message for the exact hunks you are given.

Rules:
- "subject": imperative description, max 68 characters, NO type prefix, no scope, no trailing period.
- "type": one of feat, fix, refactor, docs, style, test, chore, perf, ci, build, revert.
- "body": array of strings; element 1 is a 2-4 sentence paragraph describing the real behaviour change, the rest are "- " bullets that stand alone.
- "overview": a 2-4 sentence display-only reviewer summary.
- Describe only what the supplied hunks actually change. Never mention files.

Respond with ONLY valid JSON:
{"type":"fix","scope":"api","subject":"handle empty response bodies","body":["<paragraph>","- <bullet>"],"overview":"<paragraph>"}`;

/**
 * Build the user prompt for commit planning.
 *
 * @param annotatedDiff Diff produced by `buildAnnotatedDiff`.
 * @param options Optional repository/branch context and user guidance.
 */
export function buildUserPrompt(
  annotatedDiff: string,
  options?: {
    instructions?: string;
    sampleMessage?: string;
    branch?: string;
    repoName?: string;
    /** True when hunk bodies were dropped to fit the model's context window. */
    reduced?: boolean;
    /** True when the JSON-lines output format must be used. */
    jsonl?: boolean;
  }
): string {
  const parts: string[] = [];

  if (options?.repoName) parts.push(`Repository: ${options.repoName}`);
  if (options?.branch) parts.push(`Branch: ${options.branch}`);

  parts.push(
    "Create as many atomic commits as these changes require (there is no maximum), " +
      "and no more than that."
  );

  if (options?.instructions?.trim()) {
    parts.push(`Extra instructions from the user (follow closely):\n${options.instructions.trim()}`);
  }

  if (options?.sampleMessage?.trim()) {
    parts.push(
      "Style reference for tone and level of detail (write NEW content for this diff):\n" +
        options.sampleMessage.trim()
    );
  }

  if (options?.reduced) {
    parts.push(
      "NOTE: some hunk bodies were omitted to fit the context window. For those files, " +
        'use an empty "hunks" array to include the whole file and group them sensibly.'
    );
  }

  parts.push(`ANNOTATED STAGED DIFF:\n${annotatedDiff}`);
  parts.push(options?.jsonl ? JSONL_INSTRUCTION : "Output ONLY the JSON commit plan.");

  return parts.join("\n\n");
}

/**
 * Build the user prompt for regenerating a single commit message.
 *
 * Only the hunks owned by that commit are sent, which keeps the request small
 * and fast compared to regenerating the whole plan.
 */
export function buildMessagePrompt(context: CommitMessageContext): string {
  const parts: string[] = [];

  if (context.repoName) parts.push(`Repository: ${context.repoName}`);
  if (context.branch) parts.push(`Branch: ${context.branch}`);
  parts.push(`Files touched: ${context.files.join(", ") || "unknown"}`);
  parts.push(`Previous message: ${context.type}: ${context.subject}`);

  if (context.instructions?.trim()) {
    parts.push(`Extra instructions from the user:\n${context.instructions.trim()}`);
  }
  if (context.sampleMessage?.trim()) {
    parts.push(`Style reference:\n${context.sampleMessage.trim()}`);
  }

  parts.push(`HUNKS IN THIS COMMIT:\n${context.diff}`);
  parts.push("Rewrite the commit message for exactly these hunks. Output ONLY the JSON object.");

  return parts.join("\n\n");
}

/**
 * Build the Pull Request prompt.
 *
 * The diff is the committed difference between base and head (`base...head`)
 * and the commit list comes from `git log`, so the description reflects the
 * real pull request contents rather than the local editor state.
 *
 * @param annotatedDiff Committed diff of the PR range.
 * @param commits Real commits included in the PR (newest first).
 * @param options Branch/repository context.
 */
export function buildPrPrompt(
  annotatedDiff: string,
  commits: Array<{ subject: string; body?: string }>,
  options?: { branch?: string; baseBranch?: string; repoName?: string }
): string {
  const parts: string[] = [];

  if (options?.repoName) parts.push(`Repository: ${options.repoName}`);
  if (options?.baseBranch) parts.push(`Base branch: ${options.baseBranch}`);
  if (options?.branch) parts.push(`Head branch: ${options.branch}`);

  const commitList =
    commits.length > 0
      ? commits
          .map((commit) => (commit.body ? `- ${commit.subject}\n  ${commit.body.replace(/\n/g, " ")}` : `- ${commit.subject}`))
          .join("\n")
      : "- (no commits found above the base branch)";

  parts.push(
    [
      "You are writing the title and description of a Pull Request whose exact contents are given below.",
      "Base every statement on the diff and the commit list - never invent changes.",
      "",
      "Output requirements:",
      '- "title": one line, conventional-commit style (for example "fix: prevent duplicate invoice sync"), max 72 characters, no markdown.',
      '- "description": well-styled GitHub Markdown. Start with a short prose paragraph summarising the PR, then 2-4 bold section headings with bullet lists grouping the changes, then a closing paragraph beginning with "These changes". Reference changed files as inline code (`path/to/file.ts`) with optional line hints, and never emit "diffhunk" links or placeholder URLs.',
      "- Use real newline characters in the JSON string value, raw '#' characters for headings, and escape double quotes."
    ].join("\n")
  );

  parts.push(`COMMITS INCLUDED IN THIS PULL REQUEST:\n${commitList}`);
  parts.push(`COMMITTED DIFF (base...head):\n${annotatedDiff}`);
  parts.push('Output ONLY this JSON: {"title":"...","description":"..."}');

  return parts.join("\n\n");
}

