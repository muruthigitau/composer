import * as vscode from "vscode";
import { CommitComposerPanel } from "./CommitComposerPanel";
import { CommitComposerViewProvider } from "./CommitComposerViewProvider";

/**
 * Entry point for the Commit Composer extension.
 */
export function activate(context: vscode.ExtensionContext) {
  // Register the "Open Editor Tab" command
  const openCommand = vscode.commands.registerCommand("commitComposer.open", () => {
    CommitComposerPanel.createOrShow(context);
  });
  context.subscriptions.push(openCommand);

  // Register the "Focus View" command (sidebar)
  const focusCommand = vscode.commands.registerCommand("commitComposer.focus", async () => {
    await vscode.commands.executeCommand("commitComposerView.focus");
  });
  context.subscriptions.push(focusCommand);

  // Register the sidebar Webview View Provider
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceFolder) {
    const viewProvider = vscode.window.registerWebviewViewProvider(
      CommitComposerViewProvider.viewType,
      new CommitComposerViewProvider(context.extensionUri, workspaceFolder, context.globalStorageUri.fsPath)
    );
    context.subscriptions.push(viewProvider);
  }

  // Expose a forwarder for the generate command from the view/title menu
  const generateCommand = vscode.commands.registerCommand("commitComposer.generate", () => {
    vscode.commands.executeCommand("commitComposerView.focus");
  });
  context.subscriptions.push(generateCommand);

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = "$(git-commit) Composer";
  statusBarItem.tooltip = "AI-powered Git Commit Composer";
  statusBarItem.command = "commitComposer.focus";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("commitComposer")) {
        // Future: update status bar text based on provider
      }
    })
  );

  console.log("Commit Composer extension activated");
}

export function deactivate() {}