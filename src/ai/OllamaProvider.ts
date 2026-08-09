import { AIProvider, PrContent, RepositoryContext } from "./AIProvider";
import { SYSTEM_PROMPT, buildPrPrompt, buildUserPrompt } from "./prompts";
import { CommitPlan } from "../types/messages";
import { BaseAIProvider } from "./BaseAIProvider";
import { fetchWithRetry } from "./rateLimit";

/**
 * OllamaProvider uses Ollama's local API to generate commit plans.
 * Requires Ollama running at http://localhost:11434.
 */
export class OllamaProvider extends BaseAIProvider implements AIProvider {
  constructor(
    private model: string,
    private baseUrl: string = "http://localhost:11434",
    private maxCommits: number = 6
  ) {
    super();
  }

  async generateCommitPlan(context: RepositoryContext): Promise<CommitPlan> {
    const url = `${this.baseUrl}/api/generate`;

    const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(context.diff, context.maxCommits, {
      instructions: context.instructions,
      sampleMessage: context.sampleMessage,
      branch: context.branch,
      repoName: context.repoName
    })}`;

    const response = await fetchWithRetry(url, {
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

  async generatePrContent(
    diff: string,
    commits: Array<{ subject: string; overview: string }>,
    context?: { branch?: string; baseBranch?: string; repoName?: string }
  ): Promise<PrContent> {
    const url = `${this.baseUrl}/api/generate`;
    const prompt = buildPrPrompt(diff, commits, {
      branch: context?.branch,
      baseBranch: context?.baseBranch,
      repoName: context?.repoName
    });

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0.2, num_ctx: 8192 }
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama PR request failed with status ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as { response: string };
    return this.parsePrJson(data.response);
  }
}