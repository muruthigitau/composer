import { FileDiff } from "../types";
import { parseDiffLines } from "../lib/diffParser";

interface DiffViewerProps {
  activeFiles: FileDiff[];
  collapsedFiles: Set<number>;
  onToggleCollapse: (idx: number) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onReload: () => void;
}

export function DiffViewer({
  activeFiles,
  collapsedFiles,
  onToggleCollapse,
  onCollapseAll,
  onExpandAll,
  onReload,
}: DiffViewerProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Stage header */}
      <div className="stage-header px-6 py-3 border-b border-border flex items-center justify-between gap-3 shrink-0 bg-bg-secondary min-h-[52px]">
        <h3 className="text-[13px] font-semibold text-text-primary">
          Files Changed ({activeFiles.length})
        </h3>
        <div className="stage-header-actions flex gap-1.5 items-center shrink-0">
          <button
            className="btn small-btn shrink-0 px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
            onClick={onCollapseAll}
            title="Collapse all file diffs"
          >
            ▾ Collapse All
          </button>
          <button
            className="btn small-btn shrink-0 px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
            onClick={onExpandAll}
            title="Expand all file diffs"
          >
            ▸ Expand All
          </button>
          <button
            className="btn small-btn shrink-0 px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
            onClick={onReload}
            title="Reload latest staged changes"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Diff list */}
      <div className="diff-viewer-list flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-6 flex flex-col gap-3.5 bg-bg-primary">
        {activeFiles.length === 0 && (
          <div className="empty-state flex flex-col items-center justify-center px-6 py-12 text-center border border-dashed border-border rounded-lg bg-bg-card flex-1 min-h-[300px]">
            <div className="empty-icon text-[44px] mb-3.5 opacity-50">📄</div>
            <h3 className="text-[15px] mb-1.5 font-semibold text-text-primary">
              No staged changes
            </h3>
            <p className="text-text-muted text-xs leading-relaxed max-w-[320px]">
              Stage changes in the Source Control view — they will appear here.
            </p>
          </div>
        )}

        {activeFiles.map((file, idx) => {
          const diffLines = parseDiffLines(file.diffText);
          const isCollapsed = collapsedFiles.has(idx);
          let oldLine = 0;
          let newLine = 0;
          return (
            <div
              key={idx}
              className="file-diff-card border border-border rounded-md bg-bg-card overflow-hidden shrink-0"
            >
              <div
                className="file-header bg-bg-secondary px-3 py-2 flex items-center gap-2.5 text-xs font-mono border-b border-border min-h-[36px] cursor-pointer select-none transition-colors duration-150 hover:bg-bg-hover"
                onClick={() => onToggleCollapse(idx)}
                role="button"
                tabIndex={0}
              >
                <span
                  className={`collapse-arrow text-text-muted text-xs shrink-0 transition-transform duration-150 inline-block w-4 text-center ${
                    isCollapsed ? "collapsed -rotate-90" : ""
                  }`}
                >
                  ▸
                </span>
                <span className="file-path flex-1 text-text-link break-all min-w-0 text-xs">
                  {file.path}
                </span>
                <span className="file-counts inline-flex gap-1.5 text-[11px] shrink-0">
                  <span className="additions text-diff-addText">
                    +{file.additions}
                  </span>
                  <span className="deletions text-diff-removeText">
                    -{file.deletions}
                  </span>
                </span>
                <span
                  className={`status-tag text-[10px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                    file.status.toLowerCase() === "added"
                      ? "bg-diff-addBg text-diff-addText"
                      : file.status.toLowerCase() === "modified"
                        ? "bg-diff-hunkBg text-diff-hunkText"
                        : "bg-diff-removeBg text-diff-removeText"
                  }`}
                >
                  {file.status}
                </span>
              </div>
              {!isCollapsed && (
                <div className="diff-lines font-mono text-xs leading-relaxed overflow-x-auto bg-bg-primary max-h-[600px] overflow-y-auto">
                  {diffLines.map((line, lineIdx) => {
                    let oldNum = "";
                    let newNum = "";
                    if (line.type === "add") {
                      newNum = String(++newLine);
                    } else if (line.type === "del") {
                      oldNum = String(++oldLine);
                    } else if (line.type === "context") {
                      oldNum = String(++oldLine);
                      newNum = String(++newLine);
                    } else if (line.type === "hunk") {
                      const m = line.text.match(
                        /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
                      );
                      if (m) {
                        oldLine = parseInt(m[1], 10) - 1;
                        newLine = parseInt(m[2], 10) - 1;
                      }
                    }
                    return (
                      <div
                        key={lineIdx}
                        className={`diff-line flex min-w-full whitespace-pre-wrap break-words ${
                          line.type === "add"
                            ? "bg-diff-addBg border-l-[3px] border-l-diff-addBorder"
                            : line.type === "del"
                              ? "bg-diff-removeBg border-l-[3px] border-l-diff-removeBorder"
                              : line.type === "hunk"
                                ? "bg-diff-hunkBg border-l-[3px] border-l-alert-infoBorder"
                                : line.type === "header"
                                  ? "text-text-muted font-semibold"
                                  : ""
                        }`}
                      >
                        <span className="gutter old shrink-0 px-1 text-right min-w-[2.2em] text-[11px] select-none opacity-60 text-text-muted text-diff-removeText">
                          {oldNum}
                        </span>
                        <span className="gutter new shrink-0 px-1 text-right min-w-[2.2em] text-[11px] select-none opacity-60 text-text-muted text-diff-addText">
                          {newNum}
                        </span>
                        <span
                          className={`gutter sign shrink-0 min-w-[1.5em] px-0.5 pl-1.5 text-center opacity-100 font-bold ${
                            line.type === "add"
                              ? "text-diff-addText"
                              : line.type === "del"
                                ? "text-diff-removeText"
                                : ""
                          }`}
                        >
                          {line.type === "add"
                            ? "+"
                            : line.type === "del"
                              ? "−"
                              : " "}
                        </span>
                        <span
                          className={`diff-line-text px-3 flex-1 min-w-0 whitespace-pre-wrap ${
                            line.type === "add"
                              ? "text-diff-addText"
                              : line.type === "del"
                                ? "text-diff-removeText"
                                : line.type === "hunk"
                                  ? "text-diff-hunkText font-semibold"
                                  : line.type === "header"
                                    ? "text-text-muted"
                                    : "text-text-primary"
                          }`}
                        >
                          {line.text}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}