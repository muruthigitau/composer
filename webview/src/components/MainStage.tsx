import { DraftCommit, FileDiff } from "../types";
import { CommitEditor } from "./CommitEditor";
import { DiffViewer } from "./DiffViewer";

interface MainStageProps {
  selectedCommit: DraftCommit | null;
  aiOverviewCollapsed: Record<string, boolean>;
  loading: boolean;
  globalMessage: string;
  activeFiles: FileDiff[];
  collapsedFiles: Set<number>;
  changeNotice: { staged: number; unstaged: number } | null;
  dirChanged: boolean;
  onCommitChange: (id: string, updates: Partial<DraftCommit>) => void;
  onRegenerate: (commit: DraftCommit) => void;
  onToggleOverview: (id: string) => void;
  onGlobalMessageChange: (value: string) => void;
  onGenerateGlobal: () => void;
  onToggleCollapse: (idx: number) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onReload: () => void;
  onDismissChangeNotice: () => void;
  onDismissDirChanged: () => void;
}

export function MainStage({
  selectedCommit,
  aiOverviewCollapsed,
  loading,
  globalMessage,
  activeFiles,
  collapsedFiles,
  changeNotice,
  dirChanged,
  onCommitChange,
  onRegenerate,
  onToggleOverview,
  onGlobalMessageChange,
  onGenerateGlobal,
  onToggleCollapse,
  onCollapseAll,
  onExpandAll,
  onReload,
  onDismissChangeNotice,
  onDismissDirChanged,
}: MainStageProps) {
  return (
    <main className="main-stage flex-1 min-w-0 h-full flex flex-col bg-bg-primary overflow-hidden relative">
      <div className="main-stage-content flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {selectedCommit ? (
          <CommitEditor
            commit={selectedCommit}
            collapsed={!!aiOverviewCollapsed[selectedCommit.id]}
            loading={loading}
            onCommitChange={onCommitChange}
            onRegenerate={onRegenerate}
            onToggleOverview={onToggleOverview}
          />
        ) : (
          <div className="overview-header flex gap-3 px-6 py-4 border-b border-border shrink-0 bg-bg-secondary items-center w-full">
            <input
              type="text"
              placeholder="Enter a global commit summary..."
              value={globalMessage}
              onChange={(e) => onGlobalMessageChange(e.target.value)}
              className="commit-title-input flex-1 min-w-0 bg-bg-input border border-input-border text-text-primary rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors duration-150 focus:border-input-focus-border placeholder:text-text-disabled"
            />
            <button
              className="btn outline-btn shrink-0 whitespace-nowrap px-4.5 py-2.5 bg-transparent text-text-primary border border-border rounded-md hover:bg-bg-hover hover:border-focus-border transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onGenerateGlobal}
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate Message"}
            </button>
          </div>
        )}

        {changeNotice && (
          <div className="change-banner flex items-center gap-3 mx-6 mt-3 px-3.5 py-2.5 bg-warning-bg border border-warning-border rounded-md text-warning-text text-[13px] shrink-0 animate-banner-in">
            <div className="change-banner-icon text-base shrink-0">⚠️</div>
            <div className="change-banner-text flex-1 flex flex-col gap-0.5 min-w-0">
              <strong className="text-[13px]">Changes detected</strong>
              <span className="text-xs text-text-muted">
                {changeNotice.staged} staged · {changeNotice.unstaged} unstaged
              </span>
            </div>
            <div className="change-banner-actions flex gap-1.5 shrink-0">
              <button
                className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                onClick={onReload}
              >
                ↻ Reload
              </button>
              <button
                className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                onClick={onDismissChangeNotice}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {dirChanged && !changeNotice && (
          <div className="change-banner dir-banner flex items-center gap-3 mx-6 mt-3 px-3.5 py-2.5 bg-alert-infoBg border border-alert-infoBorder rounded-md text-alert-infoText text-[13px] shrink-0 animate-banner-in">
            <div className="change-banner-icon text-base shrink-0">🔄</div>
            <div className="change-banner-text flex-1 flex flex-col gap-0.5 min-w-0">
              <strong className="text-[13px]">
                Working directory has changed
              </strong>
              <span className="text-xs text-text-muted">
                The staged diff is out of date. Reload to see the latest
                changes.
              </span>
            </div>
            <div className="change-banner-actions flex gap-1.5 shrink-0">
              <button
                className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                onClick={onReload}
              >
                ↻ Reload
              </button>
              <button
                className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                onClick={onDismissDirChanged}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <DiffViewer
          activeFiles={activeFiles}
          collapsedFiles={collapsedFiles}
          onToggleCollapse={onToggleCollapse}
          onCollapseAll={onCollapseAll}
          onExpandAll={onExpandAll}
          onReload={onReload}
        />
      </div>
    </main>
  );
}