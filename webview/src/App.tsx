import { useEffect, useRef, useState } from "react";
import {
  ActivityItem,
  DraftCommit,
  DraftCommitPlan,
  ExtensionToWebviewMessage,
  FileDiff,
  PROVIDER_DEFAULTS,
  PROVIDER_OPTIONS,
  ProviderConfig,
} from "./types";

interface VscodeApi {
  postMessage(message: any): void;
}

declare const acquireVsCodeApi: () => VscodeApi;
const vscode = acquireVsCodeApi();
const isSidebar = !!document
  .getElementById("root")
  ?.classList.contains("sidebar-view");

interface DiffLine {
  text: string;
  type: "add" | "del" | "hunk" | "context" | "header";
}

/**
 * Parse raw unified diff text into colored line segments.
 */
function parseDiffLines(diffText: string): DiffLine[] {
  const lines = diffText.split("\n").map((t) => t.replace(/\r$/, ""));
  const result: DiffLine[] = [];

  for (const raw of lines) {
    // File/section metadata lines keep their full text (no marker).
    if (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file")
    ) {
      result.push({ text: raw, type: "header" });
      continue;
    }
    if (raw.startsWith("@@")) {
      result.push({ text: raw, type: "hunk" });
      continue;
    }
    if (raw.startsWith("\\ ")) {
      // "\ No newline at end of file"
      result.push({ text: raw, type: "context" });
      continue;
    }

    // Content lines: strip the leading marker so we only show it in the
    // signature gutter (avoids doubled +/− prefixes).
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      result.push({ text, type: "add" });
    } else if (marker === "-") {
      result.push({ text, type: "del" });
    } else {
      result.push({ text, type: "context" });
    }
  }

  return result;
}

