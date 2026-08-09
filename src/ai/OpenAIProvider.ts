import { AIProvider, RepositoryContext } from "./AIProvider";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { CommitPlan } from "../types/messages";

/**
 * OpenAIProvider uses the OpenAI Chat Completions API.
 * Also works with any OpenAI-compatible endpoint (custom baseUrl).
 */
export class OpenAIProvider implements AIProvider {
  constructor(
    private model: string,
    private apiKey: string,
    private baseUrl: string = "https://api.openai.com/v1",
    private maxCommits: number = 6
  ) {}

  async generateCommitPlan(context: RepositoryContext): Promise<CommitPlan> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(context.diff, context.maxCommits) }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI request failed with status ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned empty response");
    }

    return this.parsePlan(content);
  }

  private parsePlan(rawResponse: string): CommitPlan {
    let clean = rawResponse.trim();

    const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      clean = fenceMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(clean) as CommitPlan;

      if (!parsed || !Array.isArray(parsed.commits)) {
        throw new Error("AI response missing 'commits' array");
      }

      parsed.commits = parsed.commits.map((commit, index) => ({
        id: commit.id || String(index + 1),
        type: this.normalizeType(commit.type),
        subject: commit.subject || "Untitled commit",
        body: Array.isArray(commit.body) ? commit.body.map(String) : [],
        changes: Array.isArray(commit.changes)
          ? commit.changes.map((change: any) => ({
              file: change.file || "",
              hunks: Array.isArray(change.hunks) ? change.hunks.map(Number) : []
            }))
          : [],
        reasoning: commit.reasoning || undefined
      }));

      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse AI response as JSON: ${error.message}`);
      }
      throw error;
    }
  }

  private normalizeType(type: string): string {
    const validTypes = [
      "feat",
      "fix",
      "refactor",
      "docs",
      "style",
      "test",
      "chore",
      "perf",
      "ci",
      "build",
      "revert"
    ];
    const lower = (type || "").trim().toLowerCase();
    return validTypes.includes(lower) ? lower : "chore";
  }
}