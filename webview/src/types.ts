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

export type WebviewToExtensionMessage =
  | { command: "refresh" }
  | { command: "generate" }
  | { command: "regenerate" }
  | { command: "clearPlan" }
  | { command: "commit"; plan: CommitPlan }
  | { command: "commitSelected"; plan: CommitPlan; commitIds: string[] }
  | { command: "viewDiff"; commit: CommitGroup }
  | { command: "editCommit"; commit: CommitGroup };

export type ExtensionToWebviewMessage =
  | { command: "refreshDone"; summary: StagedChangeSummary | null }
  | { command: "setLoading"; value: boolean }
  | { command: "planGenerated"; plan: CommitPlan }
  | { command: "planRegenerated"; plan: CommitPlan }
  | { command: "error"; message: string }
  | { command: "commitSuccess"; count: number }
  | { command: "commitProgress"; current: number; total: number; subject: string };