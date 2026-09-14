/**
 * Ollama provider for fully local, offline generation.
 */

import { CompletionRequest } from "./AIProvider";
import { BaseAIProvider } from "./BaseAIProvider";
import { fetchWithRetry } from "./rateLimit";

export class OllamaProvider extends BaseAIProvider {
  constructor(
    private model: string,
    private baseUrl: string = "http://localhost:11434",
    private label: string = "Ollama"
  ) {
    super();
  }

  protected async complete(request: CompletionRequest): Promise<string> {
    const prompt = request.system ? `${request.system}\n\n${request.user}` : request.user;

    const response = await fetchWithRetry(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        ...(request.json ? { format: "json" } : {}),
        options: {
          temperature: 0.2,
          num_ctx: 8192,
          ...(request.maxTokens ? { num_predict: request.maxTokens } : {})
        }
      })
    });

    if (!response.ok) {
      throw new Error(`${this.label} request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as { response?: string };
    if (!data.response) {
      throw new Error(`${this.label} returned an empty response`);
    }
    return data.response;
  }
}
