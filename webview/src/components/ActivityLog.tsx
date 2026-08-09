import { ActivityItem } from "../types";

interface ActivityLogProps {
  activityLog: ActivityItem[];
  copiedAll: boolean;
  copiedItemId: string | null;
  onCopyAll: () => void;
  onClear: () => void;
  onCopyItem: (item: ActivityItem) => void;
}

export function ActivityLog({
  activityLog,
  copiedAll,
  copiedItemId,
  onCopyAll,
  onClear,
  onCopyItem,
}: ActivityLogProps) {
  return (
    <div className="activity-panel bg-bg-card border border-border rounded-lg overflow-hidden shrink-0">
      <div className="activity-header flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-text-primary">
          Activity Log
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onCopyAll}
            disabled={activityLog.length === 0}
            title="Copy all log entries"
          >
            {copiedAll ? "✓ Copied" : "📋 Copy all"}
          </button>
          <button
            className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="activity-body max-h-[220px] min-h-[60px] overflow-y-auto px-3 py-2 flex flex-col gap-1">
        {activityLog.length === 0 && (
          <p className="card-subtext text-xs text-text-muted">
            No activity yet.
          </p>
        )}
        {activityLog.map((a) => (
          <div
            key={a.id}
            className={`activity-item flex items-start gap-2 text-xs leading-relaxed py-0.5 pl-1.5 border-l-[3px] border-border text-text-primary ${
              a.type === "info"
                ? "border-l-alert-infoBorder"
                : a.type === "loading"
                  ? "border-l-alert-infoBorder text-text-primary"
                  : a.type === "success"
                    ? "border-l-success-text text-success-text"
                    : a.type === "error"
                      ? "border-l-error-text text-error-text"
                      : a.type === "warning"
                        ? "border-l-warning-text text-warning-text"
                        : ""
            }`}
          >
            <span className="activity-type shrink-0 text-xs">
              {a.type === "loading"
                ? "⏳"
                : a.type === "success"
                  ? "✅"
                  : a.type === "error"
                    ? "❌"
                    : a.type === "warning"
                      ? "⚠️"
                      : "ℹ️"}
            </span>
            <span className="activity-message flex-1 min-w-0 break-words">
              {a.message}
            </span>
            <span className="activity-time shrink-0 text-[10px] text-text-muted ml-auto">
              {a.timestamp}
            </span>
            <button
              className="btn small-btn shrink-0 py-0 px-1 text-[10px] bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
              onClick={() => onCopyItem(a)}
              title="Copy this entry"
            >
              {copiedItemId === a.id ? "✓" : "📋"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}