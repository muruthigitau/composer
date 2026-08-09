export interface VscodeApi {
  postMessage(message: any): void;
}

declare const acquireVsCodeApi: () => VscodeApi;

const vscode = acquireVsCodeApi();

export const isSidebar = !!document
  .getElementById("root")
  ?.classList.contains("sidebar-view");

export function sendMessage(message: any) {
  vscode.postMessage(message);
}