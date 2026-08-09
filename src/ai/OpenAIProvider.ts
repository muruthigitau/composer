import { AIProvider, PrContent, RepositoryContext } from "./AIProvider";
import { SYSTEM_PROMPT, buildPrPrompt, buildUserPrompt } from "./prompts";
import { CommitPlan } from "../types/messages";
import { BaseAIProvider } from "./BaseAIProvider";
import { fetchWithRetry } from "./rateLimit";

/**
 * OpenAIProvider uses the OpenAI Chat Completions API.
 * Also works with any OpenAI-compatible endpoint (custom baseUrl).
 */
export class OpenAIProvider extends BaseAIProvider implements AIProvider {
  constructor(
    private model: string,
    private apiKey: string,
    private baseUrl: string = "https://api.openai.com/v1",
    private maxCommits: number = 6
  ) {
    super();
  }

  async generateCommitPlan(context: RepositoryContext): Promise<CommitPlan> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildUserPrompt(context.diff, context.maxCommits, {
              instructions: context.instructions,
              sampleMessage: context.sampleMessage,
              branch: context.branch,
              repoName: context.repoName
            })
          }
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

  async generatePrContent(
    diff: string,
    commits: Array<{ subject: string; overview: string }>,
    context?: { branch?: string; baseBranch?: string; repoName?: string }
  ): Promise<PrContent> {
    const url = `${this.baseUrl}/chat/completions`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "user",
            content: buildPrPrompt(diff, commits, {
              branch: context?.branch,
              baseBranch: context?.baseBranch,
              repoName: context?.repoName
            })
          }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) {
      throw new Error(`OpenAI PR request failed: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty PR response");
    return this.parsePrJson(content);
  }

}
