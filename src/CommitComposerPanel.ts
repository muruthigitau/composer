import * as vscode from "vscode";
import { GitService } from "./services/GitService";
import { AIService } from "./services/AIService";
import { PlanAdapter } from "./services/PlanAdapter";
import {
  ActivityItem,
  DraftCommit,
  DraftCommitPlan,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "./types/messages";
import { ProviderConfig } from "./types/provider";

/**
 * CommitComposerPanel manages the editor-tab webview UI.
 * It uses a master-detail 2-column layout:
 *   - Left: model config, instructions, draft-commit timeline, actions
 *   - Right: diff viewer, filtered by the selected draft commit.
 */
export class CommitComposerPanel {
  public static currentPanel: CommitComposerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly gitService: GitService;
  private readonly aiService: AIService;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    workspacePath: string
  ) {
    this.panel = panel;
    this.gitService = new GitService(workspacePath);
    this.aiService = new AIService();

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      this.handleMessage.bind(this),
      null,
      this.disposables
    );
    this.panel.onDidDispose(this.dispose.bind(this), null, this.disposables);
  }

  /**
   * Create or reveal the composer editor tab.
   */
  public static createOrShow(context: vscode.ExtensionContext): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("Open a workspace folder to use Commit Composer.");
      return;
    }

    const column = vscode.ViewColumn.One;

    if (CommitComposerPanel.currentPanel) {
      CommitComposerPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "commitComposerTab",
      "Commit Composer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "webview", "dist")
        ]
      }
    );

    CommitComposerPanel.currentPanel = new CommitComposerPanel(
      panel,
      context,
      workspaceFolder
    );
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    this.panel.webview.postMessage(message);
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

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.postMessage({ command: "error", message });
    this.logActivity(message, "error");
    vscode.window.showErrorMessage(`Commit Composer: ${message}`);
  }

  /**
   * Handle messages coming from the webview.
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
        await this.handleGeneratePrContent(message.title, message.description, message.plan, message.baseBranch, message.headBranch);
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
    }
  }

  /**
   * Ask the user for an API key using VS Code's input box, then persist it to
   * settings and refresh the provider config in the webview.
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

      if (key === undefined) {
        return; // user cancelled
      }

      const trimKey = key.trim();
      if (!trimKey) {
        return;
      }

      // Save to the provider-specific setting.
      const vsConfig = vscode.workspace.getConfiguration("commitComposer");
      await vsConfig.update(
        `${provider}ApiKey`,
        trimKey,
        vscode.ConfigurationTarget.Global
      );

      // Refresh the AI service so the new key is picked up.
      this.aiService.refreshProvider();

      // Send the fresh config back to the webview.
      await this.handleGetProviderConfig();

      this.postMessage({
        command: "apiKeyPrompted",
        provider,
        label
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Load the staged file diffs and send them to the webview.
   */
  private async handleLoadStaged(): Promise<void> {
    try {
      const files = await this.gitService.getStagedFileDiffs();
      this.postMessage({ command: "setStagedOverview", files });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Check the current git status and notify the webview of any staged/unstaged
   * changes or a changed working directory so it can show a reload banner.
   */
  private async handleReloadChanges(): Promise<void> {
    try {
      const snapshot = await this.gitService.getGitSnapshot();
      this.postMessage({
        command: "changesDetected",
        staged: snapshot.staged,
        unstaged: snapshot.unstaged
      });
      // Also send a richer snapshot for advanced change detection.
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
      // Non-fatal: don't spam errors on status checks
    }
  }

  /**
   * Generate a full commit plan from staged changes, then adapt it for the UI.
   */
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

  /**
   * Regenerate a single draft commit's message.
   */
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

  /**
   * Execute all draft commits sequentially.
   */
  private async handleExecuteCommits(plan: DraftCommitPlan): Promise<void> {
    try {
      const commits = plan.commits.map((commit) => {
        const message = this.formatDraftMessage(commit);
        const files = commit.files.map((f) => f.path);
        return { message, files };
      });

      const total = commits.length;
      if (total === 0) {
        throw new Error("No draft commits to execute.");
      }

      this.logActivity(`Creating ${total} commit(s)…`, "loading");
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

      // Normalize branches for the base-branch picker (strip "remotes/origin/" prefix).
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
   *
   * PR content is generated from the *committed* differences between the
   * base and head branches (`git diff base...head`), NOT from the staged or
   * unstaged changes. This mirrors exactly what a normal Pull Request would
   * contain. Generation is only permitted when the working tree is completely
   * clean (0 staged + 0 unstaged changes).
   */
  private async handleGeneratePrContent(
    titleOnly?: boolean,
    descOnly?: boolean,
    plan?: DraftCommitPlan,
    baseBranch?: string,
    headBranch?: string
  ): Promise<void> {
    try {
      this.postMessage({ command: "setLoading", value: true });
      this.logActivity("Checking that the working tree is clean…", "loading");

      // Only allow PR content generation when there are no staged or unstaged
      // changes. We generate from committed differences only, so uncommitted
      // work would not be represented in the PR and should be committed first.
      const clean = await this.gitService.isWorkingTreeClean();
      if (!clean) {
        const status = await this.gitService.getStatusCounts();
        throw new Error(
          `Working tree is not clean (${status.staged} staged, ${status.unstaged} unstaged). ` +
            "Commit or stash your changes before generating PR content — " +
            "PR content is generated from committed differences only."
        );
      }

      const currentBranch =
        headBranch || (await this.gitService.getCurrentBranch());
      if (!currentBranch) {
        throw new Error(
          "No current branch found. Check out the branch you want to open a PR for."
        );
      }
      const resolvedBase =
        baseBranch || (await this.gitService.getDefaultBranch());

      this.logActivity(`Reading committed diff ${resolvedBase}...${currentBranch}…`, "loading");
      const diff = await this.gitService.getBranchDiff(resolvedBase, currentBranch);
      if (!diff.trim()) {
        throw new Error(
          `No committed differences found between "${resolvedBase}" and "${currentBranch}". ` +
            "Nothing to include in a PR."
        );
      }

      const commits = (plan?.commits || []).map((c) => ({
        subject: `${c.type}: ${c.subject}`,
        overview: c.aiOverview || c.overview || ""
      }));

      this.logActivity("Generating PR title and description…", "loading");
      const content = await this.aiService.generatePrContent(diff, commits, {
        branch: currentBranch,
        baseBranch: resolvedBase,
        repoName: vscode.workspace.workspaceFolders?.[0]?.name
      });

      // Send only what was requested (title, description, or both).
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
   * Create a Pull Request. Uses GitHub CLI (`gh`) when available; otherwise
   * pushes the branch and prints/opens a compare URL.
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

      // Push the current branch to the selected remote.
      await this.gitService.exec(["push", "-u", remote, `HEAD:${headBranch}`]);

      this.logActivity("Creating pull request…", "loading");

      // Prefer `gh pr create` — it handles GitHub + GitLab auth.
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
        // gh not installed or failed — fall back to opening the compare URL.
      }

      // Fallback: construct a compare URL from the remote.
      const remoteInfo = (await this.gitService.getRemotes()).find((r) => r.name === remote);
      let compareUrl = "";
      if (remoteInfo) {
        const url = remoteInfo.url.replace(/\.git$/, "").replace(/^git@([^:]+):/, "https://$1/");
        compareUrl = `${url}/compare/${baseBranch}...${headBranch}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      }

      if (compareUrl) {
        await vscode.env.openExternal(vscode.Uri.parse(compareUrl));
        this.postMessage({
          command: "prCreated",
          url: compareUrl,
          message: "Opened compare URL — complete the PR in your browser."
        });
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

  /**
   * Send the current provider configuration to the webview.
   */
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

  /**
   * Save provider configuration to VS Code settings.
   */
  private async handleSaveProviderConfig(config: ProviderConfig): Promise<void> {
    try {
      await this.aiService.saveProviderConfig(config);
      vscode.window.showInformationMessage(
        `Commit Composer: Provider settings saved (${config.label}).`
      );
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Test the connection to a provider.
   */
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

  /**
   * Format a full commit message from a draft commit.
   * The body (enriched by PlanAdapter with detailed WHY/HOW prose, grouping
   * reasoning and file list) is appended verbatim so the final commit is
   * detailed and self-explanatory.
   */
  private formatDraftMessage(commit: DraftCommit): string {
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
      "feat",
      "fix",
      "refactor",
      "docs",
      "style",
      "test",
      "chore",
      "perf",
      "ci",
      "build",
      "revert"
    ];
    const lower = (type || "").trim().toLowerCase();
    return validTypes.includes(lower) ? lower : "chore";
  }

  private dispose(): void {
    CommitComposerPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  /**
   * Build the HTML for the webview, loading the built React app.
   * Includes a strict CSP that still allows the local script/style bundles.
   */
  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "webview", "dist", "assets", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "webview", "dist", "assets", "index.css")
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
    <div id="root"></div>
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