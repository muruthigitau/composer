/**
 * Anthropic Claude provider (Messages API).
 */

import { CompletionRequest } from "./AIProvider";
import { BaseAIProvider } from "./BaseAIProvider";
import { fetchWithRetry } from "./rateLimit";

export class ClaudeProvider extends BaseAIProvider {
  private readonly baseUrl: string;

  constructor(
    private model: string,
    private apiKey: string,
    baseUrl: string = "https://api.anthropic.com/v1",
    private label: string = "Claude"
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  protected async complete(request: CompletionRequest): Promise<string> {
    const response = await fetchWithRetry(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: 0.2,
        ...(request.system ? { system: request.system } : {}),
        messages: [{ role: "user", content: [{ type: "text", text: request.user }] }]
      })
    });

    if (!response.ok) {
      throw new Error(`${this.label} request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const content = data.content?.find((block) => block.type === "text" && block.text)?.text;
    if (!content) {
      throw new Error(`${this.label} returned an empty response`);
    }
    return content;
  }
}
