/**
 * Chat Completions provider.
 *
 * Used directly for OpenAI, Azure OpenAI, Mistral, OpenRouter, Hugging Face,
 * xAI, DeepSeek, GitKraken AI, GitHub Copilot and any OpenAI-compatible
 * endpoint — they all speak the same `/chat/completions` protocol.
 *
 * OpenAI-compatible endpoints differ in small but breaking ways, so response
 * handling is deliberately defensive:
 *  - `content` may be a string or an array of text parts,
 *  - reasoning models return the answer in `reasoning_content`/`reasoning`,
 *  - some gateways return an empty `content` when JSON mode is unsupported, so
 *    a second attempt is made without `response_format`,
 *  - `finish_reason: length` means the answer was cut off by the output limit.
 */

import { CompletionRequest } from "./AIProvider";
import { BaseAIProvider } from "./BaseAIProvider";
import { RetryOptions, fetchWithRetry } from "./rateLimit";

/** A single chat completion choice. */
interface ChatChoice {
  finish_reason?: string;
  text?: string;
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
    reasoning_content?: string;
    reasoning?: string;
  };
}

/** Shape of a chat-completions response we care about. */
interface ChatCompletionResponse {
  choices?: ChatChoice[];
  error?: { message?: string };
}

/** Raised when the endpoint answered but produced no usable text. */
class EmptyResponseError extends Error {}

export class OpenAIProvider extends BaseAIProvider {
  constructor(
    private model: string,
    private apiKey: string,
    private baseUrl: string = "https://api.openai.com/v1",
    private label: string = "Provider",
    private retryOptions?: RetryOptions
  ) {
    super();
  }

  protected async complete(request: CompletionRequest): Promise<string> {
    // Reasoning models reject `response_format`, so never ask for it there —
    // they are instructed to answer with JSON by the prompt instead.
    const wantsJson = Boolean(request.json) && this.supportsJsonMode();

    try {
      return await this.request(request, wantsJson);
    } catch (error) {
      // JSON mode is the most common reason an OpenAI-compatible endpoint
      // returns an empty body. Retry once without it before giving up.
      if (!wantsJson || !(error instanceof EmptyResponseError)) {
        throw error;
      }
      return await this.request(request, false);
    }
  }

  /** Whether this model accepts the `response_format: json_object` option. */
  private supportsJsonMode(): boolean {
    return !/(reason|^o\d)/i.test(this.model);
  }

  /** Perform one HTTP attempt and return the normalized text content. */
  private async request(request: CompletionRequest, useJsonMode: boolean): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    messages.push({ role: "user", content: request.user });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.2
    };
    if (request.maxTokens) {
      body.max_tokens = request.maxTokens;
    }
    if (useJsonMode) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify(body)
      },
      this.retryOptions
    );

    if (!response.ok) {
      throw new Error(`${this.label} request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    const content = extractContent(choice);
    if (!content) {
      throw new EmptyResponseError(
        describeEmptyResponse(this.label, this.model, data, choice?.finish_reason, useJsonMode)
      );
    }

    return content;
  }
}

/** Pull text out of the many shapes a chat completion may use. */
function extractContent(choice: ChatChoice | undefined): string {
  const message = choice?.message;

  if (typeof message?.content === "string" && message.content.trim()) {
    return message.content;
  }
  if (Array.isArray(message?.content)) {
    const joined = message.content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (joined) {
      return joined;
    }
  }

  // Reasoning models (DeepSeek reasoner, some gateways) put the only usable
  // text here.
  const reasoning = (message?.reasoning_content || message?.reasoning || "").trim();
  if (reasoning) {
    return reasoning;
  }

  return (choice?.text || "").trim();
}

/** Build an actionable error message for an empty response. */
function describeEmptyResponse(
  label: string,
  model: string,
  data: ChatCompletionResponse,
  finishReason: string | undefined,
  useJsonMode: boolean
): string {
  const providerError = data.error?.message ? ` Provider said: ${data.error.message}` : "";
  const reason = finishReason || "unknown";

  if (reason === "length") {
    return (
      `${label} hit its output token limit before answering (model: ${model}). ` +
      "Reduce the number of staged files, or switch to a model with a larger output limit." +
      providerError
    );
  }
  if (reason === "content_filter") {
    return `${label} blocked the response with a content filter (model: ${model}).${providerError}`;
  }
  if (useJsonMode) {
    return `${label} returned no usable content in JSON mode (model: ${model}, finish_reason: ${reason}).${providerError}`;
  }

  return (
    `${label} returned an empty response (model: ${model}, finish_reason: ${reason}).${providerError} ` +
    `Response: ${JSON.stringify(data).slice(0, 300)}`
  );
}
