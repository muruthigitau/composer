import { useEffect, useMemo, useState } from "react";
import {
  CommitGroup,
  CommitPlan,
  ExtensionToWebviewMessage,
  StagedChangeSummary
} from "./types";

const vscode = window.acquireVsCodeApi();

interface CommitCardProps {
  commit: CommitGroup;
  index: number;
  selected: boolean;
  onToggle: (id: string) => void;
  onViewDiff: (commit: CommitGroup) => void;
}

function CommitCard({ commit, index, selected, onToggle, onViewDiff }: CommitCardProps) {
  const [expanded, setExpanded] = useState(false);

  const typeColor = useMemo(() => {
    const colors: Record<string, string> = {
      feat: "#4CAF50",
      fix: "#F44336",
      refactor: "#2196F3",
      docs: "#9C27B0",
      style: "#FF9800",
      test: "#00BCD4",
      chore: "#795548",
      perf: "#3F51B5",
      ci: "#607D8B",
      build: "#8D6E63",
      revert: "#D32F2F"
    };
    return colors[commit.type] || "#757575";
  }, [commit.type]);

  const fileCount = commit.changes?.length || 0;
  const hunksCount = commit.changes?.reduce((sum, c) => sum + (c.hunks?.length || 0), 0) || 0;

  return (
    <div className={`commit-card ${selected ? "selected" : ""}`}>
      <div className="commit-card-header" onClick={() => setExpanded(!expanded)}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(commit.id)}
          className="commit-toggle"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select commit ${index + 1}`}
        />
        <div className="commit-type" style={{ backgroundColor: typeColor }}>
          {commit.type}
        </div>
        <div className="commit-subject-container">
          <span className="commit-number">#{index + 1}</span>
          <span className="commit-subject">{commit.subject}</span>
        </div>
        <span className="commit-counts">
          {fileCount} file{fileCount !== 1 ? "s" : ""}
          {hunksCount > 0 && ` · ${hunksCount} hunk${hunksCount !== 1 ? "s" : ""}`}
        </span>
        <span className={`chevron ${expanded ? "expanded" : ""}`}>▼</span>
      </div>

      {expanded && (
        <div className="commit-card-details">
          {commit.body && commit.body.length > 0 && (
            <ul className="commit-body">
              {commit.body.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}

          <div className="commit-files">
            {commit.changes?.map((change, ci) => (
              <div key={`${change.file}-${ci}`} className="commit-file-row">
                <span className="file-icon">📄</span>
                <span className="file-path">{change.file}</span>
                {change.hunks && change.hunks.length > 0 && (
                  <span className="hunk-indicator">
                    {change.hunks.map((h) => `H${h + 1}`).join(", ")}
                  </span>
                )}
              </div>
            ))}
          </div>

          {commit.reasoning && (
            <div className="commit-reasoning">
              <strong>Reasoning:</strong> {commit.reasoning}
            </div>
          )}

          <div className="commit-actions">
            <button
              className="vscode-button secondary"
              onClick={() => onViewDiff(commit)}
            >
              View Diff
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface StagedInfoProps {
  summary: StagedChangeSummary;
}

function StagedInfo({ summary }: StagedInfoProps) {
  return (
    <div className="staged-info">
      <div className="staged-summary">
        <span className="staged-file-count">{summary.fileCount} files</span>
        <span className="staged-add">+{summary.additions}</span>
        <span className="staged-del">-{summary.deletions}</span>
      </div>
      <div className="staged-files-preview">
        {summary.files?.slice(0, 8).map((file, i) => (
          <span key={i} className="staged-file" title={file}>
            {file.split("/").pop()}
          </span>
        ))}
        {(summary.files?.length || 0) > 8 && (
          <span className="staged-file-more">
            +{(summary.files?.length || 0) - 8} more
          </span>
        )}
      </div>
    </div>
  );
}

export function App() {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<CommitPlan | null>(null);
  const [summary, setSummary] = useState<StagedChangeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());
  const [commitProgress, setCommitProgress] = useState<{
    current: number;
    total: number;
    subject: string;
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    // Request initial refresh on mount
    vscode.postMessage({ command: "refresh" });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage;

      switch (message.command) {
        case "refreshDone": {
          setSummary(message.summary);
          setError(null);
          break;
        }
        case "setLoading": {
          setLoading(message.value);
          if (message.value) {
            setError(null);
            setSuccessMessage(null);
          }
          break;
        }
        case "planGenerated":
        case "planRegenerated": {
          setPlan(message.plan);
          setSelectedCommits(new Set(message.plan.commits.map((c) => c.id)));
          setError(null);
          setSuccessMessage(null);
          break;
        }
        case "error": {
          setError(message.message);
          setSuccessMessage(null);
          break;
        }
        case "commitSuccess": {
          setSuccessMessage(
            `Successfully created ${message.count} commit${message.count === 1 ? "" : "s"}!`
          );
          setPlan(null);
          setCommitProgress(null);
          break;
        }
        case "commitProgress": {
          setCommitProgress(message);
          break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleGenerate = () => {
    setSuccessMessage(null);
    vscode.postMessage({ command: "generate" });
  };

  const handleRegenerate = () => {
    vscode.postMessage({ command: "regenerate" });
  };

  const handleClear = () => {
    setPlan(null);
    setSelectedCommits(new Set());
    vscode.postMessage({ command: "clearPlan" });
  };

  const handleCommitAll = () => {
    if (!plan) return;
    setCommitProgress({
      current: 0,
      total: plan.commits.length,
      subject: "Starting..."
    });
    vscode.postMessage({ command: "commit", plan });
  };

  const handleCommitSelected = () => {
    if (!plan) return;
    const selectedPlan: CommitPlan = {
      commits: plan.commits.filter((c) => selectedCommits.has(c.id))
    };
    if (selectedPlan.commits.length === 0) return;
    setCommitProgress({
      current: 0,
      total: selectedPlan.commits.length,
      subject: "Starting..."
    });
    vscode.postMessage({
      command: "commitSelected",
      plan,
      commitIds: Array.from(selectedCommits)
    });
  };

  const toggleCommit = (id: string) => {
    setSelectedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleViewDiff = (commit: CommitGroup) => {
    vscode.postMessage({ command: "viewDiff", commit });
  };

  const handleOpenSCM = () => {
    vscode.postMessage({ command: "refresh" });
  };

  const allSelected =
    plan && plan.commits.length > 0
      ? plan.commits.every((c) => selectedCommits.has(c.id))
      : false;
  const anySelected = selectedCommits.size > 0;

  return (
    <div className="composer-container">
      <header className="composer-header">
        <div className="composer-title">
          <span className="composer-icon">⚡</span>
          <h1>Commit Composer</h1>
        </div>
        <div className="composer-actions">
          {plan && (
            <button
              className="vscode-button secondary"
              onClick={handleClear}
              disabled={loading}
            >
              Clear
            </button>
          )}
          {summary && !plan && (
            <button
              className="vscode-button primary"
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" /> Analyzing Staged Changes...
                </>
              ) : (
                <>✨ Generate Commits</>
              )}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          {error}
          <button className="error-dismiss" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="success-banner">
          <span className="success-icon">✓</span>
          {successMessage}
        </div>
      )}

      {commitProgress && (
        <div className="commit-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${(commitProgress.current / commitProgress.total) * 100}%`
              }}
            />
          </div>
          <div className="progress-text">
            Committing {commitProgress.current}/{commitProgress.total}:{" "}
            {commitProgress.subject}
          </div>
        </div>
      )}

      {/* Staged Changes Summary */}
      {summary ? (
        <StagedInfo summary={summary} />
      ) : (
        !loading &&
        plan === null && (
          <div className="empty-state">
            <div className="empty-icon">◉</div>
            <h3>No staged changes</h3>
            <p>
              Stage some changes in Source Control and open Commit Composer to
              generate commits.
            </p>
            <button className="vscode-button primary" onClick={handleOpenSCM}>
              Refresh
            </button>
          </div>
        )
      )}

      {/* Loading State */}
      {loading && (
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Analyzing staged changes and generating commit plan...</p>
          <p className="loading-hint">
            Using AI to decompose {summary?.fileCount || "your"} staged files
            into logical, reviewable commits
          </p>
        </div>
      )}

      {/* Commit Plan */}
      {plan && !loading && (
        <section className="commit-plan-section">
          <div className="commit-plan-header">
            <h2>Generated Commits</h2>
            <span className="commit-count-badge">
              {plan.commits.length} commit{plan.commits.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="commit-list">
            {plan.commits.map((commit, index) => (
              <CommitCard
                key={commit.id}
                commit={commit}
                index={index}
                selected={selectedCommits.has(commit.id)}
                onToggle={toggleCommit}
                onViewDiff={handleViewDiff}
              />
            ))}
          </div>

          <div className="commit-plan-actions">
            <button
              className="vscode-button secondary"
              onClick={handleRegenerate}
              disabled={loading}
            >
              ↻ Regenerate
            </button>
            {anySelected && (
              <button
                className="vscode-button primary"
                onClick={handleCommitSelected}
                disabled={loading || commitProgress !== null}
              >
                Commit Selected ({selectedCommits.size})
              </button>
            )}
            {allSelected && (
              <button
                className="vscode-button primary"
                onClick={handleCommitAll}
                disabled={loading || commitProgress !== null}
              >
                Commit All →
              </button>
            )}
          </div>

          {!loading && !anySelected && (
            <p className="empty-selection-hint">
              Select at least one commit to commit it.
            </p>
          )}
        </section>
      )}
    </div>
  );
}