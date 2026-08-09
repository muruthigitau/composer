import * as vscode from "vscode";
import { GitService } from "./services/GitService";
import { AIService } from "./services/AIService";
import { PlanAdapter } from "./services/PlanAdapter";
import {
  ActivityItem,
  DraftCommitPlan,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "./types/messages";
import { ProviderConfig } from "./types/provider";

/**
 * CommitComposerViewProvider powers the sidebar webview view.
 * It shares the same protocol and React UI as the editor tab panel.
 */
export class CommitComposerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "commitComposerView";

  private view?: vscode.WebviewView;
  private gitService: GitService;
  private aiService: AIService;

  constructor(
    private readonly extensionUri: vscode.Uri,
    workspacePath: string,
    storagePath: string
  ) {
    this.gitService = new GitService(workspacePath);
    this.aiService = new AIService(storagePath);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "webview", "dist")
      ]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      this.handleMessage.bind(this),
      undefined,
      []
    );
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    this.view?.webview.postMessage(message);
  }

  private activityLogSeq = 0;

  /**
   * Emit a real-time activity entry to the webview status panel.
   */
  private logActivity(
    message: string,
    type: ActivityItem["type"] = "info"
  ): void {
    this.postMessage({
      command: "activity",
      activity: {
        id: `act-${Date.now()}-${this.activityLogSeq++}`,
        message,
        type,
        timestamp: new Date().toLocaleTimeString()
      }
    });
  }

  /**
   * Handle messages from the webview (same protocol as the editor panel).
   */
  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.command) {
      case "loadStaged": {
        await this.handleLoadStaged();
        break;
      }
      case "reloadChanges": {
        await this.handleReloadChanges();
        break;
      }
      case "generatePlan": {
        await this.handleGeneratePlan(message.prompt, message.model, message.instructions, message.sampleMessage);
        break;
      }
      case "regenerateSingle": {
        await this.handleRegenerateSingle(message.commitId, message.prompt);
        break;
      }
      case "executeCommits": {
        await this.handleExecuteCommits(message.plan);
        break;
      }
      case "getProviderConfig": {
        await this.handleGetProviderConfig();
        break;
      }
      case "getRemoteInfo": {
        await this.handleGetRemoteInfo();
        break;
      }
      case "generatePrContent": {
        await this.handleGeneratePrContent(message.title, message.description, message.plan);
        break;
      }
      case "createPullRequest": {
        await this.handleCreatePullRequest(message.remote, message.baseBranch, message.headBranch, message.title, message.body);
        break;
      }
      case "saveProviderConfig": {
        await this.handleSaveProviderConfig(message.config);
        break;
      }
      case "testProviderConnection": {
        await this.handleTestProviderConnection(message.config);
        break;
      }
      case "promptApiKey": {
        await this.handlePromptApiKey(message.provider, message.label, message.requiresApiKey);
        break;
      }
      case "openEditor": {
        // Open the full editor-tab composer from the compact sidebar.
        await vscode.commands.executeCommand("commitComposer.open");
        break;
      }
    }
  }

  /**
   * Ask the user for an API key using VS Code's input box, then persist it.
   */
  private async handlePromptApiKey(
    provider: string,
    label: string,
    requiresApiKey: boolean
  ): Promise<void> {
    try {
      const key = await vscode.window.showInputBox({
        prompt: requiresApiKey
          ? `Enter your API key for ${label}:`
          : `Enter your API key for ${label} (optional):`,
        password: true,
        ignoreFocusOut: true,
        placeHolder: "sk-... or paste your key"
      });

      if (key === undefined) return;
      const trimKey = key.trim();
      if (!trimKey) return;

      // Save the key to BOTH the config file (source of truth) and settings.
      const currentConfig = this.aiService.getProviderConfig();
      if (currentConfig.provider === provider) {
        await this.aiService.saveProviderConfig({
          ...currentConfig,
          apiKey: trimKey
        });
      } else {
        // Fallback: just write the provider-specific setting.
        const vsConfig = vscode.workspace.getConfiguration("commitComposer");
        await vsConfig.update(
          `${provider}ApiKey`,
          trimKey,
          vscode.ConfigurationTarget.Global
        );
        this.aiService.refreshProvider();
      }
      await this.handleGetProviderConfig();
      this.postMessage({ command: "apiKeyPrompted", provider, label });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Load remote + branch info and send it to the webview for the PR wizard.
   */
  private async handleGetRemoteInfo(): Promise<void> {
    try {
      const [remotes, branches, currentBranch, defaultBranch] = await Promise.all([
        this.gitService.getRemotes(),
        this.gitService.getBranches(true),
        this.gitService.getCurrentBranch(),
        this.gitService.getDefaultBranch()
      ]);
      const normalized = branches.map((b) => b.replace(/^remotes\/origin\//, "").replace(/^origin\//, ""));
      this.postMessage({
        command: "remoteInfoLoaded",
        remotes,
        branches: Array.from(new Set(normalized)),
        currentBranch: currentBranch || "",
        defaultBranch
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Generate PR title/description via AI and send back to the webview.
   */
  private async handleGeneratePrContent(
    titleOnly?: boolean,
    descOnly?: boolean,
    plan?: DraftCommitPlan
  ): Promise<void> {
    try {
      this.postMessage({ command: "setLoading", value: true });
      this.logActivity("Reading staged diff for PR content…", "loading");

      const diff = await this.gitService.getStagedDiff();
      if (!diff.trim()) {
        throw new Error("No staged changes found. Stage some changes first.");
      }

      const commits = (plan?.commits || []).map((c) => ({
        subject: `${c.type}: ${c.subject}`,
        overview: c.aiOverview || c.overview || ""
      }));

      this.logActivity("Generating PR title and description…", "loading");
      const currentBranch = await this.gitService.getCurrentBranch();
      const defaultBranch = await this.gitService.getDefaultBranch();
      const content = await this.aiService.generatePrContent(diff, commits, {
        branch: currentBranch,
        baseBranch: defaultBranch,
        repoName: vscode.workspace.workspaceFolders?.[0]?.name
      });

      this.postMessage({
        command: "prContentGenerated",
        title: titleOnly || (!titleOnly && !descOnly) ? content.title : undefined,
        description: descOnly || (!titleOnly && !descOnly) ? content.description : undefined
      });
      this.logActivity("PR content ready.", "success");
    } catch (error) {
      this.handleError(error);
    } finally {
      this.postMessage({ command: "setLoading", value: false });
    }
  }

  /**
   * Create a Pull Request in the full editor panel.
   */
  private async handleCreatePullRequest(
    remote: string,
    baseBranch: string,
    headBranch: string,
    title: string,
    body: string
  ): Promise<void> {
    try {
      this.postMessage({ command: "setLoading", value: true });
      this.logActivity("Pushing branch to remote…", "loading");
      await this.gitService.exec(["push", "-u", remote, `HEAD:${headBranch}`]);
      this.logActivity("Creating pull request…", "loading");

      try {
        const ghOutput = await this.gitService.runCommand("gh", [
          "pr", "create",
          "--base", baseBranch,
          "--head", headBranch,
          "--title", title,
          "--body", JSON.stringify(body)
        ]);
        const urlMatch = ghOutput.trim();
        this.postMessage({ command: "prCreated", url: urlMatch.startsWith("http") ? urlMatch : undefined, message: urlMatch });
        this.logActivity(`Pull request created: ${urlMatch}`, "success");
        return;
      } catch {
        // gh missing
      }

      const remoteInfo = (await this.gitService.getRemotes()).find((r) => r.name === remote);
      let compareUrl = "";
      if (remoteInfo) {
        const url = remoteInfo.url.replace(/\.git$/, "").replace(/^git@([^:]+):/, "https://$1/");
        compareUrl = `${url}/compare/${baseBranch}...${headBranch}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      }
      if (compareUrl) {
        await vscode.env.openExternal(vscode.Uri.parse(compareUrl));
        this.postMessage({ command: "prCreated", url: compareUrl, message: "Opened compare URL — complete the PR in your browser." });
        this.logActivity("Opened compare URL for PR creation.", "success");
      } else {
        throw new Error("No remote URL found to build a PR link. Create the PR manually after pushing.");
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.postMessage({ command: "setLoading", value: false });
    }
  }

  private async handleGetProviderConfig(): Promise<void> {
    try {
      const config = this.aiService.getProviderConfig();
      this.postMessage({ command: "providerConfigLoaded", config });
      // Also send which providers already have an API key stored so the
      // wizard can skip the key-entry step and offer an optional change link.
      this.postMessage({
        command: "providerApiKeyStatus",
        status: this.aiService.getProviderApiKeyStatus()
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  private async handleSaveProviderConfig(config: ProviderConfig): Promise<void> {
    try {
      await this.aiService.saveProviderConfig(config);
      // Send the freshly persisted config back so the webview UI stays in sync.
      await this.handleGetProviderConfig();
      vscode.window.showInformationMessage(
        `Commit Composer: Provider settings saved (${config.label}).`
      );
    } catch (error) {
      this.handleError(error);
    }
  }

  private async handleTestProviderConnection(config: ProviderConfig): Promise<void> {
    try {
      const result = await this.aiService.testConnection(config);
      this.postMessage({
        command: "providerTestResult",
        success: result.success,
        message: result.message
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({
        command: "providerTestResult",
        success: false,
        message
      });
    }
  }

  private async handleLoadStaged(): Promise<void> {
    try {
      const files = await this.gitService.getStagedFileDiffs();
      this.postMessage({ command: "setStagedOverview", files });
    } catch (error) {
      this.handleError(error);
    }
  }

  private async handleReloadChanges(): Promise<void> {
    try {
      const snapshot = await this.gitService.getGitSnapshot();
      this.postMessage({
        command: "changesDetected",
        staged: snapshot.staged,
        unstaged: snapshot.unstaged
      });
      const stagedDiffs = await this.gitService.getStagedFileDiffs();
      this.postMessage({
        command: "gitSnapshot",
        snapshot: {
          staged: snapshot.staged,
          unstaged: snapshot.unstaged,
          filesSignature: snapshot.filesSignature,
          loadedCount: stagedDiffs.length
        }
      });
    } catch (error) {
      // Non-fatal status check
    }
  }

  private async handleGeneratePlan(
    prompt?: string,
    _model?: string,
    instructions?: string,
    sampleMessage?: string
  ): Promise<void> {
    try {
      this.postMessage({ command: "setLoading", value: true });
      this.logActivity("Reading staged Git changes…", "loading");

      const diff = await this.gitService.getStagedDiff();
      if (!diff.trim()) {
        throw new Error("No staged changes found. Stage some changes first.");
      }

      this.logActivity(`Calling ${this.aiService.getProviderConfig().label} to generate commit plan…`, "loading");
      const plan = await this.aiService.generatePlan(diff, {
        branch: await this.getBranch(),
        repoName: vscode.workspace.workspaceFolders?.[0]?.name,
        instructions,
        sampleMessage
      });
      this.logActivity("AI returned the commit plan. Building draft list…", "loading");

      const stagedFiles = await this.gitService.getStagedFileDiffs();
      const draftPlan = PlanAdapter.toDraftPlan(plan, stagedFiles);

      this.postMessage({ command: "planGenerated", plan: draftPlan });
      this.logActivity(`Draft plan ready: ${draftPlan.commits.length} commit(s).`, "success");
    } catch (error) {
      this.handleError(error);
    } finally {
      this.postMessage({ command: "setLoading", value: false });
    }
  }

  private async handleRegenerateSingle(commitId: string, _prompt?: string): Promise<void> {
    try {
      this.postMessage({ command: "setLoading", value: true });

      const diff = await this.gitService.getStagedDiff();
      if (!diff.trim()) {
        throw new Error("No staged changes found. Stage some changes first.");
      }

      const plan = await this.aiService.generatePlan(diff, {
        branch: await this.getBranch(),
        repoName: vscode.workspace.workspaceFolders?.[0]?.name
      });

      const stagedFiles = await this.gitService.getStagedFileDiffs();
      const draftPlan = PlanAdapter.toDraftPlan(plan, stagedFiles);

      const regenerated = draftPlan.commits.find((c) => c.id === commitId);
      if (regenerated) {
        this.postMessage({ command: "singleRegenerated", commit: regenerated });
      } else {
        this.postMessage({ command: "planGenerated", plan: draftPlan });
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.postMessage({ command: "setLoading", value: false });
    }
  }

  private async getBranch(): Promise<string | undefined> {
    try {
      const result = await this.gitService.exec(["branch", "--show-current"]);
      return result.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async handleExecuteCommits(plan: DraftCommitPlan): Promise<void> {
    try {
      const commits = plan.commits.map((commit) => ({
        message: this.formatDraftMessage(commit),
        files: commit.files.map((f) => f.path)
      }));

      if (commits.length === 0) {
        throw new Error("No draft commits to execute.");
      }

      this.logActivity(`Creating ${commits.length} commit(s)…`, "loading");
      const committed = await this.gitService.commitPlan(
        commits,
        (current, count, subject) => {
          this.logActivity(`Commit ${current}/${count}: ${subject}`, "loading");
        }
      );
      this.logActivity(`Created ${committed} commit(s) successfully.`, "success");
      vscode.window.showInformationMessage(
        `Created ${committed} commit${committed === 1 ? "" : "s"} successfully!`
      );
      await this.handleLoadStaged();
    } catch (error) {
      this.handleError(error);
    }
  }

  private formatDraftMessage(commit: {
    type: string;
    subject: string;
    overview: string;
  }): string {
    const type = this.normalizeType(commit.type);
    const subject = (commit.subject || "").trim();
    const body = (commit.overview || "").trim();

    const header = `${type}: ${subject}`;
    if (!body) {
      return header;
    }
    return `${header}\n\n${this.wrapBody(body)}`;
  }

  /**
   * Ensure a blank line separates logical sections and every line is wrapped
   * at a reasonable width so the final commit body reads cleanly in `git log`.
   */
  private wrapBody(body: string): string {
    const width = 100;
    const sections = body.split(/\n\s*\n/);
    const wrapped = sections.map((section) => {
      // If the section is a bullet list, keep each bullet on its own line
      // rather than prose-wrapping them.
      const lines = section.split("\n");
      if (lines.some((l) => l.trim().startsWith("- ") || l.trim().startsWith("### "))) {
        return lines.map((l) => l.trimEnd()).join("\n");
      }
      // Prose paragraph: wrap soft.
      const words = section.trim().split(/\s+/);
      const out: string[] = [];
      let current = "";
      for (const word of words) {
        if (current && current.length + 1 + word.length > width) {
          out.push(current);
          current = "";
        }
        current = current ? current + " " + word : word;
      }
      if (current) out.push(current);
      return out.join("\n");
    });
    return wrapped.join("\n\n");
  }

  private normalizeType(type: string): string {
    const validTypes = [
      "feat", "fix", "refactor", "docs", "style", "test",
      "chore", "perf", "ci", "build", "revert"
    ];
    const lower = (type || "").trim().toLowerCase();
    return validTypes.includes(lower) ? lower : "chore";
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.postMessage({ command: "error", message });
    this.logActivity(message, "error");
    vscode.window.showErrorMessage(`Commit Composer: ${message}`);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview", "dist", "assets", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview", "dist", "assets", "index.css")
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   img-src ${webview.cspSource} https: data:;
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}';
                   font-src ${webview.cspSource};">
    <link rel="stylesheet" href="${styleUri}">
    <title>Commit Composer</title>
</head>
<body>
    <div id="root" class="sidebar-view"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}