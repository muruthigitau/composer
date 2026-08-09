import * as path from "path";
import * as vscode from "vscode";
import { AIProvider } from "../ai/AIProvider";
import { ProviderFactory } from "../ai/ProviderFactory";
import { CommitPlan } from "../types/messages";
import { DEFAULT_PROVIDERS, ProviderConfig, ProviderType } from "../types/provider";
import { ConfigStore } from "./ConfigStore";

/**
 * AIService is a factory that creates the appropriate AI provider
 * based on the user's VS Code configuration and provider settings.
 *
 * The provider config is persisted to a JSON file (ConfigStore) and re-read
 * from that file on every call, guaranteeing the selected model/provider is
 * always used even if VS Code settings updates race with the webview.
 */
export class AIService {
  private provider: AIProvider;
  private readonly configStore: ConfigStore;

  constructor(storagePath?: string) {
    // If no dedicated storage path is provided, derive one from the extension URI.
    if (storagePath) {
      this.configStore = new ConfigStore(storagePath);
    } else {
      const ext = vscode.extensions.getExtension("muruthigitau.commit-composer");
      const base = ext?.extensionUri?.fsPath
        ? path.join(path.dirname(ext.extensionUri.fsPath), ".config")
        : (require("os") as typeof import("os")).tmpdir();
      this.configStore = new ConfigStore(base);
    }
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
   * Load the current provider configuration.
   *
   * Source of truth is the persisted config FILE (written by saveProviderConfig).
   * If the file has no entry, fall back to VS Code settings, then to defaults.
   */
  public getProviderConfig(): ProviderConfig {
    const fileConfig = this.configStore.read();

    // 1) Prefer the file (most reliable / always exactly what was saved).
    if (fileConfig) {
      const defaults = DEFAULT_PROVIDERS[fileConfig.provider] || DEFAULT_PROVIDERS.ollama;
      return {
        ...fileConfig,
        label: fileConfig.label || defaults.label,
        models: fileConfig.models?.length ? fileConfig.models : defaults.models,
        allowCustomBaseUrl:
          fileConfig.allowCustomBaseUrl ?? defaults.allowCustomBaseUrl,
        requiresApiKey: fileConfig.requiresApiKey ?? defaults.requiresApiKey,
        // Merge persisted config with any env var key if none was saved.
        apiKey: fileConfig.apiKey || this.getEnvApiKey(fileConfig.provider)
      };
    }

    // 2) Fallback: VS Code settings.
    const vsConfig = vscode.workspace.getConfiguration("commitComposer");
    const provider = vsConfig.get<ProviderType>("provider", "ollama");
    const defaults = DEFAULT_PROVIDERS[provider];
    const apiKey =
      vsConfig.get<string>(`${provider}ApiKey`, "") ||
      vsConfig.get<string>("apiKey", "") ||
      this.getEnvApiKey(provider);

    return {
      provider,
      label: defaults.label,
      baseUrl: vsConfig.get<string>(`${provider}BaseUrl`, "") || defaults.baseUrl,
      apiKey,
      model: vsConfig.get<string>(`${provider}Model`, "") || defaults.models[0] || "",
      models: defaults.models,
      allowCustomBaseUrl: defaults.allowCustomBaseUrl,
      requiresApiKey: defaults.requiresApiKey
    };
  }

  /**
   * Save provider configuration to BOTH the config file (source of truth)
   * and VS Code settings (for compatibility/documentation).
   */
  public async saveProviderConfig(config: ProviderConfig): Promise<void> {
    // 0) Preserve the existing API key if the incoming config left it empty
    //    (the webview does not expose stored keys back to the UI, so an empty
    //    key here must NOT erase the one already saved in the file/settings).
    let apiKeyToSave = config.apiKey;
    if (!apiKeyToSave || !apiKeyToSave.trim()) {
      const existing = this.configStore.read();
      // Prefer the provider-specific VS Code setting (correct per provider),
      // then the persisted file key (only if it belongs to the SAME provider),
      // then an environment variable.
      const storedKey =
        vscode.workspace
          .getConfiguration("commitComposer")
          .get<string>(`${config.provider}ApiKey`, "") ||
        (existing?.provider === config.provider ? existing.apiKey : "") ||
        this.getEnvApiKey(config.provider);
      if (storedKey) {
        apiKeyToSave = storedKey;
      }
      config = { ...config, apiKey: apiKeyToSave };
    }

    // 1) Persist to the file FIRST — this is what every subsequent call reads.
    await this.configStore.write(config);

    // 2) Also mirror to VS Code global settings for compatibility.
    const vsConfig = vscode.workspace.getConfiguration("commitComposer");
    const saveApiKeys = vsConfig.get<boolean>("saveApiKeys", true);

    await vsConfig.update("provider", config.provider, vscode.ConfigurationTarget.Global);
    await vsConfig.update(`${config.provider}Model`, config.model, vscode.ConfigurationTarget.Global);

    if (config.allowCustomBaseUrl || config.baseUrl) {
      await vsConfig.update(`${config.provider}BaseUrl`, config.baseUrl, vscode.ConfigurationTarget.Global);
    }

    if (saveApiKeys && apiKeyToSave) {
      await vsConfig.update(`${config.provider}ApiKey`, apiKeyToSave, vscode.ConfigurationTarget.Global);
    }

    // 3) Refresh the provider with the new settings.
    //    NOTE: For key-requiring providers with an empty key, ProviderFactory
    //    throws. We must NOT let that propagate — the config FILE + settings
    //    have already been written successfully and are the source of truth.
    //    The throw would suppress the "settings saved" confirmation.
    try {
      this.refreshProvider();
    } catch {
      // Provider creation will re-validate on the next real AI call; ignore.
    }
  }

  /**
   * Test the connection to a provider.
   */
  public async testConnection(config: ProviderConfig): Promise<{ success: boolean; message: string }> {
    return ProviderFactory.testConnection(config);
  }

  /**
   * Return a map of every configured provider and whether an API key is
   * already stored for it (either in the config file, VS Code settings,
   * or via env var). Used by the provider wizard to skip the API-key step
   * when a key exists.
   */
  public getProviderApiKeyStatus(): Record<string, boolean> {
    const vsConfig = vscode.workspace.getConfiguration("commitComposer");
    const status: Record<string, boolean> = {};
    const fileConfig = this.configStore.read();

    for (const p of Object.keys(DEFAULT_PROVIDERS) as ProviderType[]) {
      // File store has the key for the currently saved provider.
      const fileKey = fileConfig?.provider === p ? fileConfig.apiKey : "";
      const stored =
        fileKey ||
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
    const vsConfig = vscode.workspace.getConfiguration("commitComposer");
    const maxCommits = vsConfig.get<number>("maxCommits", 6);

    // Always recreate to pick up the latest persisted config (the file).
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