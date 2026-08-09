import * as vscode from "vscode";
import { AIProvider } from "../ai/AIProvider";
import { OllamaProvider } from "../ai/OllamaProvider";
import { OpenAIProvider } from "../ai/OpenAIProvider";
import { CommitPlan } from "../types/messages";

/**
 * AIService is a factory that creates the appropriate AI provider
 * based on the user's VS Code configuration.
 */
export class AIService {
  private provider: AIProvider;

  constructor() {
    this.provider = this.createProvider();
  }

  /**
   * Recreate the provider (e.g. when settings change).
   */
  public refreshProvider(): void {
    this.provider = this.createProvider();
  }

  private createProvider(): AIProvider {
    const config = vscode.workspace.getConfiguration("commitComposer");
    const providerName = config.get<string>("provider", "ollama");
    const model = config.get<string>("model", "qwen2.5-coder");
    const baseUrl = config.get<string>("baseUrl", "");
    const apiKey = config.get<string>("apiKey", "") || process.env.OPENAI_API_KEY || "";
    const maxCommits = config.get<number>("maxCommits", 6);

    switch (providerName) {
      case "openai":
        return new OpenAIProvider(model, apiKey, baseUrl || "https://api.openai.com/v1", maxCommits);
      case "custom":
        if (!baseUrl) {
          throw new Error("commitComposer.baseUrl is required for the 'custom' provider.");
        }
        return new OpenAIProvider(model, apiKey, baseUrl, maxCommits);
      case "ollama":
      default:
        return new OllamaProvider(model, baseUrl || "http://localhost:11434", maxCommits);
    }
  }

  /**
   * Generate a commit plan from the staged diff.
   */
  public async generatePlan(diff: string, context?: { branch?: string; repoName?: string }): Promise<CommitPlan> {
    const config = vscode.workspace.getConfiguration("commitComposer");
    const maxCommits = config.get<number>("maxCommits", 6);

    // Always recreate to pick up configuration changes
    this.refreshProvider();

    return await this.provider.generateCommitPlan({
      diff,
      maxCommits,
      branch: context?.branch,
      repoName: context?.repoName
    });
  }
}