import { AIProvider, RepositoryContext } from "./AIProvider";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { CommitPlan } from "../types/messages";

/**
 * OllamaProvider uses Ollama's local API to generate commit plans.
 * Requires Ollama running at http://localhost:11434.
 */
export class OllamaProvider implements AIProvider {
  constructor(
    private model: string,
    private baseUrl: string = "http://localhost:11434",
    private maxCommits: number = 6
  ) {}

  async generateCommitPlan(context: RepositoryContext): Promise<CommitPlan> {
    const url = `${this.baseUrl}/api/generate`;

    const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(context.diff, context.maxCommits)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.2,
          num_ctx: 8192
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { response: string };
    return this.parsePlan(data.response);
  }

  /**
   * Parse and validate the AI response into a CommitPlan.
   * Handles common issues like markdown code fences around JSON.
   */
  private parsePlan(rawResponse: string): CommitPlan {
    // Trim and extract JSON if wrapped in code fences
    let clean = rawResponse.trim();

    const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      clean = fenceMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(clean) as CommitPlan;

      // Validate structure
      if (!parsed || !Array.isArray(parsed.commits)) {
        throw new Error("AI response missing 'commits' array");
      }

      // Normalize and validate each commit
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
        throw new Error(`Failed to parse AI response as JSON: ${error.message}\nRaw: ${clean.substring(0, 500)}`);
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