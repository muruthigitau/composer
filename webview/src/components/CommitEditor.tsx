import { DraftCommit } from "../types";

interface CommitEditorProps {
  commit: DraftCommit;
  collapsed: boolean;
  loading: boolean;
  onCommitChange: (id: string, updates: Partial<DraftCommit>) => void;
  onRegenerate: (commit: DraftCommit) => void;
  onToggleOverview: (id: string) => void;
}

export function CommitEditor({
  commit,
  collapsed,
  loading,
  onCommitChange,
  onRegenerate,
  onToggleOverview,
}: CommitEditorProps) {
  return (
    <div className="commit-editor-wrapper flex flex-col w-full shrink-0 bg-bg-secondary border-b border-border">
      <div className="commit-editor-header flex gap-4 px-6 py-4 items-start w-full">
        <div className="commit-message-box flex-1 flex flex-col gap-2.5 min-w-0">
          <input
            type="text"
            value={`${commit.type}: ${commit.subject}`}
            onChange={(e) => {
              const value = e.target.value;
              const [type, ...rest] = value.split(":");
              onCommitChange(commit.id, {
                type: (type || "").trim(),
                subject: rest.join(":").trim(),
              });
            }}
            className="commit-title-input bg-bg-input border border-input-border text-text-primary rounded-md px-3 py-2.5 text-sm font-medium outline-none w-full transition-colors duration-150 focus:border-input-focus-border placeholder:text-text-disabled"
            placeholder="feat: commit subject"
          />
          <textarea
            value={commit.overview}
            onChange={(e) => onCommitChange(commit.id, { overview: e.target.value })}
            className="commit-body-input bg-bg-input border border-input-border text-text-primary rounded-md px-3 py-2.5 text-[13px] outline-none w-full min-h-[80px] resize-y leading-relaxed transition-colors duration-150 focus:border-input-focus-border placeholder:text-text-disabled"
            placeholder="Commit body overview..."
          />
        </div>
        <button
          className="btn outline-btn regenerate-btn shrink-0 self-start mt-0.5 px-4.5 py-2.5 text-[13px] bg-transparent text-text-primary border border-border rounded-md hover:bg-bg-hover hover:border-focus-border transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => onRegenerate(commit)}
          disabled={loading}
        >
          {loading ? "Regenerating..." : "✨ Regenerate Message"}
        </button>
      </div>

      {commit.aiOverview && (
        <div className="ai-overview-container flex flex-col mx-6 mb-4 bg-bg-card border border-border rounded-lg overflow-hidden transition-all duration-200">
          <div
            className="ai-overview-header flex items-center gap-2.5 px-4 py-3 bg-bg-secondary cursor-pointer select-none transition-colors duration-150 border-b border-border hover:bg-bg-hover"
            onClick={() => onToggleOverview(commit.id)}
            role="button"
            tabIndex={0}
          >
            <span
              className={`ai-overview-arrow text-text-muted text-xs transition-transform duration-200 inline-block ${
                collapsed ? "collapsed -rotate-90" : ""
              }`}
            >
              ▸
            </span>
            <span className="ai-overview-label text-xs font-semibold text-text-primary flex-1">
              🤖 AI Overview
            </span>
            <span className="ai-overview-badge text-[10px] px-2 py-0.5 rounded-full bg-alert-infoBg text-alert-infoText font-medium tracking-[0.3px] border border-alert-infoBorder">
              AI-generated
            </span>
          </div>
          {!collapsed && (
            <div className="ai-overview-content px-5 py-4 bg-bg-primary animate-slide-down">
              <div className="ai-overview-text text-[13px] leading-[1.7] text-text-primary whitespace-pre-wrap break-words">
                {commit.aiOverview}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}