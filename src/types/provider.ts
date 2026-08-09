/**
 * Supported AI provider types.
 */
export type ProviderType =
  | "gitkraken"
  | "copilot"
  | "anthropic"
  | "google"
  | "openai"
  | "azure"
  | "mistral"
  | "openai-compatible"
  | "ollama"
  | "openrouter"
  | "huggingface"
  | "deepseek"
  | "xai";

/**
 * A single provider configuration entry.
 */
export interface ProviderConfig {
  /** Provider type key. */
  provider: ProviderType;
  /** Display label, e.g. "Google". */
  label: string;
  /** API base URL (empty uses provider default). */
  baseUrl: string;
  /** API key (empty uses environment variable). */
  apiKey: string;
  /** Selected model name. */
  model: string;
  /** Available models to choose from (when not user-defined). */
  models: string[];
  /** Whether the base URL can be customized by the user. */
  allowCustomBaseUrl: boolean;
  /** Whether the API key is required. */
  requiresApiKey: boolean;
  /** Recommended model name, if any. */
  recommendedModel?: string;
}

/**
 * Default configuration for each provider.
 * Keys are stored here as empty; secrets should be set by the user.
 */
export const DEFAULT_PROVIDERS: Record<ProviderType, Omit<ProviderConfig, "apiKey" | "model">> = {
  gitkraken: {
    provider: "gitkraken",
    label: "GitKraken AI",
    baseUrl: "",
    models: ["GitKraken AI"],
    allowCustomBaseUrl: false,
    requiresApiKey: false
  },
  copilot: {
    provider: "copilot",
    label: "GitHub Copilot",
    baseUrl: "",
    models: ["Copilot"],
    allowCustomBaseUrl: false,
    requiresApiKey: false
  },
  anthropic: {
    provider: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest"
    ],
    recommendedModel: "claude-3-5-sonnet-latest",
    allowCustomBaseUrl: false,
    requiresApiKey: true
  },
  google: {
    provider: "google",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite"
    ],
    recommendedModel: "gemini-3-flash-preview",
    allowCustomBaseUrl: true,
    requiresApiKey: true
  },
  openai: {
    provider: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo",
      "gpt-3.5-turbo"
    ],
    recommendedModel: "gpt-4o-mini",
    allowCustomBaseUrl: false,
    requiresApiKey: true
  },
  azure: {
    provider: "azure",
    label: "Azure OpenAI",
    baseUrl: "",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo",
      "gpt-35-turbo"
    ],
    recommendedModel: "gpt-4o-mini",
    allowCustomBaseUrl: true,
    requiresApiKey: true
  },
  mistral: {
    provider: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "codestral-latest"
    ],
    recommendedModel: "mistral-small-latest",
    allowCustomBaseUrl: false,
    requiresApiKey: true
  },
  "openai-compatible": {
    provider: "openai-compatible",
    label: "OpenAI-Compatible",
    baseUrl: "",
    models: [],
    allowCustomBaseUrl: true,
    requiresApiKey: false
  },
  ollama: {
    provider: "ollama",
    label: "Ollama (Local)",
    baseUrl: "http://localhost:11434",
    models: ["qwen2.5-coder", "llama3.1", "codellama"],
    recommendedModel: "qwen2.5-coder",
    allowCustomBaseUrl: true,
    requiresApiKey: false
  },
  openrouter: {
    provider: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "google/gemini-3-flash",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "meta-llama/llama-3.1-70b"
    ],
    recommendedModel: "google/gemini-3-flash",
    allowCustomBaseUrl: false,
    requiresApiKey: true
  },
  huggingface: {
    provider: "huggingface",
    label: "Hugging Face",
    baseUrl: "https://api-inference.huggingface.co/v1",
    models: [
      "microsoft/phi-3-mini",
      "meta-llama/Meta-Llama-3-8B-Instruct",
      "mistralai/Mistral-7B-Instruct"
    ],
    recommendedModel: "microsoft/phi-3-mini",
    allowCustomBaseUrl: true,
    requiresApiKey: true
  },
  deepseek: {
    provider: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner"
    ],
    recommendedModel: "deepseek-v4-flash",
    allowCustomBaseUrl: false,
    requiresApiKey: true
  },
  xai: {
    provider: "xai",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    models: [
      "grok-3",
      "grok-3-mini",
      "grok-2-latest",
      "grok-2-mini"
    ],
    recommendedModel: "grok-3",
    allowCustomBaseUrl: false,
    requiresApiKey: true
  }
};