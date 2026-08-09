import { useEffect, useRef } from "react";
import { ActivityItem } from "../types";

interface LoadingModalProps {
  show: boolean;
  activities: ActivityItem[];
  variant: "commits" | "pr";
  bodyRef?: React.Ref<HTMLDivElement>;
}

const VARIANTS = {
  commits: {
    title: "Generating Commits",
    subtitle: "Analyzing your staged changes and building the perfect commit plan…",
    icon: "⚡",
    accent: "loader-accent-commits",
  },
  pr: {
    title: "Generating Pull Request",
    subtitle: "Analyzing your committed differences and crafting a PR for you…",
    icon: "🔀",
    accent: "loader-accent-pr",
  },
} as const;

export function LoadingModal({
  show,
  activities,
  variant,
  bodyRef,
}: LoadingModalProps) {
  const activityEndRef = useRef<HTMLDivElement>(null);
  const config = VARIANTS[variant];

  // Auto-scroll the newest activity into view whenever the list changes.
  useEffect(() => {
    if (show && activities.length > 0) {
      requestAnimationFrame(() => {
        activityEndRef.current?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [activities, show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(0,0,0,0.75)] backdrop-blur-[10px] animate-modal-fade-in">
      <div className="advanced-loader-modal w-[520px] max-w-[92vw] max-h-[82vh] bg-bg-secondary border border-border rounded-2xl shadow-modal overflow-hidden flex flex-col loader-modal-surface">
        {/* Animated gradient top border */}
        <div className={`loader-top-bar ${config.accent}`} />

        <div className="loader-modal-header flex items-center gap-4 px-6 py-5 border-b border-border bg-bg-card relative overflow-hidden">
          {/* Ambient glow behind header */}
          <div className={`loader-ambient-glow ${config.accent}`} />

          {/* Orbiting / pulsing loader */}
          <div className="loader-orbit-wrap relative shrink-0">
            <div className="loader-orbit-ring" />
            <div className="loader-orbit-satellite" />
            <div className="loader-core">
              <span>{config.icon}</span>
            </div>
          </div>

          <div className="loader-header-text flex flex-col gap-1 min-w-0">
            <h3 className="text-base font-semibold text-text-primary loader-title-shimmer">
              {config.title}
            </h3>
            <p className="text-xs text-text-muted leading-relaxed">
              {config.subtitle}
            </p>
          </div>

          <div className="ml-auto shrink-0 loader-status-pill">
            <span className="loader-pulse-dot" />
            <span className="loader-status-text">Working</span>
          </div>
        </div>

        <div
          className="loader-modal-body flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-2"
          ref={bodyRef}
        >
          {/* Animated placeholder with typing indicator */}
          {activities.length === 0 && (
            <div className="loader-placeholder flex flex-col items-center gap-3 py-6 text-text-muted text-sm">
              {/* Animated progress bars */}
              <div className="loader-progress-track w-full max-w-[280px]">
                <div className="loader-progress-bar loader-commits-bar" />
              </div>
              <div className="loader-progress-track w-full max-w-[220px]">
                <div className="loader-progress-bar loader-commits-bar loader-delay-1" />
              </div>
              <div className="loader-progress-track w-full max-w-[250px]">
                <div className="loader-progress-bar loader-commits-bar loader-delay-2" />
              </div>
              <div className="loader-typewriter flex items-center gap-1.5 mt-1">
                <span className="loader-typewriter-icon">🧠</span>
                <p>Analyzing changes</p>
                <div className="loader-dots inline-flex gap-1">
                  <span className="loader-dot [animation-delay:0s]" />
                  <span className="loader-dot [animation-delay:0.2s]" />
                  <span className="loader-dot [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}

          {/* Activity items */}
          {activities.map((a) => (
            <div
              key={a.id}
              className={`loader-activity-item flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg text-[13px] leading-relaxed border-l-[3px] bg-bg-input ${
                a.type === "loading"
                  ? "border-l-alert-infoBorder text-text-primary loader-item-loading"
                  : a.type === "success"
                    ? "border-l-success-text text-success-text bg-success-bg loader-item-success"
                    : a.type === "error"
                      ? "border-l-error-text text-error-text bg-error-bg loader-item-error"
                      : a.type === "warning"
                        ? "border-l-warning-text text-warning-text bg-warning-bg loader-item-warning"
                        : "border-l-alert-infoBorder text-text-primary bg-alert-infoBg"
              }`}
            >
              <span className="loader-activity-icon shrink-0 text-base w-5 text-center">
                {a.type === "loading" ? (
                  <span className="loader-mini-spinner" />
                ) : a.type === "success" ? (
                  "✅"
                ) : a.type === "error" ? (
                  "❌"
                ) : a.type === "warning" ? (
                  "⚠️"
                ) : (
                  "ℹ️"
                )}
              </span>
              <span className="loader-activity-message flex-1 break-words">
                {a.message}
              </span>
              <span className="loader-activity-time shrink-0 text-text-muted text-[11px] self-center">
                {a.timestamp}
              </span>
            </div>
          ))}
          <div ref={activityEndRef} />
        </div>

        {/* Animated footer progress line */}
        <div className="loader-modal-footer shrink-0 h-1 overflow-hidden">
          <div className={`loader-footer-progress ${config.accent}`} />
        </div>
      </div>
    </div>
  );
}