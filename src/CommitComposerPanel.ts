/**
 * Editor-tab host for the Commit Composer.
 *
 * The host only owns the webview lifecycle; all business logic lives in
 * {@link ComposerController} which is shared with the sidebar view.
 */

import * as vscode from "vscode";
import { AIService } from "./services/AIService";
import { GitService } from "./services/GitService";
import { ComposerController, ComposerHost } from "./webview/ComposerController";
import { buildWebviewHtml } from "./webview/webviewHtml";

export class CommitComposerPanel {
  public static currentPanel: CommitComposerPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly controller: ComposerController;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    workspacePath: string
  ) {
    const host: ComposerHost = {
      postMessage: (message) => this.panel.webview.postMessage(message),
      openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
      showInputBox: (options) =>
        vscode.window.showInputBox({
          prompt: options.prompt,
          password: options.password,
          placeHolder: options.placeHolder,
          ignoreFocusOut: true
        }),
      setGlobalSetting: async (key, value) => {
        await vscode.workspace
          .getConfiguration("commitComposer")
          .update(key, value, vscode.ConfigurationTarget.Global);
      },
      showInformationMessage: (message) => {
        vscode.window.showInformationMessage(message);
      },
      showWarningMessage: (message) => {
        vscode.window.showWarningMessage(message);
      },
      showErrorMessage: (message) => {
        vscode.window.showErrorMessage(message);
      },
      openEditor: () => {
        void vscode.commands.executeCommand("commitComposer.open");
      },
      workspaceName: vscode.workspace.workspaceFolders?.[0]?.name
    };

    this.controller = new ComposerController(
      host,
      new GitService(workspacePath),
      new AIService(context.globalStorageUri.fsPath)
    );

    this.panel.webview.html = buildWebviewHtml(panel.webview, context.extensionUri);
    this.panel.webview.onDidReceiveMessage(
      (message) => void this.controller.handleMessage(message),
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    void this.controller.load();
  }

  /** Create or reveal the composer editor tab. */
  public static createOrShow(context: vscode.ExtensionContext): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("Open a workspace folder to use Commit Composer.");
      return;
    }

    if (CommitComposerPanel.currentPanel) {
      CommitComposerPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel("commitComposerTab", "Commit Composer", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "webview", "dist")]
    });

    CommitComposerPanel.currentPanel = new CommitComposerPanel(panel, context, workspaceFolder);
  }

  private dispose(): void {
    CommitComposerPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