export function App() {
  const [stagedFiles, setStagedFiles] = useState<FileDiff[]>([]);
  const [draftCommits, setDraftCommits] = useState<DraftCommit[]>([]);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [sampleMessage, setSampleMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState("Gemini 3.1 Flash-Lite");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalMessage, setGlobalMessage] = useState("");

  // Provider config state (managed only via the wizard modal).
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(
    null,
  );

  // Maps provider type -> whether an API key is already stored for it.
  // Lets the wizard skip the key-entry step when one exists.
  const [providerApiKeyStatus, setProviderApiKeyStatus] = useState<
    Record<string, boolean>
  >({});

  // Provider setup wizard modal state (3 steps: provider → model → api key).
  const [qpOpen, setQpOpen] = useState(false);
  const [qpProvider, setQpProvider] =
    useState<ProviderConfig["provider"]>("ollama");
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [wizardKey, setWizardKey] = useState("");
  // Whether the API-key step is in "change existing key" mode.
  const [wizardChangingKey, setWizardChangingKey] = useState(false);

  // Real-time activity log shown in the status panel.
  const [activityLog, setActivityLog] = useState<ActivityItem[]>([]);
  const [showActivity, setShowActivity] = useState(false);

  // PR creation state
  const [prOpen, setPrOpen] = useState(false);
  const [remotes, setRemotes] = useState<{ name: string; url: string }[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [prRemote, setPrRemote] = useState("");
  const [prBase, setPrBase] = useState("");
  const [prHead, setPrHead] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prDescription, setPrDescription] = useState("");
  const [prGenerating, setPrGenerating] = useState(false);
  const [prCreatedMsg, setPrCreatedMsg] = useState<string | null>(null);
  const [prLink, setPrLink] = useState<string | null>(null);

  // AI Overview collapse state
  const [aiOverviewCollapsed, setAiOverviewCollapsed] = useState<
    Record<string, boolean>
  >({});

  // Loading modal activities
  const [loadingActivities, setLoadingActivities] = useState<ActivityItem[]>(
    [],
  );
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  // Ref mirror for the modal state so the message listener (registered once
  // with empty deps) can always read the current value without a stale closure.
  const showLoadingModalRef = useRef(false);
  // Track if activities were added since the modal opened, so we can
  // auto-scroll the newest entry into view.
  const loadingModalBodyRef = useRef<HTMLDivElement>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);

  // Change-detection state: counts from the extension + a banner flag.
  const [changeNotice, setChangeNotice] = useState<{
    staged: number;
    unstaged: number;
  } | null>(null);

  // Tracks the last known working-directory snapshot for a dedicated banner.
  const [dirChanged, setDirChanged] = useState<boolean>(false);

  // Collapsible diff viewer state.
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(new Set());
  const [lastSnapshot, setLastSnapshot] = useState<{
    staged: number;
    unstaged: number;
    filesSignature: string;
    loadedCount: number;
  } | null>(null);

  const diffViewerRef = useRef<HTMLDivElement>(null);

  // Keep the ref in sync with the modal state for the stale-closure-safe
  // message listener below.
  useEffect(() => {
    showLoadingModalRef.current = showLoadingModal;
  }, [showLoadingModal]);

  // Auto-scroll the newest activity into view whenever the list changes.
  useEffect(() => {
    if (showLoadingModal && loadingActivities.length > 0) {
      requestAnimationFrame(() => {
        activityEndRef.current?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [loadingActivities, showLoadingModal]);

  useEffect(() => {
    vscode.postMessage({ command: "loadStaged" });
    vscode.postMessage({ command: "getProviderConfig" });
    // Quick initial status check.
    vscode.postMessage({ command: "reloadChanges" });

    // Poll the extension for git status changes.
    const pollId = window.setInterval(() => {
      vscode.postMessage({ command: "reloadChanges" });
    }, 5000);

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data as ExtensionToWebviewMessage;
      switch (msg.command) {
        case "setStagedOverview":
          setStagedFiles(msg.files);
          break;
        case "setLoading":
          setLoading(msg.value);
          showLoadingModalRef.current = msg.value;
          if (msg.value) {
            setShowLoadingModal(true);
            setLoadingActivities([]);
          } else {
            setTimeout(() => {
              showLoadingModalRef.current = false;
              setShowLoadingModal(false);
              setLoadingActivities([]);
            }, 500);
          }
          break;
        case "planGenerated":
          setDraftCommits(msg.plan.commits);
          if (msg.plan.commits.length > 0) {
            setSelectedCommitId(msg.plan.commits[0].id);
          }
          setError(null);
          setLoading(false);
          setShowLoadingModal(false);
          break;
        case "singleRegenerated":
          setDraftCommits((prev) =>
            prev.map((c) => (c.id === msg.commit.id ? msg.commit : c)),
          );
          setError(null);
          break;
        case "changesDetected":
          setChangeNotice({ staged: msg.staged, unstaged: msg.unstaged });
          break;
        case "gitSnapshot": {
          const snap = msg.snapshot;
          // Show the "working directory changed" banner when the actual staged
          // file contents changed, not just the counts.
          if (
            lastSnapshot &&
            lastSnapshot.filesSignature !== snap.filesSignature
          ) {
            setDirChanged(true);
          }
          setLastSnapshot(snap);
          break;
        }
        case "apiKeyPrompted":
          setError(null);
          break;
        case "activity":
          setActivityLog((prev) => [...prev.slice(-49), msg.activity]);
          setShowActivity(true);
          // Also add to loading modal activities if modal is open.
          // Use the ref (not the state variable) so the closure registered once
          // with empty deps never reads a stale value.
          if (showLoadingModalRef.current) {
            setLoadingActivities((prev) => [...prev.slice(-49), msg.activity]);
          }
          break;
        case "providerConfigLoaded":
          setProviderConfig(msg.config);
          break;
        case "providerApiKeyStatus":
          setProviderApiKeyStatus(msg.status);
          break;
        case "remoteInfoLoaded":
          setRemotes(msg.remotes);
          setBranches(msg.branches);
          setCurrentBranch(msg.currentBranch || "");
          setDefaultBranch(msg.defaultBranch || "main");
          setPrRemote(msg.remotes[0]?.name || "");
          setPrBase(msg.defaultBranch || "main");
          setPrHead(msg.currentBranch || "");
          break;
        case "prContentGenerated":
          if (msg.title) setPrTitle(msg.title);
          if (msg.description) setPrDescription(msg.description);
          setPrGenerating(false);
          break;
        case "prCreated":
          setPrCreatedMsg(msg.message || "Pull request created!");
          setPrLink(msg.url || null);
          setPrGenerating(false);
          break;
        case "error":
          setError(msg.message);
          setLoading(false);
          setShowLoadingModal(false);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(pollId);
    };
  }, []);

  const selectedCommit = draftCommits.find((c) => c.id === selectedCommitId);
  const activeFiles = selectedCommit ? selectedCommit.files : stagedFiles;

  const handleAutoCompose = () => {
    setError(null);
    setGlobalMessage("");
    setLoading(true);
    setShowLoadingModal(true);
    setLoadingActivities([]);
    vscode.postMessage({
      command: "generatePlan",
      prompt: instructions,
      model: selectedModel,
      instructions,
      sampleMessage,
    });
  };

  const handleGenerateGlobal = () => {
    setError(null);
    vscode.postMessage({
      command: "generatePlan",
      prompt: globalMessage || instructions,
      model: selectedModel,
      instructions,
      sampleMessage,
    });
  };

  const handleRegenerateSingle = (commit: DraftCommit) => {
    setError(null);
    vscode.postMessage({
      command: "regenerateSingle",
      commitId: commit.id,
      prompt: instructions,
    });
  };

  const handleExecuteAll = () => {
    if (draftCommits.length === 0) return;
    setError(null);
    const plan: DraftCommitPlan = { commits: draftCommits, summary: "" };
    vscode.postMessage({ command: "executeCommits", plan });
    setDraftCommits([]);
    setSelectedCommitId(null);
  };

  const openPrModal = () => {
    setError(null);
    setPrCreatedMsg(null);
    setPrLink(null);
    setPrOpen(true);
    // Request remote/branch info.
    vscode.postMessage({ command: "getRemoteInfo" });
    // Load existing draft plan for PR content (if any).
    if (draftCommits.length > 0) {
      vscode.postMessage({
        command: "generatePrContent",
        title: true,
        description: true,
        plan: { commits: draftCommits, summary: "" },
      });
      setPrGenerating(true);
    }
  };

  const generatePrTitleOnly = () => {
    setPrGenerating(true);
    vscode.postMessage({
      command: "generatePrContent",
      title: true,
      plan: { commits: draftCommits, summary: "" },
    });
  };

  const generatePrDescOnly = () => {
    setPrGenerating(true);
    vscode.postMessage({
      command: "generatePrContent",
      description: true,
      plan: { commits: draftCommits, summary: "" },
    });
  };

  const createPr = () => {
    if (!prRemote || !prBase || !prHead || !prTitle.trim()) return;
    setError(null);
    setPrGenerating(true);
    vscode.postMessage({
      command: "createPullRequest",
      remote: prRemote,
      baseBranch: prBase,
      headBranch: prHead,
      title: prTitle.trim(),
      body: prDescription,
    });
  };

  const handleCancel = () => {
    setDraftCommits([]);
    setSelectedCommitId(null);
    setError(null);
  };

  const handleReloadChanges = () => {
    // Ask the extension to refresh the staged overview, then clear the banner.
    vscode.postMessage({ command: "loadStaged" });
    setChangeNotice(null);
  };

  const handleProviderChange = (provider: ProviderConfig["provider"]) => {
    const defaults = PROVIDER_DEFAULTS[provider];
    if (!defaults) return;
    setProviderConfig({
      provider,
      label: defaults.label,
      baseUrl: defaults.baseUrl,
      model: defaults.model || defaults.models[0] || "",
      models: defaults.models,
      allowCustomBaseUrl: defaults.allowCustomBaseUrl,
      requiresApiKey: defaults.requiresApiKey,
      recommendedModel: defaults.recommendedModel,
      apiKey: providerConfig?.apiKey || "",
    });
  };

  const openQuickPick = () => {
    setQpProvider(providerConfig?.provider ?? "ollama");
    setSetupStep(1);
    setWizardKey("");
    setWizardChangingKey(false);
    setQpOpen(true);
  };

  const clearActivityLog = () => {
    setActivityLog([]);
    setShowActivity(false);
  };

  const selectQpProvider = (provider: ProviderConfig["provider"]) => {
    setQpProvider(provider);
    handleProviderChange(provider);
    setSetupStep(2);
  };

  const selectQpModel = (model: string) => {
    setSelectedModel(model);
    if (providerConfig) {
      setProviderConfig({ ...providerConfig, model });
    }
    const needsKey = PROVIDER_DEFAULTS[qpProvider]?.requiresApiKey;
    if (needsKey) {
      // Always go to the key step for providers that need a key. If one is
      // already saved, the step shows "Done"/"Change Key" instead of an input.
      setSetupStep(3);
      setWizardChangingKey(false);
    } else {
      setQpOpen(false);
    }
  };

  const finishWizard = (skipSave = false) => {
    if (providerConfig && !skipSave) {
      const configToSave: ProviderConfig = {
        ...providerConfig,
        apiKey: wizardKey.trim() || providerConfig.apiKey,
      };
      vscode.postMessage({
        command: "saveProviderConfig",
        config: configToSave,
      });
    }
    setQpOpen(false);
  };

  // ── Compact sidebar variant ──
  if (isSidebar) {
    return (
      <div className="sidebar-root">
        <div className="sidebar-heading">Commit Composer</div>

        <div className="sidebar-provider">
          <span className="current-model-provider">
            {providerConfig?.label || "AI"}
          </span>
          <span className="current-model-name">
            {providerConfig?.model || selectedModel}
          </span>
        </div>

        <button className="btn outline-btn sidebar-btn" onClick={openQuickPick}>
          🔍 Change model / provider
        </button>

        {error && <div className="error-banner">{error}</div>}

        <button
          className="btn primary-btn sidebar-btn sidebar-generate"
          onClick={() => vscode.postMessage({ command: "openEditor" })}
          disabled={loading}
        >
          {loading ? "Working…" : "⚡ Generate Commits"}
        </button>
        <p className="card-subtext">
          Opens the full Commit Composer panel in an editor tab.
        </p>

        {qpOpen && (
          <div className="quick-pick-overlay" onClick={() => setQpOpen(false)}>
            <div className="quick-pick" onClick={(e) => e.stopPropagation()}>
              <div className="quick-pick-header">
                {setupStep > 1 && (
                  <button
                    className="btn small-btn"
                    onClick={() => setSetupStep((s) => (s - 1) as 1 | 2 | 3)}
                    title="Go back"
                  >
                    ← Back
                  </button>
                )}
                <h3>
                  {setupStep === 1
                    ? "Step 1 · Select Provider"
                    : setupStep === 2
                      ? "Step 2 · Select Model"
                      : "Step 3 · Enter API Key"}
                </h3>
                <button
                  className="btn small-btn"
                  onClick={() => setQpOpen(false)}
                >
                  ✕
                </button>
              </div>
              {setupStep === 1 && (
                <div className="quick-pick-body">
                  <div className="quick-pick-section">
                    Choose an AI provider
                  </div>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <div
                      key={opt.provider}
                      className={`qp-item ${qpProvider === opt.provider ? "selected" : ""}`}
                      onClick={() => selectQpProvider(opt.provider)}
                    >
                      <span className="qp-item-label">{opt.label}</span>
                      {PROVIDER_DEFAULTS[opt.provider]?.requiresApiKey ? (
                        <span className="qp-item-meta">🔑 API key</span>
                      ) : (
                        <span className="qp-item-meta">✓ No key</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {setupStep === 2 && (
                <div className="quick-pick-body">
                  <div className="quick-pick-section">Select Model</div>
                  {(PROVIDER_DEFAULTS[qpProvider]?.models || []).map(
                    (model) => (
                      <div
                        key={model}
                        className={`qp-item ${providerConfig?.model === model ? "active" : ""}`}
                        onClick={() => selectQpModel(model)}
                      >
                        <span className="qp-item-label">
                          {model}
                          {PROVIDER_DEFAULTS[qpProvider]?.recommendedModel ===
                          model
                            ? " (recommended)"
                            : ""}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
              {setupStep === 3 && (
                <div className="quick-pick-body">
                  <div className="quick-pick-section">
                    API Key · {PROVIDER_DEFAULTS[qpProvider]?.label}
                  </div>
                  {providerApiKeyStatus[qpProvider] ? (
                    <p className="card-subtext qp-help">
                      ✓ API key already configured.
                    </p>
                  ) : (
                    <p className="card-subtext qp-help">
                      This provider requires an API key. It will be saved
                      securely to your VS Code settings.
                    </p>
                  )}

                  {/* Only show the input when adding a new key (no key saved)
                      or when the user explicitly clicked "Change Key". */}
                  {(!providerApiKeyStatus[qpProvider] || wizardChangingKey) && (
                    <input
                      type="password"
                      className="vscode-input"
                      placeholder="sk-... or paste your key"
                      value={wizardKey}
                      onChange={(e) => setWizardKey(e.target.value)}
                      autoFocus
                    />
                  )}

                  <div className="provider-actions">
                    <button
                      className="btn secondary-btn"
                      onClick={() => setSetupStep(2)}
                    >
                      ← Change model
                    </button>
                    {providerApiKeyStatus[qpProvider] && !wizardChangingKey ? (
                      <>
                        <button
                          className="btn secondary-btn"
                          onClick={() => {
                            setWizardKey("");
                            setWizardChangingKey(true);
                          }}
                        >
                          Change Key
                        </button>
                        <button
                          className="btn primary-btn"
                          onClick={() => finishWizard()}
                        >
                          Done
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn primary-btn"
                        onClick={() => finishWizard()}
                        disabled={!wizardKey.trim()}
                      >
                        Done
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="quick-pick-footer">
                <span>Step {setupStep} of 3</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="composer-container">
      {/* Loading Modal */}
      {showLoadingModal && (
        <div className="loading-modal-overlay">
          <div className="loading-modal">
            <div className="loading-modal-header">
              <div className="loading-spinner"></div>
              <h3>Generating Commits</h3>
            </div>
            <div className="loading-modal-body" ref={loadingModalBodyRef}>
              {loadingActivities.length === 0 ? (
                <div className="loading-placeholder">
                  <p>Analyzing changes...</p>
                  <div className="loading-dots">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </div>
                </div>
              ) : (
                loadingActivities.map((a) => (
                  <div key={a.id} className={`loading-activity-item ${a.type}`}>
                    <span className="loading-activity-icon">
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
                    <span className="loading-activity-message">
                      {a.message}
                    </span>
                    <span className="loading-activity-time">{a.timestamp}</span>
                  </div>
                ))
              )}
              <div ref={activityEndRef} />
            </div>
          </div>
        </div>
      )}

      <aside className="left-panel">
        <header className="panel-header">
          <h2>
            Commit Composer <span className="badge">PREVIEW</span>
          </h2>
          <div className="header-actions">
            <button
              className={`settings-button ${showActivity ? "active" : ""}`}
              onClick={() => setShowActivity((v) => !v)}
              title="Activity log"
              aria-label="Toggle activity log"
            >
              🪵 Activity
            </button>
          </div>
        </header>

        <div className="left-panel-body">
          <div className="card compose-card">
            <h3>Auto-Compose Commits</h3>
            <p className="card-subtext">
              Let AI organize your changes into well-formed commits with clear
              messages.
            </p>

            <div className="current-model">
              <span className="current-model-provider">
                {providerConfig?.label || "AI"}
              </span>
              <span className="current-model-name">
                {providerConfig?.model || selectedModel}
              </span>
            </div>
            <button
              className="btn outline-btn provider-link-btn"
              onClick={openQuickPick}
            >
              🔍 Change model / provider
            </button>

            <label className="form-label">Instructions (optional)</label>
            <textarea
              placeholder="Include additional instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="input-textarea"
            />

            <label className="form-label">
              Sample commit message (optional)
            </label>
            <textarea
              placeholder="Paste a commit message to use as a style reference…"
              value={sampleMessage}
              onChange={(e) => setSampleMessage(e.target.value)}
              className="input-textarea"
            />

            {error && <div className="error-banner">{error}</div>}

            <button
              onClick={handleAutoCompose}
              disabled={loading}
              className="btn primary-btn"
            >
              {loading ? "Analyzing changes..." : "✨ Auto-Compose Commits"}
            </button>
          </div>

          {showActivity && (
            <div className="activity-panel">
              <div className="activity-header">
                <h3>Activity Log</h3>
                <button className="btn small-btn" onClick={clearActivityLog}>
                  Clear
                </button>
              </div>
              <div className="activity-body">
                {activityLog.length === 0 && (
                  <p className="card-subtext">No activity yet.</p>
                )}
                {activityLog.map((a) => (
                  <div key={a.id} className={`activity-item ${a.type}`}>
                    <span className="activity-type">
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
                    <span className="activity-message">{a.message}</span>
                    <span className="activity-time">{a.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="section-title">Draft Commits</div>

          <div className="commits-timeline">
            <div
              className={`timeline-node ${selectedCommitId === null ? "active" : ""}`}
              onClick={() => setSelectedCommitId(null)}
              role="button"
              tabIndex={0}
            >
              <div className="node-icon">●</div>
              <div className="node-details">
                <div className="node-title">All Staged Changes</div>
                <div className="node-meta">
                  {stagedFiles.length} file{stagedFiles.length === 1 ? "" : "s"}
                  <span className="additions">
                    +{stagedFiles.reduce((a, f) => a + f.additions, 0)}
                  </span>
                  <span className="deletions">
                    -{stagedFiles.reduce((a, f) => a + f.deletions, 0)}
                  </span>
                </div>
              </div>
            </div>

            {draftCommits.map((commit) => (
              <div
                key={commit.id}
                className={`timeline-node ${selectedCommitId === commit.id ? "active" : ""}`}
                onClick={() => setSelectedCommitId(commit.id)}
                role="button"
                tabIndex={0}
              >
                <div className="node-connector" />
                <div className="node-icon">◯</div>
                <div className="node-details">
                  <div className="node-title">
                    {commit.type}: {commit.subject}
                  </div>
                  <div className="node-meta">
                    {commit.files.length} file
                    {commit.files.length === 1 ? "" : "s"}
                    <span className="additions">
                      +{commit.files.reduce((a, f) => a + f.additions, 0)}
                    </span>
                    <span className="deletions">
                      -{commit.files.reduce((a, f) => a + f.deletions, 0)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="finish-section">
            <h4>Finish & Commit</h4>
            <button
              onClick={handleExecuteAll}
              disabled={draftCommits.length === 0 || loading}
              className="btn action-btn"
            >
              Create {draftCommits.length} Commit
              {draftCommits.length === 1 ? "" : "s"}
            </button>
            <button
              onClick={openPrModal}
              disabled={loading}
              className="btn secondary-btn"
            >
              🔀 Create Pull Request
            </button>
            <button
              onClick={handleCancel}
              disabled={draftCommits.length === 0}
              className="btn secondary-btn"
            >
              Cancel
            </button>
          </div>
        </div>
      </aside>

      <main className="main-stage">
        <div className="main-stage-content">
          {selectedCommit ? (
            <div className="commit-editor-wrapper">
              <div className="commit-editor-header">
                <div className="commit-message-box">
                  <input
                    type="text"
                    value={`${selectedCommit.type}: ${selectedCommit.subject}`}
                    onChange={(e) => {
                      const value = e.target.value;
                      const [type, ...rest] = value.split(":");
                      setDraftCommits((prev) =>
                        prev.map((c) =>
                          c.id === selectedCommit.id
                            ? {
                                ...c,
                                type: (type || "").trim(),
                                subject: rest.join(":").trim(),
                              }
                            : c,
                        ),
                      );
                    }}
                    className="commit-title-input"
                    placeholder="feat: commit subject"
                  />
                  <textarea
                    value={selectedCommit.overview}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDraftCommits((prev) =>
                        prev.map((c) =>
                          c.id === selectedCommit.id
                            ? { ...c, overview: value }
                            : c,
                        ),
                      );
                    }}
                    className="commit-body-input"
                    placeholder="Commit body overview..."
                  />
                </div>
                <button
                  className="btn outline-btn regenerate-btn"
                  onClick={() => handleRegenerateSingle(selectedCommit)}
                  disabled={loading}
                >
                  {loading ? "Regenerating..." : "✨ Regenerate Message"}
                </button>
              </div>

              {selectedCommit.aiOverview && (
                <div className="ai-overview-container">
                  <div
                    className="ai-overview-header clickable"
                    onClick={() =>
                      setAiOverviewCollapsed((prev) => ({
                        ...prev,
                        [selectedCommit.id]: !prev[selectedCommit.id],
                      }))
                    }
                    role="button"
                    tabIndex={0}
                  >
                    <span
                      className={`ai-overview-arrow ${
                        aiOverviewCollapsed[selectedCommit.id]
                          ? "collapsed"
                          : ""
                      }`}
                    >
                      ▸
                    </span>
                    <span className="ai-overview-label">🤖 AI Overview</span>
                    <span className="ai-overview-badge">AI-generated</span>
                  </div>
                  {!aiOverviewCollapsed[selectedCommit.id] && (
                    <div className="ai-overview-content">
                      <div className="ai-overview-text">
                        {selectedCommit.aiOverview}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="overview-header">
              <input
                type="text"
                placeholder="Enter a global commit summary..."
                value={globalMessage}
                onChange={(e) => setGlobalMessage(e.target.value)}
                className="commit-title-input"
              />
              <button
                className="btn outline-btn"
                onClick={handleGenerateGlobal}
                disabled={loading}
              >
                {loading ? "Generating..." : "Generate Message"}
              </button>
            </div>
          )}

          <div className="stage-header">
            <h3>Files Changed ({activeFiles.length})</h3>
            <div className="stage-header-actions">
              <button
                className="btn small-btn"
                onClick={() =>
                  setCollapsedFiles(new Set(activeFiles.map((_, i) => i)))
                }
                title="Collapse all file diffs"
              >
                ▾ Collapse All
              </button>
              <button
                className="btn small-btn"
                onClick={() => setCollapsedFiles(new Set())}
                title="Expand all file diffs"
              >
                ▸ Expand All
              </button>
              <button
                className="btn small-btn refresh-btn"
                onClick={handleReloadChanges}
                title="Reload latest staged changes"
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {changeNotice && (
            <div className="change-banner">
              <div className="change-banner-icon">⚠️</div>
              <div className="change-banner-text">
                <strong>Changes detected</strong>
                <span>
                  {changeNotice.staged} staged · {changeNotice.unstaged}{" "}
                  unstaged
                </span>
              </div>
              <div className="change-banner-actions">
                <button className="btn small-btn" onClick={handleReloadChanges}>
                  ↻ Reload
                </button>
                <button
                  className="btn small-btn"
                  onClick={() => setChangeNotice(null)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {dirChanged && !changeNotice && (
            <div className="change-banner dir-banner">
              <div className="change-banner-icon">🔄</div>
              <div className="change-banner-text">
                <strong>Working directory has changed</strong>
                <span>
                  The staged diff is out of date. Reload to see the latest
                  changes.
                </span>
              </div>
              <div className="change-banner-actions">
                <button className="btn small-btn" onClick={handleReloadChanges}>
                  ↻ Reload
                </button>
                <button
                  className="btn small-btn"
                  onClick={() => setDirChanged(false)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <div className="diff-viewer-list" ref={diffViewerRef}>
            {activeFiles.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">📄</div>
                <h3>No staged changes</h3>
                <p>
                  Stage changes in the Source Control view — they will appear
                  here.
                </p>
              </div>
            )}

            {activeFiles.map((file, idx) => {
              const diffLines = parseDiffLines(file.diffText);
              const isCollapsed = collapsedFiles.has(idx);
              let oldLine = 0;
              let newLine = 0;
              return (
                <div key={idx} className="file-diff-card">
                  <div
                    className="file-header clickable"
                    onClick={() =>
                      setCollapsedFiles((prev) => {
                        const next = new Set(prev);
                        if (next.has(idx)) next.delete(idx);
                        else next.add(idx);
                        return next;
                      })
                    }
                    role="button"
                    tabIndex={0}
                  >
                    <span
                      className={`collapse-arrow ${isCollapsed ? "collapsed" : ""}`}
                    >
                      ▸
                    </span>
                    <span className="file-path">{file.path}</span>
                    <span className="file-counts">
                      <span className="additions">+{file.additions}</span>
                      <span className="deletions">-{file.deletions}</span>
                    </span>
                    <span className={`status-tag ${file.status.toLowerCase()}`}>
                      {file.status}
                    </span>
                  </div>
                  {!isCollapsed && (
                    <div className="diff-lines">
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
                            className={`diff-line ${line.type}`}
                          >
                            <span className="gutter old">{oldNum}</span>
                            <span className="gutter new">{newNum}</span>
                            <span
                              className={`gutter sign ${line.type === "add" ? "add" : line.type === "del" ? "del" : ""}`}
                            >
                              {line.type === "add"
                                ? "+"
                                : line.type === "del"
                                  ? "−"
                                  : " "}
                            </span>
                            <span className="diff-line-text">{line.text}</span>
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
      </main>

      {prOpen && (
        <div className="pr-overlay" onClick={() => setPrOpen(false)}>
          <div className="pr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pr-modal-header">
              <h3>🔀 Create Pull Request</h3>
              <button
                className="btn small-btn"
                onClick={() => setPrOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="pr-modal-body">
              {prCreatedMsg && (
                <div className="pr-success-box">
                  <div className="success-banner">
                    <span>✅</span>
                    <span>{prCreatedMsg}</span>
                  </div>
                  {prLink && (
                    <button
                      className="btn primary-btn"
                      onClick={() => window.open(prLink, "_blank")}
                    >
                      Open Pull Request ↗
                    </button>
                  )}
                </div>
              )}

              <label className="form-label">Remote</label>
              <select
                className="input-select"
                value={prRemote}
                onChange={(e) => setPrRemote(e.target.value)}
              >
                {remotes.length === 0 && (
                  <option value="">No remotes found</option>
                )}
                {remotes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} — {r.url}
                  </option>
                ))}
              </select>

              <div className="pr-row">
                <div>
                  <label className="form-label">Base branch</label>
                  <select
                    className="input-select"
                    value={prBase}
                    onChange={(e) => setPrBase(e.target.value)}
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
                  <label className="form-label">Head branch</label>
                  <select
                    className="input-select"
                    value={prHead}
                    onChange={(e) => setPrHead(e.target.value)}
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

              <label className="form-label">Title</label>
              <div className="pr-title-row">
                <input
                  className="commit-title-input"
                  placeholder="feat: ..."
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                />
                <button
                  className="btn small-btn"
                  onClick={generatePrTitleOnly}
                  disabled={prGenerating}
                >
                  {prGenerating ? "…" : "✨ Title"}
                </button>
              </div>

              <label className="form-label">Description (Markdown)</label>
              <div className="pr-desc-row">
                <textarea
                  className="input-textarea pr-desc-textarea"
                  placeholder="PR description..."
                  value={prDescription}
                  onChange={(e) => setPrDescription(e.target.value)}
                />
                <button
                  className="btn small-btn pr-desc-gen"
                  onClick={generatePrDescOnly}
                  disabled={prGenerating}
                >
                  {prGenerating ? "…" : "✨ Desc"}
                </button>
              </div>

              {error && <div className="error-banner">{error}</div>}
            </div>

            <div className="pr-modal-footer">
              <button
                className="btn secondary-btn"
                onClick={() => setPrOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn action-btn"
                onClick={createPr}
                disabled={
                  prGenerating ||
                  !prRemote ||
                  !prBase ||
                  !prHead ||
                  !prTitle.trim()
                }
              >
                {prGenerating ? "Working…" : "Create Pull Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {qpOpen && (
        <div className="quick-pick-overlay" onClick={() => setQpOpen(false)}>
          <div className="quick-pick" onClick={(e) => e.stopPropagation()}>
            <div className="quick-pick-header">
              {setupStep > 1 && (
                <button
                  className="btn small-btn"
                  onClick={() => setSetupStep((s) => (s - 1) as 1 | 2 | 3)}
                  title="Go back"
                >
                  ← Back
                </button>
              )}
              <h3>
                {setupStep === 1
                  ? "Step 1 · Select Provider"
                  : setupStep === 2
                    ? "Step 2 · Select Model"
                    : "Step 3 · Enter API Key"}
              </h3>
              <button
                className="btn small-btn"
                onClick={() => setQpOpen(false)}
              >
                ✕
              </button>
            </div>

            {setupStep === 1 && (
              <div className="quick-pick-body">
                <div className="quick-pick-section">Choose an AI provider</div>
                {PROVIDER_OPTIONS.map((opt) => (
                  <div
                    key={opt.provider}
                    className={`qp-item ${qpProvider === opt.provider ? "selected" : ""}`}
                    onClick={() => selectQpProvider(opt.provider)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="qp-item-label">{opt.label}</span>
                    {PROVIDER_DEFAULTS[opt.provider]?.requiresApiKey ? (
                      <span className="qp-item-meta">🔑 API key</span>
                    ) : (
                      <span className="qp-item-meta">✓ No key</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {setupStep === 2 && (
              <div className="quick-pick-body">
                <div className="quick-pick-section">
                  Models · {PROVIDER_DEFAULTS[qpProvider]?.label || "Provider"}
                </div>
                {(PROVIDER_DEFAULTS[qpProvider]?.models || []).map((model) => (
                  <div
                    key={model}
                    className={`qp-item ${providerConfig?.model === model ? "active" : ""}`}
                    onClick={() => selectQpModel(model)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="qp-item-label">
                      {model}
                      {PROVIDER_DEFAULTS[qpProvider]?.recommendedModel === model
                        ? " (recommended)"
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {setupStep === 3 && (
              <div className="quick-pick-body">
                <div className="quick-pick-section">
                  API Key · {PROVIDER_DEFAULTS[qpProvider]?.label}
                </div>
                {providerApiKeyStatus[qpProvider] ? (
                  <p className="card-subtext qp-help">
                    ✓ API key already configured.
                  </p>
                ) : (
                  <p className="card-subtext qp-help">
                    This provider requires an API key. It will be saved securely
                    to your VS Code settings.
                  </p>
                )}

                {(!providerApiKeyStatus[qpProvider] || wizardChangingKey) && (
                  <input
                    type="password"
                    className="vscode-input"
                    placeholder="sk-... or paste your key"
                    value={wizardKey}
                    onChange={(e) => setWizardKey(e.target.value)}
                    autoFocus
                  />
                )}

                <div className="provider-actions">
                  <button
                    className="btn secondary-btn"
                    onClick={() => setSetupStep(2)}
                  >
                    ← Change model
                  </button>
                  {providerApiKeyStatus[qpProvider] && !wizardChangingKey ? (
                    <>
                      <button
                        className="btn secondary-btn"
                        onClick={() => {
                          setWizardKey("");
                          setWizardChangingKey(true);
                        }}
                      >
                        Change Key
                      </button>
                      <button
                        className="btn primary-btn"
                        onClick={() => finishWizard()}
                      >
                        Done
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn primary-btn"
                      onClick={() => finishWizard()}
                      disabled={!wizardKey.trim()}
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="quick-pick-footer">
              <span>Step {setupStep} of 3</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
