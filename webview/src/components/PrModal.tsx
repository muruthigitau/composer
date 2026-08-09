import { DraftCommit } from "../types";

interface PrModalProps {
  open: boolean;
  remotes: { name: string; url: string }[];
  branches: string[];
  currentBranch: string;
  defaultBranch: string;
  prRemote: string;
  prBase: string;
  prHead: string;
  prTitle: string;
  prDescription: string;
  prGenerating: boolean;
  prCreatedMsg: string | null;
  prLink: string | null;
  treeClean: boolean;
  changeNotice: { staged: number; unstaged: number } | null;
  error: string | null;
  draftCommits: DraftCommit[];
  onClose: () => void;
  onRemoteChange: (remote: string) => void;
  onBaseChange: (base: string) => void;
  onHeadChange: (head: string) => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (desc: string) => void;
  onGenerateTitle: () => void;
  onGenerateDesc: () => void;
  onCreate: () => void;
}

export function PrModal({
  open,
  remotes,
  branches,
  currentBranch,
  defaultBranch,
  prRemote,
  prBase,
  prHead,
  prTitle,
  prDescription,
  prGenerating,
  prCreatedMsg,
  prLink,
  treeClean,
  changeNotice,
  error,
  draftCommits,
  onClose,
  onRemoteChange,
  onBaseChange,
  onHeadChange,
  onTitleChange,
  onDescriptionChange,
  onGenerateTitle,
  onGenerateDesc,
  onCreate,
}: PrModalProps) {
  const totalAdditions = draftCommits.reduce(
    (a, c) => a + c.files.reduce((x, f) => x + f.additions, 0),
    0,
  );
  const totalDeletions = draftCommits.reduce(
    (a, c) => a + c.files.reduce((x, f) => x + f.deletions, 0),
    0,
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(0,0,0,0.55)] backdrop-blur-[4px] animate-pr-in"
      onClick={onClose}
    >
      <div
        className="pr-modal w-[620px] max-w-[94vw] max-h-[86vh] flex flex-col bg-quickPickBg text-quickPickFg border border-border rounded-xl shadow-modal-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pr-modal-header flex items-center justify-between px-[18px] py-3.5 border-b border-border bg-bg-card">
          <h3 className="text-sm font-semibold text-text-primary">
            🔀 Create Pull Request
          </h3>
          <button
            className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="pr-modal-body flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-2.5">
          {/* PR summary strip */}
          <div className="pr-summary-strip flex items-center gap-3 px-3 py-2 rounded-md bg-bg-input border border-border text-[12px] text-text-muted">
            <span className="pr-summary-label shrink-0 font-semibold uppercase tracking-[0.5px] text-[10px]">
              Plan
            </span>
            <span className="flex items-center gap-1.5 font-mono">
              <span className="text-success-text">+{totalAdditions}</span>
              <span className="text-error-text">-{totalDeletions}</span>
            </span>
            <span className="flex-1 truncate">
              {draftCommits.length} commit
              {draftCommits.length === 1 ? "" : "s"}{" "}
              {draftCommits.map((c) => c.type).join(", ")}
            </span>
          </div>

          {prCreatedMsg && (
            <div className="pr-success-box flex flex-col gap-2.5 p-2.5 bg-success-bg border border-success-text rounded-md">
              <div className="success-banner flex items-center gap-2 text-[13px] text-success-text break-words">
                <span>✅</span>
                <span>{prCreatedMsg}</span>
              </div>
              {prLink && (
                <button
                  className="btn primary-btn bg-button-bg text-button-fg rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150 w-auto self-start"
                  onClick={() => window.open(prLink, "_blank")}
                >
                  Open Pull Request ↗
                </button>
              )}
            </div>
          )}

          {!treeClean && (
            <div className="pr-clean-hint p-2.5 bg-[var(--vscode-inputValidation-warningBackground,rgba(255,200,50,0.1))] border border-[var(--vscode-inputValidation-warningBorder,rgba(255,200,50,0.5))] rounded-md text-xs leading-relaxed text-text-primary">
              ⚠️ AI-generated title/description is based on{" "}
              <strong>committed differences</strong> between the base and head
              branches. Your working tree has{" "}
              {changeNotice ? (
                <span>
                  {changeNotice.staged} staged · {changeNotice.unstaged}{" "}
                  unstaged
                </span>
              ) : (
                "staged or unstaged changes"
              )}{" "}
              — commit or stash them first to enable AI generation.
            </div>
          )}

          <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px]">
            Remote
          </label>
          <select
            className="input-field bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border"
            value={prRemote}
            onChange={(e) => onRemoteChange(e.target.value)}
          >
            {remotes.length === 0 && <option value="">No remotes found</option>}
            {remotes.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name} — {r.url}
              </option>
            ))}
          </select>

          <div className="pr-row grid grid-cols-2 gap-3">
            <div>
              <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px] mt-1">
                Base branch
              </label>
              <select
                className="input-field bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border"
                value={prBase}
                onChange={(e) => onBaseChange(e.target.value)}
              >
                {branches.length === 0 && (
                  <option value={defaultBranch}>{defaultBranch}</option>
                )}
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px] mt-1">
                Head branch
              </label>
              <select
                className="input-field bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border"
                value={prHead}
                onChange={(e) => onHeadChange(e.target.value)}
              >
                {branches.length === 0 && (
                  <option value={currentBranch}>{currentBranch}</option>
                )}
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px]">
            Title
          </label>
          <div className="pr-title-row flex gap-2 items-center">
            <input
              className="commit-title-input flex-1 bg-bg-input border border-input-border text-text-primary rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors duration-150 focus:border-input-focus-border placeholder:text-text-disabled"
              placeholder="feat: ..."
              value={prTitle}
              onChange={(e) => onTitleChange(e.target.value)}
            />
            <button
              className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onGenerateTitle}
              disabled={prGenerating || !treeClean}
              title={
                treeClean
                  ? "Generate title from committed differences"
                  : "Commit/stash changes first to enable AI title generation"
              }
            >
              {prGenerating ? "…" : "✨ Title"}
            </button>
          </div>

          <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px]">
            Description (Markdown)
          </label>
          <div className="pr-desc-row flex gap-2 items-stretch">
            <textarea
              className="input-textarea pr-desc-textarea flex-1 min-h-[120px] font-mono text-xs leading-relaxed bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 outline-none transition-colors duration-150 focus:border-input-focus-border resize-y"
              placeholder="PR description..."
              value={prDescription}
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
            <button
              className="btn small-btn pr-desc-gen self-start whitespace-nowrap px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onGenerateDesc}
              disabled={prGenerating || !treeClean}
              title={
                treeClean
                  ? "Generate description from committed differences"
                  : "Commit/stash changes first to enable AI description generation"
              }
            >
              {prGenerating ? "…" : "✨ Desc"}
            </button>
          </div>

          {error && (
            <div className="error-banner bg-error-bg border border-error-border rounded px-3 py-2 text-error-text text-xs animate-banner-in">
              {error}
            </div>
          )}
        </div>

        <div className="pr-modal-footer shrink-0 flex gap-2.5 justify-end px-[18px] py-3 border-t border-border">
          <button
            className="btn secondary-btn w-auto min-w-[140px] bg-transparent text-text-primary border border-border rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn action-btn w-auto min-w-[140px] bg-button-bg text-button-fg rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onCreate}
            disabled={
              prGenerating || !prRemote || !prBase || !prHead || !prTitle.trim()
            }
          >
            {prGenerating ? "Working…" : "Create Pull Request"}
          </button>
        </div>
      </div>
    </div>
  );
}