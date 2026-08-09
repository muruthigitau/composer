import * as vscode from "vscode";
import { AIProvider } from "../ai/AIProvider";
import { ProviderFactory } from "../ai/ProviderFactory";
import { CommitPlan } from "../types/messages";
import { DEFAULT_PROVIDERS, ProviderConfig, ProviderType } from "../types/provider";

/**
 * AIService is a factory that creates the appropriate AI provider
 * based on the user's VS Code configuration and provider settings.
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

  /**
   * Create an AI provider from the current configuration.
   */
  private createProvider(): AIProvider {
    const config = this.getProviderConfig();
    return ProviderFactory.create(config);
  }

  /**
   * Load the current provider configuration from VS Code settings.
   * Falls back to environment variables for API keys.
   */
  public getProviderConfig(): ProviderConfig {
    const config = vscode.workspace.getConfiguration("commitComposer");
    const provider = config.get<ProviderType>("provider", "ollama");
    const defaults = DEFAULT_PROVIDERS[provider];

    const apiKey =
      config.get<string>(`${provider}ApiKey`, "") ||
      config.get<string>("apiKey", "") ||
      this.getEnvApiKey(provider);

    return {
      provider,
      label: defaults.label,
      baseUrl: config.get<string>(`${provider}BaseUrl`, "") || defaults.baseUrl,
      apiKey,
      model: config.get<string>(`${provider}Model`, "") || defaults.models[0] || "",
      models: defaults.models,
      allowCustomBaseUrl: defaults.allowCustomBaseUrl,
      requiresApiKey: defaults.requiresApiKey
    };
  }

  /**
   * Save provider configuration to VS Code settings.
   */
  public async saveProviderConfig(config: ProviderConfig): Promise<void> {
    const vsConfig = vscode.workspace.getConfiguration("commitComposer");
    const saveApiKeys = vsConfig.get<boolean>("saveApiKeys", true);

    await vsConfig.update("provider", config.provider, vscode.ConfigurationTarget.Global);
    await vsConfig.update(`${config.provider}Model`, config.model, vscode.ConfigurationTarget.Global);

    if (config.allowCustomBaseUrl || config.baseUrl) {
      await vsConfig.update(`${config.provider}BaseUrl`, config.baseUrl, vscode.ConfigurationTarget.Global);
    }

    if (saveApiKeys && config.apiKey) {
      await vsConfig.update(`${config.provider}ApiKey`, config.apiKey, vscode.ConfigurationTarget.Global);
    }

    // Refresh the provider with the new settings
    this.refreshProvider();
  }

  /**
   * Test the connection to a provider.
   */
  public async testConnection(config: ProviderConfig): Promise<{ success: boolean; message: string }> {
    return ProviderFactory.testConnection(config);
  }

  /**
   * Return a map of every configured provider and whether an API key is
   * already stored for it (either in VS Code settings or via env var).
   * Used by the provider wizard to skip the API-key step when a key exists.
   */
  public getProviderApiKeyStatus(): Record<string, boolean> {
    const vsConfig = vscode.workspace.getConfiguration("commitComposer");
    const status: Record<string, boolean> = {};

    for (const p of Object.keys(DEFAULT_PROVIDERS) as ProviderType[]) {
      const stored =
        vsConfig.get<string>(`${p}ApiKey`, "") ||
        vsConfig.get<string>("apiKey", "") ||
        this.getEnvApiKey(p);
      status[p] = !!stored && stored.trim().length > 0;
    }

    return status;
  }

  /**
   * Get the environment variable API key for a provider.
   */
  private getEnvApiKey(provider: ProviderType): string {
    switch (provider) {
      case "openai":
      case "azure":
      case "openai-compatible":
        return process.env.OPENAI_API_KEY || "";
      case "google":
        return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
      case "anthropic":
      case "copilot":
        return process.env.ANTHROPIC_API_KEY || "";
      case "deepseek":
        return process.env.DEEPSEEK_API_KEY || "";
      case "mistral":
        return process.env.MISTRAL_API_KEY || "";
      case "openrouter":
        return process.env.OPENROUTER_API_KEY || "";
      case "huggingface":
        return process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY || "";
      case "xai":
        return process.env.XAI_API_KEY || process.env.GROK_API_KEY || "";
      default:
        return "";
    }
  }

  /**
   * Generate a commit plan from the staged diff.
   */
  public async generatePlan(
    diff: string,
    context?: {
      branch?: string;
      repoName?: string;
      instructions?: string;
      sampleMessage?: string;
    }
  ): Promise<CommitPlan> {
    const config = vscode.workspace.getConfiguration("commitComposer");
    const maxCommits = config.get<number>("maxCommits", 6);

    // Always recreate to pick up configuration changes
    this.refreshProvider();

    return await this.provider.generateCommitPlan({
      diff,
      maxCommits,
      branch: context?.branch,
      repoName: context?.repoName,
      instructions: context?.instructions,
      sampleMessage: context?.sampleMessage
    });
  }

  /**
   * Generate a Pull Request title + Markdown description for the diff.
   */
  public async generatePrContent(
    diff: string,
    commits: Array<{ subject: string; overview: string }>,
    context?: {
      branch?: string;
      baseBranch?: string;
      repoName?: string;
    }
  ): Promise<{ title: string; description: string }> {
    this.refreshProvider();
    return await this.provider.generatePrContent(diff, commits, context);
  }
}