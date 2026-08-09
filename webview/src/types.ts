/**
 * Shared types for the webview, mirroring the extension host types.
 */

export interface DiffHunk {
  hunkIndex: number;
  header: string;
  content: string;
  file: string;
}

export interface Change {
  file: string;
  hunks: number[];
}

export interface CommitGroup {
  id: string;
  type: string;
  subject: string;
  body: string[];
  changes: Change[];
  reasoning?: string;
}

export interface CommitPlan {
  commits: CommitGroup[];
}

export interface StagedChangeSummary {
  fileCount: number;
  additions: number;
  deletions: number;
  files: string[];
}

export interface FileDiff {
  path: string;
  status: "ADDED" | "MODIFIED" | "DELETED";
  additions: number;
  deletions: number;
  diffText: string;
}

/**
 * UI layer: a draft commit shown in the left timeline.
 */
export interface DraftCommit {
  id: string;
  type: string;
  subject: string;
  overview: string;
  files: FileDiff[];
  /** A single prose paragraph explaining what changed & why (display only, NOT part of the commit). */
  aiOverview?: string;
}

/**
 * UI layer: complete plan of draft commits.
 */
export interface DraftCommitPlan {
  commits: DraftCommit[];
  summary: string;
}

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

export interface ProviderConfig {
  provider: ProviderType;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  allowCustomBaseUrl: boolean;
  requiresApiKey: boolean;
  recommendedModel?: string;
}

export const PROVIDER_OPTIONS: { provider: ProviderType; label: string }[] = [
  { provider: "gitkraken", label: "GitKraken AI" },
  { provider: "copilot", label: "GitHub Copilot" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "google", label: "Google Gemini" },
  { provider: "openai", label: "OpenAI" },
  { provider: "azure", label: "Azure OpenAI" },
  { provider: "mistral", label: "Mistral AI" },
  { provider: "openai-compatible", label: "OpenAI-Compatible" },
  { provider: "ollama", label: "Ollama (Local)" },
  { provider: "openrouter", label: "OpenRouter" },
  { provider: "huggingface", label: "Hugging Face" },
  { provider: "deepseek", label: "DeepSeek" },
  { provider: "xai", label: "xAI (Grok)" },
];

export interface ProviderDefaults {
  label: string;
  baseUrl: string;
  model: string;
  models: string[];
  allowCustomBaseUrl: boolean;
  requiresApiKey: boolean;
  recommendedModel?: string;
}

export const PROVIDER_DEFAULTS: Record<ProviderType, ProviderDefaults> = {
  gitkraken: {
    label: "GitKraken AI",
    baseUrl: "",
    model: "GitKraken AI",
    models: ["GitKraken AI"],
    allowCustomBaseUrl: false,
    requiresApiKey: false,
  },
  copilot: {
    label: "GitHub Copilot",
    baseUrl: "",
    model: "Copilot",
    models: ["Copilot"],
    allowCustomBaseUrl: false,
    requiresApiKey: false,
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-latest",
    models: [
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest",
    ],
    allowCustomBaseUrl: false,
    requiresApiKey: true,
  },
  google: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.1-flash-lite",
    models: [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
    allowCustomBaseUrl: true,
    requiresApiKey: true,
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    allowCustomBaseUrl: false,
    requiresApiKey: true,
  },
  azure: {
    label: "Azure OpenAI",
    baseUrl: "",
    model: "gpt-4o-mini",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-35-turbo"],
    allowCustomBaseUrl: true,
    requiresApiKey: true,
  },
  mistral: {
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "codestral-latest",
    ],
    allowCustomBaseUrl: false,
    requiresApiKey: true,
  },
  "openai-compatible": {
    label: "OpenAI-Compatible",
    baseUrl: "",
    model: "",
    models: [],
    allowCustomBaseUrl: true,
    requiresApiKey: false,
  },
  ollama: {
    label: "Ollama (Local)",
    baseUrl: "http://localhost:11434",
    model: "qwen2.5-coder",
    models: ["qwen2.5-coder", "llama3.1", "codellama"],
    allowCustomBaseUrl: true,
    requiresApiKey: false,
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-3-flash",
    models: [
      "google/gemini-3-flash",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "meta-llama/llama-3.1-70b",
    ],
    allowCustomBaseUrl: false,
    requiresApiKey: true,
  },
  huggingface: {
    label: "Hugging Face",
    baseUrl: "https://api-inference.huggingface.co/v1",
    model: "microsoft/phi-3-mini",
    models: [
      "microsoft/phi-3-mini",
      "meta-llama/Meta-Llama-3-8B-Instruct",
      "mistralai/Mistral-7B-Instruct",
    ],
    allowCustomBaseUrl: true,
    requiresApiKey: true,
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    models: [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ],
    allowCustomBaseUrl: false,
    requiresApiKey: true,
  },
  xai: {
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-3",
    models: ["grok-3", "grok-3-mini", "grok-2-latest", "grok-2-mini"],
    allowCustomBaseUrl: false,
    requiresApiKey: true,
  },
};

export type WebviewToExtensionMessage =
  | { command: "loadStaged" }
  | { command: "reloadChanges" }
  | {
      command: "generatePlan";
      prompt?: string;
      model?: string;
      instructions?: string;
      sampleMessage?: string;
    }
  | { command: "regenerateSingle"; commitId: string; prompt?: string }
  | { command: "executeCommits"; plan: DraftCommitPlan }
  | { command: "getProviderConfig" }
  | { command: "saveProviderConfig"; config: ProviderConfig }
  | { command: "testProviderConnection"; config: ProviderConfig }
  | {
      command: "promptApiKey";
      provider: string;
      label: string;
      requiresApiKey: boolean;
    }
  | { command: "openEditor" }
  | { command: "getRemoteInfo" }
  | {
      command: "generatePrContent";
      title?: boolean;
      description?: boolean;
      plan?: DraftCommitPlan;
    }
  | {
      command: "createPullRequest";
      remote: string;
      baseBranch: string;
      headBranch: string;
      title: string;
      body: string;
    };

export interface ActivityItem {
  id: string;
  message: string;
  type: "info" | "success" | "error" | "loading" | "warning";
  timestamp: string;
}

export type ExtensionToWebviewMessage =
  | { command: "setStagedOverview"; files: FileDiff[] }
  | { command: "setLoading"; value: boolean }
  | { command: "planGenerated"; plan: DraftCommitPlan }
  | { command: "singleRegenerated"; commit: DraftCommit }
  | { command: "changesDetected"; staged: number; unstaged: number }
  | {
      command: "gitSnapshot";
      snapshot: {
        staged: number;
        unstaged: number;
        filesSignature: string;
        loadedCount: number;
      };
    }
  | { command: "apiKeyPrompted"; provider: string; label: string }
  | { command: "activity"; activity: ActivityItem }
  | { command: "error"; message: string }
  | { command: "providerConfigLoaded"; config: ProviderConfig }
  | { command: "providerTestResult"; success: boolean; message: string }
  | { command: "providerApiKeyStatus"; status: Record<string, boolean> }
  | {
      command: "remoteInfoLoaded";
      remotes: { name: string; url: string }[];
      branches: string[];
      currentBranch: string;
      defaultBranch: string;
    }
  | { command: "prContentGenerated"; title?: string; description?: string }
  | { command: "prCreated"; url?: string; message?: string };
