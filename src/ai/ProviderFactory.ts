import { AIProvider } from "./AIProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { OllamaProvider } from "./OllamaProvider";
import { GeminiProvider } from "./GeminiProvider";
import { ClaudeProvider } from "./ClaudeProvider";
import { ProviderConfig } from "../types/provider";

/**
 * Factory that creates AI providers from a stored configuration.
 *
 * Mapping guide (all but Gemini/Claude/Ollama speak the OpenAI
 * chat-completions protocol):
 *   - openai, azure, openai-compatible, mistral, openrouter, huggingface,
 *     xai, deepseek, gitkraken, copilot -> OpenAIProvider
 *   - google                                -> GeminiProvider
 *   - anthropic                             -> ClaudeProvider
 *   - ollama                                -> OllamaProvider
 */

export class ProviderFactory {
  /**
   * Create an AI provider from a ProviderConfig.
   * Throws if the provider requires an API key or base URL that is missing.
   */
  public static create(config: ProviderConfig): AIProvider {
    const baseUrl = config.baseUrl || undefined;
    const apiKey = config.apiKey;
    const label = config.label || config.provider;

    switch (config.provider) {
      case "openai":
      case "azure":
      case "mistral":
      case "openrouter":
      case "huggingface":
      case "xai":
      case "deepseek":
      case "gitkraken":
      case "copilot":
      case "openai-compatible": {
        if (config.provider === "openai-compatible" && !baseUrl) {
          throw new Error("Base URL is required for the OpenAI-compatible provider.");
        }
        const keyOptional =
          config.provider === "gitkraken" ||
          config.provider === "copilot" ||
          config.provider === "openai-compatible";
        this.assertApiKey(label, apiKey, keyOptional);
        return new OpenAIProvider(config.model, apiKey, baseUrl, label);
      }
      case "google":
        this.assertApiKey(label, apiKey);
        return new GeminiProvider(config.model, apiKey, baseUrl, label);
      case "anthropic":
        this.assertApiKey(label, apiKey);
        return new ClaudeProvider(config.model, apiKey, baseUrl, label);
      case "ollama":
        return new OllamaProvider(config.model, baseUrl || "http://localhost:11434", label);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }


  /**
   * Test a provider connection by making a lightweight request.
   * Returns a success boolean and an error message if it fails.
   */
  public static async testConnection(config: ProviderConfig): Promise<{ success: boolean; message: string }> {
    try {
      // Validate the config creates a valid provider
      ProviderFactory.create(config);
      // Make a tiny test request
      await ProviderFactory.testFetch(config);
      return { success: true, message: `Connection to ${config.label} successful!` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  }

  private static async testFetch(config: ProviderConfig): Promise<void> {
    const baseUrl = config.baseUrl?.replace(/\/$/, "") || "";

    switch (config.provider) {
      case "openai":
      case "deepseek":
      case "openai-compatible":
      case "azure":
      case "mistral":
      case "openrouter":
      case "huggingface":
      case "xai":
      case "copilot":
        if (!baseUrl) break;
        await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${config.apiKey}` }
        });
        break;
      case "google": {
        await fetch(`${baseUrl}/models?key=${config.apiKey}`);
        break;
      }
      case "anthropic": {
        await fetch(`${baseUrl}/models`, {
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01"
          }
        });
        break;
      }
      case "ollama": {
        await fetch(`${baseUrl}/api/tags`);
        break;
      }
      case "gitkraken": {
        // GitKraken has no simple REST check; succeed by default.
        break;
      }
    }
  }

  private static assertApiKey(providerName: string, apiKey?: string, skipIfOptional = false): void {
    if (skipIfOptional) return;
    if (!apiKey || !apiKey.trim()) {
      throw new Error(
        `${providerName} requires an API key. Set it in the Commit Composer settings UI, ` +
        `the "commitComposer.apiKey" VS Code setting, or the respective environment variable ` +
        `(e.g. OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY).`
      );
    }
  }
}