import { AIProvider } from "./AIProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { OllamaProvider } from "./OllamaProvider";
import { GeminiProvider } from "./GeminiProvider";
import { ClaudeProvider } from "./ClaudeProvider";
import { DeepSeekProvider } from "./DeepSeekProvider";
import { ProviderConfig } from "../types/provider";

/**
 * Factory that creates AI providers based on configuration.
 *
 * Mapping guide (most use the OpenAI-compatible chat completions protocol):
 *   - openai, azure, openai-compatible, mistral, openrouter,
 *     huggingface, xai, gitkraken, copilot -> OpenAIProvider
 *   - google                                  -> GeminiProvider
 *   - anthropic                               -> ClaudeProvider
 *   - deepseek                               -> DeepSeekProvider
 *   - ollama                                 -> OllamaProvider
 */
export class ProviderFactory {
  /**
   * Create an AI provider from a ProviderConfig.
   * Throws if the provider requires an API key or base URL that is missing.
   */
  public static create(config: ProviderConfig): AIProvider {
    const baseUrl = config.baseUrl || undefined;
    const apiKey = config.apiKey;

    switch (config.provider) {
      case "openai":
      case "azure":
      case "openai-compatible":
      case "mistral":
      case "openrouter":
      case "huggingface":
      case "xai":
      case "gitkraken":
      case "copilot":
        if (config.provider === "openai-compatible" && !baseUrl) {
          throw new Error("Base URL is required for the OpenAI-compatible provider.");
        }
        // GitKraken/Copilot use an OpenAI-compatible endpoint; key optional.
        this.assertApiKey(
          config.label || "Provider",
          apiKey,
          config.provider === "gitkraken" || config.provider === "copilot" || config.provider === "openai-compatible"
        );
        return new OpenAIProvider(config.model, apiKey, baseUrl, 6);
      case "google":
        this.assertApiKey("Google Gemini", apiKey);
        return new GeminiProvider(config.model, apiKey, baseUrl, 6);
      case "anthropic":
        this.assertApiKey("Anthropic", apiKey);
        return new ClaudeProvider(config.model, apiKey, baseUrl, 6);
      case "deepseek":
        this.assertApiKey("DeepSeek", apiKey);
        return new DeepSeekProvider(config.model, apiKey, baseUrl, 6);
      case "ollama":
        return new OllamaProvider(config.model, baseUrl || "http://localhost:11434", 6);
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