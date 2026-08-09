import {
  ActivityItem,
  DraftCommit,
  FileDiff,
  ProviderConfig,
} from "../types";
import { ActivityLog } from "./ActivityLog";

interface LeftPanelProps {
  providerConfig: ProviderConfig | null;
  selectedModel: string;
  instructions: string;
  sampleMessage: string;
  error: string | null;
  loading: boolean;
  showActivity: boolean;
  activityLog: ActivityItem[];
  copiedAll: boolean;
  copiedItemId: string | null;
  stagedFiles: FileDiff[];
  draftCommits: DraftCommit[];
  selectedCommitId: string | null;
  onToggleActivity: () => void;
  onOpenQuickPick: () => void;
  onInstructionsChange: (value: string) => void;
  onSampleMessageChange: (value: string) => void;
  onAutoCompose: () => void;
  onCopyAllLog: () => void;
  onClearLog: () => void;
  onCopyItem: (item: ActivityItem) => void;
  onSelectCommit: (id: string | null) => void;
  onExecuteAll: () => void;
  onOpenPr: () => void;
  onCancel: () => void;
}

export function LeftPanel({
  providerConfig,
  selectedModel,
  instructions,
  sampleMessage,
  error,
  loading,
  showActivity,
  activityLog,
  copiedAll,
  copiedItemId,
  stagedFiles,
  draftCommits,
  selectedCommitId,
  onToggleActivity,
  onOpenQuickPick,
  onInstructionsChange,
  onSampleMessageChange,
  onAutoCompose,
  onCopyAllLog,
  onClearLog,
  onCopyItem,
  onSelectCommit,
  onExecuteAll,
  onOpenPr,
  onCancel,
}: LeftPanelProps) {
  return (
    <aside className="left-panel bg-bg-secondary border-r border-border flex flex-col shrink-0 overflow-hidden w-[380px] min-w-[280px] max-w-[440px]">
      <header className="panel-header flex items-center justify-between px-4 py-3 border-b border-border bg-bg-secondary shrink-0 min-h-[48px]">
        <h2 className="text-[15px] font-semibold flex items-center text-text-primary">
          Commit Composer{" "}
          <span className="badge text-[10px] bg-border px-1.5 py-0.5 rounded ml-2 text-text-muted font-medium">
            PREVIEW
          </span>
        </h2>
        <div className="header-actions flex gap-1.5 items-center shrink-0">
          <button
            className={`settings-button text-xs px-2 py-1 whitespace-nowrap bg-bg-card border border-border rounded text-text-primary cursor-pointer transition-colors duration-150 ${
              showActivity
                ? "active bg-bg-hover border-focus-border"
                : ""
            }`}
            onClick={onToggleActivity}
            title="Activity log"
            aria-label="Toggle activity log"
          >
            🪵 Activity
          </button>
        </div>
      </header>

      <div className="left-panel-body flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="card bg-bg-card border border-border rounded-lg p-3.5 flex flex-col gap-2.5 shadow-card">
          <h3 className="text-[13px] font-semibold text-text-primary">
            Auto-Compose Commits
          </h3>
          <p className="card-subtext text-xs text-text-muted">
            Let AI organize your changes into well-formed commits with clear
            messages.
          </p>

          <div className="current-model flex flex-col gap-0.5 p-2.5 bg-bg-input border border-input-border rounded-md">
            <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">
              {providerConfig?.label || "AI"}
            </span>
            <span className="text-[13px] font-semibold text-text-primary break-words">
              {providerConfig?.model || selectedModel}
            </span>
          </div>
          <button
            className="btn outline-btn provider-link-btn mt-0.5 text-xs w-full bg-transparent text-text-primary border border-border rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150"
            onClick={onOpenQuickPick}
          >
            🔍 Change model / provider
          </button>

          <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px]">
            Instructions (optional)
          </label>
          <textarea
            placeholder="Include additional instructions"
            value={instructions}
            onChange={(e) => onInstructionsChange(e.target.value)}
            className="input-textarea bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border resize-y min-h-[60px] leading-relaxed"
          />

          <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px]">
            Sample commit message (optional)
          </label>
          <textarea
            placeholder="Paste a commit message to use as a style reference…"
            value={sampleMessage}
            onChange={(e) => onSampleMessageChange(e.target.value)}
            className="input-textarea bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border resize-y min-h-[60px] leading-relaxed"
          />

          {error && (
            <div className="error-banner bg-error-bg border border-error-border rounded px-3 py-2 text-error-text text-xs animate-banner-in">
              {error}
            </div>
          )}

          <button
            onClick={onAutoCompose}
            disabled={loading}
            className="btn primary-btn bg-button-bg text-button-fg w-full rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Analyzing changes..." : "✨ Auto-Compose Commits"}
          </button>
        </div>

        {showActivity && (
          <ActivityLog
            activityLog={activityLog}
            copiedAll={copiedAll}
            copiedItemId={copiedItemId}
            onCopyAll={onCopyAllLog}
            onClear={onClearLog}
            onCopyItem={onCopyItem}
          />
        )}

        <div className="section-title text-[11px] font-bold uppercase text-text-muted tracking-[0.5px]">
          Draft Commits
        </div>

        <div className="commits-timeline flex flex-col gap-0.5 relative">
          <div
            className={`timeline-node relative flex items-center gap-2.5 p-2.5 rounded-md cursor-pointer border border-transparent transition-colors duration-150 ${
              selectedCommitId === null ? "active bg-bg-active border-focus-border" : ""
            }`}
            onClick={() => onSelectCommit(null)}
            role="button"
            tabIndex={0}
          >
            <div className="node-icon text-xs text-focus-border shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-bg-card border border-border z-[1] transition-colors duration-150">
              ●
            </div>
            <div className="node-details min-w-0 flex-1">
              <div className="node-title text-[13px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
                All Staged Changes
              </div>
              <div className="node-meta text-[11px] text-text-muted mt-0.5">
                {stagedFiles.length} file{stagedFiles.length === 1 ? "" : "s"}
                <span className="additions text-diff-addText ml-1">
                  +{stagedFiles.reduce((a, f) => a + f.additions, 0)}
                </span>
                <span className="deletions text-diff-removeText ml-1">
                  -{stagedFiles.reduce((a, f) => a + f.deletions, 0)}
                </span>
              </div>
            </div>
          </div>

          {draftCommits.map((commit) => (
            <div
              key={commit.id}
              className={`timeline-node relative flex items-center gap-2.5 p-2.5 rounded-md cursor-pointer border border-transparent transition-colors duration-150 ${
                selectedCommitId === commit.id
                  ? "active bg-bg-active border-focus-border"
                  : ""
              }`}
              onClick={() => onSelectCommit(commit.id)}
              role="button"
              tabIndex={0}
            >
              <div className="node-connector absolute left-[17px] w-0.5 h-full bg-border rounded-[1px] top-[50%] first-of-type:top-[50%] first-of-type:h-[50%] last-of-type:h-[50%]" />
              <div className="node-icon text-xs text-focus-border shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-bg-card border border-border z-[1] transition-colors duration-150">
                ◯
              </div>
              <div className="node-details min-w-0 flex-1">
                <div className="node-title text-[13px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
                  {commit.type}: {commit.subject}
                </div>
                <div className="node-meta text-[11px] text-text-muted mt-0.5">
                  {commit.files.length} file
                  {commit.files.length === 1 ? "" : "s"}
                  <span className="additions text-diff-addText ml-1">
                    +{commit.files.reduce((a, f) => a + f.additions, 0)}
                  </span>
                  <span className="deletions text-diff-removeText ml-1">
                    -{commit.files.reduce((a, f) => a + f.deletions, 0)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="finish-section mt-auto pt-4 border-t border-border flex flex-col gap-2 shrink-0">
          <h4 className="text-xs font-semibold text-text-primary">
            Finish & Commit
          </h4>
          <button
            onClick={onExecuteAll}
            disabled={draftCommits.length === 0 || loading}
            className="btn action-btn bg-button-bg text-button-fg w-full rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create {draftCommits.length} Commit
            {draftCommits.length === 1 ? "" : "s"}
          </button>
          <button
            onClick={onOpenPr}
            disabled={loading}
            className="btn secondary-btn bg-transparent text-text-primary border border-border w-full rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔀 Create Pull Request
          </button>
          <button
            onClick={onCancel}
            disabled={draftCommits.length === 0}
            className="btn secondary-btn bg-transparent text-text-primary border border-border w-full rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    </aside>
  );
}