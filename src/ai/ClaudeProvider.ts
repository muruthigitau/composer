import { AIProvider, PrContent, RepositoryContext } from "./AIProvider";
import { SYSTEM_PROMPT, buildPrPrompt, buildUserPrompt } from "./prompts";
import { CommitPlan } from "../types/messages";
import { BaseAIProvider } from "./BaseAIProvider";

/**
 * ClaudeProvider uses Anthropic's Messages API.
 * Endpoint: https://api.anthropic.com/v1/messages
 */
export class ClaudeProvider extends BaseAIProvider implements AIProvider {
  private baseUrl: string;

  constructor(
    private model: string,
    private apiKey: string,
    baseUrl: string = "https://api.anthropic.com/v1",
    private maxCommits: number = 6
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async generateCommitPlan(context: RepositoryContext): Promise<CommitPlan> {
    const url = `${this.baseUrl}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildUserPrompt(context.diff, context.maxCommits, {
                  instructions: context.instructions,
                  sampleMessage: context.sampleMessage,
                  branch: context.branch,
                  repoName: context.repoName
                })
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude request failed with status ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const textContent = data.content?.find((block) => block.type === "text" && block.text);
    const content = textContent?.text;
    if (!content) {
      throw new Error("Claude returned empty response");
    }

    return this.parsePlan(content);
  }

  async generatePrContent(
    diff: string,
    commits: Array<{ subject: string; overview: string }>,
    context?: { branch?: string; baseBranch?: string; repoName?: string }
  ): Promise<PrContent> {
    const url = `${this.baseUrl}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildPrPrompt(diff, commits, {
                  branch: context?.branch,
                  baseBranch: context?.baseBranch,
                  repoName: context?.repoName
                })
              }
            ]
          }
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`Claude PR request failed: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const textContent = data.content?.find((block) => block.type === "text" && block.text);
    const content = textContent?.text;
    if (!content) throw new Error("Claude returned empty PR response");
    return this.parsePrJson(content);
  }
}
