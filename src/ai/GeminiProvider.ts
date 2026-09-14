/**
 * Google Gemini provider (`generateContent` API).
 */

import { CompletionRequest } from "./AIProvider";
import { BaseAIProvider } from "./BaseAIProvider";
import { fetchWithRetry } from "./rateLimit";

export class GeminiProvider extends BaseAIProvider {
  private readonly baseUrl: string;

  constructor(
    private model: string,
    private apiKey: string,
    baseUrl: string = "https://generativelanguage.googleapis.com/v1beta",
    private label: string = "Gemini"
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  protected async complete(request: CompletionRequest): Promise<string> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const generationConfig: Record<string, unknown> = { temperature: 0.2 };
    if (request.maxTokens) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (request.json) {
      generationConfig.responseMimeType = "application/json";
    }

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig
      })
    });

    if (!response.ok) {
      throw new Error(`${this.label} request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        finishReason?: string;
      }>;
    };

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    // Thinking models return their reasoning as parts flagged `thought`; mixing
    // those into the answer corrupts the JSON, so they are ignored unless the
    // response contains nothing else.
    const answerParts = parts.filter((part) => !part.thought && part.text);
    const selected = answerParts.length > 0 ? answerParts : parts;
    const content = selected
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!content) {
      const reason = candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : "";
      throw new Error(`${this.label} returned an empty response${reason}`);
    }
    return content;
  }
}
