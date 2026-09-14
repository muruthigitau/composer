/**
 * Message controller shared by both webview hosts (editor panel and sidebar).
 *
 * The hosts are thin adapters that own a webview and forward messages here.
 * This class routes messages and owns provider-configuration handling, while
 * the commit-plan lifecycle lives in {@link CommitPlanFlow} and the pull
 * request lifecycle in {@link PullRequestFlow}.
 */

import {
  ActivityItem,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "../types/messages";
import { ProviderConfig } from "../types/provider";
import { AIService } from "../services/AIService";
import { GitService } from "../services/GitService";
import { CommitPlanFlow } from "./CommitPlanFlow";
import { PullRequestFlow } from "./PullRequestFlow";

/** UI capabilities the controller needs from its hosting webview. */
export interface ComposerHost {
  /** Send a message to the webview. */
  postMessage(message: ExtensionToWebviewMessage): void;
  /** Open a URL in the user's browser. */
  openExternal(url: string): PromiseLike<unknown> | void;
  /** Show a VS Code input box; resolves undefined when cancelled. */
  showInputBox(options: {
    prompt: string;
    password?: boolean;
    placeHolder?: string;
  }): PromiseLike<string | undefined>;
  /** Persist a global VS Code setting. */
  setGlobalSetting(key: string, value: string): PromiseLike<void>;
  /** Open the full editor-tab composer (used by the sidebar). */
  openEditor(): void;
  /** Notification helpers. */
  showInformationMessage(message: string): void;
  showWarningMessage(message: string): void;
  showErrorMessage(message: string): void;
  /** Workspace folder name, used as AI context. */
  workspaceName?: string;
}

export class ComposerController {
  private activitySeq = 0;
  private readonly plans: CommitPlanFlow;
  private readonly pullRequests: PullRequestFlow;

  constructor(
    private readonly host: ComposerHost,
    private readonly git: GitService,
    private readonly ai: AIService
  ) {
    this.plans = new CommitPlanFlow({
      git,
      ai,
      workspaceName: host.workspaceName,
      post: (message) => this.post(message),
      log: (message, type) => this.logActivity(message, type),
      setLoading: (value) => this.setLoading(value),
      handleError: (error) => this.handleError(error),
      showInformationMessage: (message) => host.showInformationMessage(message),
      showWarningMessage: (message) => host.showWarningMessage(message)
    });

    this.pullRequests = new PullRequestFlow({
      git,
      ai,
      workspaceName: host.workspaceName,
      post: (message) => this.post(message),
      log: (message, type) => this.logActivity(message, type),
      setLoading: (value) => this.setLoading(value),
      handleError: (error) => this.handleError(error),
      openExternal: (url) => host.openExternal(url)
    });
  }

  /** Send the initial state (staged files + provider config) to the webview. */
  public async load(): Promise<void> {
    await this.plans.loadStaged();
    await this.handleGetProviderConfig();
    await this.plans.reloadChanges();
  }

  /** Route a webview message to its handler. */
  public async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.command) {
      case "loadStaged":
        await this.plans.loadStaged();
        return;
      case "reloadChanges":
        await this.plans.reloadChanges();
        return;
      case "generatePlan":
        await this.plans.generate(message.instructions, message.sampleMessage);
        return;
      case "regenerateSingle":
        await this.plans.regenerate(message.commitId, message.prompt);
        return;
      case "executeCommits":
        await this.plans.execute(message.plan);
        return;
      case "getProviderConfig":
        await this.handleGetProviderConfig();
        return;
      case "getRemoteInfo":
        await this.handleGetRemoteInfo();
        return;
      case "generatePrContent":
        await this.pullRequests.generateContent(
          message.title,
          message.description,
          message.baseBranch,
          message.headBranch
        );
        return;
      case "createPullRequest":
        await this.pullRequests.create(
          message.remote,
          message.baseBranch,
          message.headBranch,
          message.title,
          message.body
        );
        return;
      case "saveProviderConfig":
        await this.handleSaveProviderConfig(message.config);
        return;
      case "testProviderConnection":
        await this.handleTestProviderConnection(message.config);
        return;
      case "promptApiKey":
        await this.handlePromptApiKey(message.provider, message.label, message.requiresApiKey);
        return;
      case "openEditor":
        this.host.openEditor();
        return;
      default:
        return;
    }
  }

  // ─────────────────────────── provider configuration ───────────────────────────

  /** Send the current provider configuration and API-key status to the webview. */
  private async handleGetProviderConfig(): Promise<void> {
    try {
      this.post({ command: "providerConfigLoaded", config: this.ai.getProviderConfig() });
      this.post({
        command: "providerApiKeyStatus",
        status: this.ai.getProviderApiKeyStatus()
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /** Persist a provider configuration and refresh the webview. */
  private async handleSaveProviderConfig(config: ProviderConfig): Promise<void> {
    try {
      await this.ai.saveProviderConfig(config);
      await this.handleGetProviderConfig();
      this.host.showInformationMessage(`Commit Composer: provider settings saved (${config.label}).`);
    } catch (error) {
      this.handleError(error);
    }
  }

  /** Test a provider connection without persisting it. */
  private async handleTestProviderConnection(config: ProviderConfig): Promise<void> {
    try {
      const result = await this.ai.testConnection(config);
      this.post({
        command: "providerTestResult",
        success: result.success,
        message: result.message
      });
    } catch (error) {
      this.post({
        command: "providerTestResult",
        success: false,
        message: this.errorMessage(error)
      });
    }
  }

  /** Ask for an API key and store it for the given provider. */
  private async handlePromptApiKey(
    provider: string,
    label: string,
    requiresApiKey: boolean
  ): Promise<void> {
    try {
      const key = await this.host.showInputBox({
        prompt: requiresApiKey
          ? `Enter your API key for ${label}:`
          : `Enter your API key for ${label} (optional):`,
        password: true,
        placeHolder: "sk-... or paste your key"
      });
      if (key === undefined || !key.trim()) {
        return;
      }

      const trimmed = key.trim();
      const current = this.ai.getProviderConfig();
      if (current.provider === provider) {
        await this.ai.saveProviderConfig({ ...current, apiKey: trimmed });
      } else {
        await this.host.setGlobalSetting(`${provider}ApiKey`, trimmed);
        this.ai.refreshProvider();
      }

      await this.handleGetProviderConfig();
      this.post({ command: "apiKeyPrompted", provider, label });
    } catch (error) {
      this.handleError(error);
    }
  }

  /** Send remote and branch information for the PR wizard. */
  private async handleGetRemoteInfo(): Promise<void> {
    try {
      const [remotes, branches, currentBranch, defaultBranch] = await Promise.all([
        this.git.getRemotes(),
        this.git.getBranches(true),
        this.git.getCurrentBranch(),
        this.git.getDefaultBranch()
      ]);

      this.post({
        command: "remoteInfoLoaded",
        remotes,
        branches,
        currentBranch: currentBranch || "",
        defaultBranch
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  // ─────────────────────────── helpers ───────────────────────────

  private post(message: ExtensionToWebviewMessage): void {
    this.host.postMessage(message);
  }

  /** Show or hide the blocking loading modal in the webview. */
  private setLoading(value: boolean): void {
    this.post({ command: "setLoading", value });
  }

  /** Append an entry to the webview activity log. */
  private logActivity(message: string, type: ActivityItem["type"] = "info"): void {
    this.post({
      command: "activity",
      activity: {
        id: `act-${Date.now()}-${this.activitySeq++}`,
        message,
        type,
        timestamp: new Date().toLocaleTimeString()
      }
    });
  }

  /** Report an error to the webview log, the toast UI and the user. */
  private handleError(error: unknown): void {
    const message = this.errorMessage(error);
    this.post({ command: "error", message });
    this.logActivity(message, "error");
    this.host.showErrorMessage(`Commit Composer: ${message}`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
