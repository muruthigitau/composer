/**
 * System and user prompts for the AI commit planner.
 */

export const SYSTEM_PROMPT = `You are an expert Git commit planner and technical writer.

You are given the complete staged Git diff.

Your task is to decompose the staged changes into a sequence of logical,
independently applicable commits.

IMPORTANT:

1. Work from diff hunks, not merely files.
2. A file may belong to multiple commits.
3. Never assign the same hunk to multiple commits.
4. Every staged hunk must belong to exactly one commit.
5. Do not invent changes that aren't present in the diff.
6. Preserve dependencies between changes.
7. Keep commits logically atomic.
8. Prefer the smallest meaningful number of commits.
9. Do not split changes merely to create more commits.
10. Documentation, tests, refactors and unrelated configuration changes
    should normally be separated.

COMMIT MESSAGE FORMAT (most important output requirement):

Every commit subject must be a short imperative conventional-commit summary
(max 50 chars).

The commit body (returned as the "body" array) MUST follow EXACTLY this shape:

1. The FIRST element is a rich, flowing, multi-sentence paragraph (not
   telegram style) that explains the ACTUAL changes that occurred — what the
   code now does differently, the concrete behaviors/fixes/features added,
   and the meaningful outcome. Use plain English, avoid starting every
   sentence with "Added/Changed/Fixed". Describe mechanisms, conditions, and
   user-visible behavior.

2. Every REMAINING element is a "- " bullet line that lists a specific
   change or feature with enough detail to stand alone (e.g.
   "- Show Upload List based on current form state.").

Example body:

[
  "Consolidate 'UI Actions' in the 'Disbursement Order Form' into a single 'Disbursement Actions' menu for better 'Organization', and add 'Logic' to handle 'State-Dependent Buttons' such as dynamically showing 'Get Beneficiaries', 'Upload List', and 'Assign Agents' based on the current form 'State' to improve 'User Experience' and 'Workflow Progression'.",
  "- Consolidate actions into single Disbursement Actions menu.",
  "- Show Get Beneficiaries based on form state.",
  "- Show Upload List based on current form state.",
  "- Show Assign Agents based on workflow progression."
]

Rules:
- The summary paragraph must be 2-4 sentences and describe real, visible
  behavior from the diff (not "updates X").
- Keep 3-8 bullet lines for small commits, 5-12 for larger ones.
- Do NOT include "Files changed", "Why this grouping", or any other section
  headings — only the summary paragraph followed by "- " bullets.
- Do NOT list file paths in the body.

For every commit return:

- commit type (feat|fix|refactor|docs|style|test|chore|perf|ci|build|revert)
- subject (short imperative summary, max 50 chars)
- body (array of strings; FIRST = summary paragraph, REST = "- " bullets)
- overview (a SINGLE separate prose paragraph of 2-4 sentences explaining the
  actual changes in more depth — this is DISPLAY-ONLY for the UI, NOT part of
  the commit body, so it should read like a reviewer's summary, not a commit)
- ordered list of included diff hunks
- affected files (absolute-prefixed paths)

Respond ONLY with valid JSON matching this exact schema:
{
  "commits": [
    {
      "id": "1",
      "type": "refactor",
      "subject": "Consolidate Disbursement Order actions into single menu",
      "body": [
        "Consolidate 'UI Actions' in the 'Disbursement Order Form' into a single 'Disbursement Actions' menu for better 'Organization', and add 'Logic' to handle 'State-Dependent Buttons' such as dynamically showing 'Get Beneficiaries', 'Upload List', and 'Assign Agents' based on the current form 'State' to improve 'User Experience' and 'Workflow Progression'.",
        "- Consolidate actions into single Disbursement Actions menu.",
        "- Show Get Beneficiaries based on form state.",
        "- Show Upload List based on current form state.",
        "- Show Assign Agents based on workflow progression."
      ],
      "overview": "This change reorganizes the Disbursement Order Form's UI Actions into a unified menu and makes the available actions responsive to the current form state. It introduces state-dependent visibility so that Get Beneficiaries, Upload List, and Assign Agents only appear when their prerequisites are met, simplifying the workflow and reducing user error.",
      "changes": [
        {
          "file": "src/components/DisbursementOrderForm.tsx",
          "hunks": [0, 2]
        }
      ],
      "reasoning": "Groups the UI consolidation and state-dependent behavior into one atomic refactor."
    }
  ]
}

Note: hunk indices are zero-based. You must map the correct hunk index for each file.`;

/**
 * Build the prompt for generating a Pull Request title and description.
 */
export function buildPrPrompt(
  diff: string,
  commits: Array<{ subject: string; overview: string }>,
  options?: {
    branch?: string;
    baseBranch?: string;
    repoName?: string;
  }
): string {
  const parts: string[] = [];

  if (options?.repoName) parts.push(`Repository: ${options.repoName}`);
  if (options?.branch) parts.push(`Source branch: ${options.branch}`);
  if (options?.baseBranch) parts.push(`Base branch: ${options.baseBranch}`);

  parts.push(
    `You are writing a Pull Request for the changes below. The PR description must be well-styled Markdown (headers, bold, bullet lists) and MUST quote the actual diff hunks with links placeholders like [[1]](diffhunk://...) — reference where each change lives.`
  );

  parts.push(
    [
      "Use this structure:",
      '- Title: a short conventional-commit style summary, e.g. "feat: enhance invoice retrieval with document revision support".',
      '- Description: an opening prose paragraph giving a high-level summary of all changes, then grouped **bold** sections (e.g. **API Request and Pagination Improvements**) each with a bullet list and inline diffhunk links, then a closing "These changes collectively..." paragraph.'
    ].join("\n")
  );

  parts.push(`The planned commits are:\n${commits.map((c) => `- ${c.subject}: ${c.overview}`).join("\n")}`);

  parts.push(`Here is the complete diff:\n\n\`\`\`\n${diff}\n\`\`\``);

  parts.push(
    `Respond ONLY with valid JSON:\n` +
    `{\n  "title": "feat: ...",\n  "description": "\\"\\"\\"\\nYour full Markdown PR body here\\n\\"\\"\\""\n}`
  );

  return parts.join("\n\n");
}

/**
 * Build the full user prompt with instruction/sample support and the diff.
 */
export function buildUserPrompt(
  diff: string,
  maxCommits: number,
  options?: {
    instructions?: string;
    sampleMessage?: string;
    branch?: string;
    repoName?: string;
  }
): string {
  const parts: string[] = [];

  if (options?.repoName) {
    parts.push(`Repository: ${options.repoName}`);
  }
  if (options?.branch) {
    parts.push(`Branch: ${options.branch}`);
  }

  parts.push(`Maximum number of commits allowed: ${maxCommits}`);

  if (options?.instructions && options.instructions.trim()) {
    parts.push(
      `Additional instructions from the user (follow these closely):\n${options.instructions.trim()}`
    );
  }

  if (options?.sampleMessage && options.sampleMessage.trim()) {
    parts.push(
      `Sample commit message to use as a STYLE REFERENCE (match this level of detail and formatting, but write NEW content for THIS diff):\n${options.sampleMessage.trim()}`
    );
  }

  parts.push(
    `Write every commit body with a rich summary paragraph describing the ACTUAL changes, followed by "- " bullet lines, per the schema.`
  );
  parts.push(`Here is the complete staged diff:\n\n\`\`\`\n${diff}\n\`\`\``);
  parts.push(`Output ONLY the JSON commit plan per the schema.`);

  return parts.join("\n\n");
}