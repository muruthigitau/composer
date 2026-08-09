import { AIProvider, PrContent, RepositoryContext } from "./AIProvider";
import { SYSTEM_PROMPT, buildPrPrompt, buildUserPrompt } from "./prompts";
import { CommitPlan } from "../types/messages";
import { BaseAIProvider } from "./BaseAIProvider";
import { fetchWithRetry } from "./rateLimit";

/**
 * GeminiProvider uses Google's Generative Language API.
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 */
export class GeminiProvider extends BaseAIProvider implements AIProvider {
  private baseUrl: string;

  constructor(
    private model: string,
    private apiKey: string,
    baseUrl: string = "https://generativelanguage.googleapis.com/v1beta",
    private maxCommits: number = 6
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async generateCommitPlan(context: RepositoryContext): Promise<CommitPlan> {
    const contents = [
      {
        role: "user",
        parts: [{ text: SYSTEM_PROMPT }]
      },
      {
        role: "user",
        parts: [
          {
            text: buildUserPrompt(context.diff, context.maxCommits, {
              instructions: context.instructions,
              sampleMessage: context.sampleMessage,
              branch: context.branch,
              repoName: context.repoName
            })
          }
        ]
      }
    ];

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini request failed with status ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error("Gemini returned empty response");
    }

    return this.parsePlan(content);
  }

  async generatePrContent(
    diff: string,
    commits: Array<{ subject: string; overview: string }>,
    context?: { branch?: string; baseBranch?: string; repoName?: string }
  ): Promise<PrContent> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildPrPrompt(diff, commits, {
                  branch: context?.branch,
                  baseBranch: context?.baseBranch,
                  repoName: context?.repoName
                })
              }
            ]
          }
        ],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) {
      throw new Error(`Gemini PR request failed: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("Gemini returned empty PR response");
    return this.parsePrJson(content);
  }
}
