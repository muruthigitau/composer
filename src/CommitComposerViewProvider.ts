/**
 * Sidebar webview host for the Commit Composer.
 *
 * Uses the same controller as the editor tab, so both views share identical
 * behaviour (staged overview, provider wizard, PR creation).
 */

import * as vscode from "vscode";
import { AIService } from "./services/AIService";
import { GitService } from "./services/GitService";
import { ComposerController, ComposerHost } from "./webview/ComposerController";
import { buildWebviewHtml } from "./webview/webviewHtml";

export class CommitComposerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "commitComposerView";

  private view?: vscode.WebviewView;
  private controller?: ComposerController;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspacePath: string,
    private readonly storagePath: string
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "webview", "dist")]
    };
    webviewView.webview.html = buildWebviewHtml(webviewView.webview, this.extensionUri, {
      sidebar: true
    });

    const host: ComposerHost = {
      postMessage: (message) => this.view?.webview.postMessage(message),
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
      new GitService(this.workspacePath),
      new AIService(this.storagePath)
    );

    webviewView.webview.onDidReceiveMessage(
      (message) => void this.controller?.handleMessage(message),
      undefined,
      []
    );
    void this.controller.load();
  }
}
