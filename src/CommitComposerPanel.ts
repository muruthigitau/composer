import * as vscode from "vscode";
import { GitService } from "./services/GitService";
import { AIService } from "./services/AIService";
import {
  CommitPlan,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "./types/messages";

/**
 * CommitComposerPanel manages the webview UI for the commit composer.
 * It handles communication between the React webview and the extension host.
 */
export class CommitComposerPanel {
  public static currentPanel: CommitComposerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly gitService: GitService;
  private readonly aiService: AIService;
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    workspacePath: string
  ) {
    this.panel = panel;
    this.context = context;
    this.gitService = new GitService(workspacePath);
    this.aiService = new AIService();

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this), null, this.disposables);
    this.panel.onDidDispose(this.dispose.bind(this), null, this.disposables);
  }

  /**
   * Create or reveal the composer panel.
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
      "commitComposer",
      "Commit Composer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "webview", "dist"),
          vscode.Uri.joinPath(context.extensionUri, "dist")
        ]
      }
    );

    CommitComposerPanel.currentPanel = new CommitComposerPanel(panel, context, workspaceFolder);
  }

  /**
   * Send a message to the webview.
   */
  private postMessage(message: ExtensionToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  /**
   * Handle messages coming from the webview.
   */
  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.command) {
      case "refresh": {
        await this.handleRefresh();
        break;
      }
      case "generate":
      case "regenerate": {
        await this.handleGenerate();
        break;
      }
      case "clearPlan": {
        await this.handleRefresh();
        break;
      }
      case "commit": {
        await this.handleCommit(message.plan);
        break;
      }
      case "commitSelected": {
        const selected = message.plan.commits.filter((c) => message.commitIds.includes(c.id));
        if (selected.length > 0) {
          await this.handleCommit({ commits: selected });
        }
        break;
      }
      case "viewDiff": {
        await this.handleViewDiff(message.commit);
        break;
      }
      case "editCommit": {
        // Placeholder for future editing capability
        break;
      }
    }
  }

  /**
   * Refresh staged change summary.
   */
  private async handleRefresh(): Promise<void> {
    try {
      const summary = await this.gitService.getStagedSummary();
      this.postMessage({ command: "refreshDone", summary });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Generate a commit plan using the AI provider.
   */
  private async handleGenerate(): Promise<void> {
    try {
      this.postMessage({ command: "setLoading", value: true });

      const diff = await this.gitService.getStagedDiff();
      if (!diff.trim()) {
        throw new Error("No staged changes found. Stage some changes first.");
      }

      // Get repo context
      let branch: string | undefined;
      let repoName: string | undefined;
      try {
        const branchResult = await this.gitService.exec(["branch", "--show-current"]);
        branch = branchResult.trim() || undefined;
      } catch {
        // ignore
      }
      repoName = vscode.workspace.workspaceFolders?.[0]?.name;

      const plan = await this.aiService.generatePlan(diff, { branch, repoName });
      this.postMessage({ command: "planGenerated", plan });
    } catch (error) {
      this.handleError(error);
    } finally {
      this.postMessage({ command: "setLoading", value: false });
    }
  }

  /**
   * Execute the commit plan.
   */
  private async handleCommit(plan: CommitPlan): Promise<void> {
    try {
      const commits = plan.commits.map((commit) => {
        const fullMessage = this.formatCommitMessage(commit);
        const files = commit.changes.map((change) => change.file);
        return { message: fullMessage, files };
      });

      const total = commits.length;
      if (total === 0) {
        throw new Error("No commits in the plan to execute.");
      }

      const committed = await this.gitService.commitPlan(commits, (current, total, subject) => {
        this.postMessage({
          command: "commitProgress",
          current,
          total,
          subject
        });
      });

      this.postMessage({ command: "commitSuccess", count: committed });
      vscode.window.showInformationMessage(`Created ${committed} commit${committed === 1 ? "" : "s"} successfully!`);

      // Refresh the summary after committing
      await this.handleRefresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes("nothing to commit") || errorMsg.includes("nothing added")) {
        vscode.window.showInformationMessage("No staged changes to commit.");
        await this.handleRefresh();
      } else {
        this.handleError(error);
      }
    }
  }

  /**
   * Format a full commit message from a commit group.
   */
  private formatCommitMessage(commit: {
    type: string;
    subject: string;
    body?: string[];
  }): string {
    const type = this.normalizeType(commit.type);
    const subject = commit.subject.trim();
    const bodyLines = (commit.body || []).filter((line) => line.trim().length > 0);

    if (bodyLines.length === 0) {
      return `${type}: ${subject}`;
    }

    return `${type}: ${subject}\n\n${bodyLines.join("\n")}`;
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

  /**
   * Show a diff for a commit group in a VS Code diff editor.
   */
  private async handleViewDiff(commit: any): Promise<void> {
    const workspacePath = (this.gitService as any)["workspacePath"];

    for (const change of commit.changes || []) {
      const filePath = change.file;
      const uri = vscode.Uri.file(`${workspacePath}/${filePath}`);

      try {
        const exists = await vscode.workspace.fs.stat(uri).then(
          () => true,
          () => false
        );

        if (exists) {
          // Open the file
          const document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document, { preview: true });
        }
      } catch {
        // File might be deleted
      }
    }
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.postMessage({ command: "error", message });
    vscode.window.showErrorMessage(`Commit Composer: ${message}`);
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
   */
  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "webview", "dist", "assets", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "webview", "dist", "assets", "index.css")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${styleUri}">
    <title>Commit Composer</title>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}