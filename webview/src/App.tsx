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

/** Copy log/error text to the clipboard with a fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
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
  const [providerApiKeyStatus, setProviderApiKeyStatus] = useState<
    Record<string, boolean>
  >({});

  // Provider setup wizard modal state (3 steps: provider → model → api key).
  const [qpOpen, setQpOpen] = useState(false);
  const [qpProvider, setQpProvider] =
    useState<ProviderConfig["provider"]>("ollama");
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [wizardKey, setWizardKey] = useState("");
  const [wizardChangingKey, setWizardChangingKey] = useState(false);

  // Real-time activity log shown in the status panel.
  const [activityLog, setActivityLog] = useState<ActivityItem[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  // Copy feedback state for the activity log.
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const showLoadingModalRef = useRef(false);
  const loadingModalBodyRef = useRef<HTMLDivElement>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);

  // Change-detection state: counts from the extension + a banner flag.
  const [changeNotice, setChangeNotice] = useState<{
    staged: number;
    unstaged: number;
  } | null>(null);

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
    vscode.postMessage({ command: "reloadChanges" });

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

  const treeClean =
    changeNotice !== null &&
    changeNotice.staged === 0 &&
    changeNotice.unstaged === 0;

  const autoGeneratedRef = useRef(false);

  // Auto-generate PR title + description from committed differences once the
  // modal is open, remote info has populated base/head branches, and the
  // working tree is known to be clean.
  useEffect(() => {
    if (!prOpen) {
      autoGeneratedRef.current = false;
      return;
    }
    if (
      !treeClean ||
      !prBase ||
      !prHead ||
      draftCommits.length === 0 ||
      autoGeneratedRef.current
    ) {
      return;
    }
    autoGeneratedRef.current = true;
    setPrGenerating(true);
    vscode.postMessage({
      command: "generatePrContent",
      title: true,
      description: true,
      plan: { commits: draftCommits, summary: "" },
      baseBranch: prBase,
      headBranch: prHead,
    });
  }, [prOpen, treeClean, prBase, prHead, draftCommits]);

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
    vscode.postMessage({ command: "getRemoteInfo" });
  };

  const generatePrTitleOnly = () => {
    if (!treeClean) return;
    setPrGenerating(true);
    vscode.postMessage({
      command: "generatePrContent",
      title: true,
      plan: { commits: draftCommits, summary: "" },
      baseBranch: prBase,
      headBranch: prHead,
    });
  };

  const generatePrDescOnly = () => {
    if (!treeClean) return;
    setPrGenerating(true);
    vscode.postMessage({
      command: "generatePrContent",
      description: true,
      plan: { commits: draftCommits, summary: "" },
      baseBranch: prBase,
      headBranch: prHead,
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

  // Reset copy feedback after a short delay.
  const flashCopy = (reset: () => void) => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(reset, 1200);
  };

  const handleCopyAllLog = async () => {
    const text = activityLog
      .map((a) => `${a.timestamp} ${a.type.toUpperCase()}: ${a.message}`)
      .join("\n");
    if (!text.trim()) return;
    const ok = await copyText(text);
    if (ok) {
      setCopiedAll(true);
      flashCopy(() => setCopiedAll(false));
    }
  };

  const handleCopyActivityItem = async (item: ActivityItem) => {
    const text = `${item.timestamp} ${item.type.toUpperCase()}: ${item.message}`;
    const ok = await copyText(text);
    if (ok) {
      setCopiedItemId(item.id);
      flashCopy(() => setCopiedItemId(null));
    }
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
      <div className="sidebar-root flex flex-col gap-3 p-3.5 h-screen w-full overflow-y-auto bg-bg-secondary text-text-primary">
        <div className="sidebar-heading text-sm font-semibold pb-2 border-b border-border">
          Commit Composer
        </div>

        <div className="sidebar-provider flex flex-col gap-0.5 p-2.5 bg-bg-input border border-input-border rounded-md">
          <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">
            {providerConfig?.label || "AI"}
          </span>
          <span className="text-[13px] font-semibold text-text-primary break-words">
            {providerConfig?.model || selectedModel}
          </span>
        </div>

        <button
          className="btn outline-btn sidebar-btn w-full px-3 py-2.5"
          onClick={openQuickPick}
        >
          🔍 Change model / provider
        </button>

        {error && <div className="error-banner">{error}</div>}

        <button
          className="btn primary-btn sidebar-btn sidebar-generate w-full px-3 py-2.5 mt-1"
          onClick={() => vscode.postMessage({ command: "openEditor" })}
          disabled={loading}
        >
          {loading ? "Working…" : "⚡ Generate Commits"}
        </button>
        <p className="card-subtext text-xs text-text-muted">
          Opens the full Commit Composer panel in an editor tab.
        </p>

        {qpOpen && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-[rgba(0,0,0,0.4)] backdrop-blur-[2px]"
            onClick={() => setQpOpen(false)}
          >
            <div
              className="quick-pick w-[480px] max-w-[92vw] max-h-[70vh] flex flex-col bg-quickPickBg text-quickPickFg border border-border rounded-xl shadow-modal overflow-hidden animate-qp-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="quick-pick-header flex items-center justify-between px-3.5 py-2.5 border-b border-border">
                {setupStep > 1 && (
                  <button
                    className="btn small-btn"
                    onClick={() => setSetupStep((s) => (s - 1) as 1 | 2 | 3)}
                    title="Go back"
                  >
                    ← Back
                  </button>
                )}
                <h3 className="text-[13px] font-semibold text-text-primary">
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
                <div className="quick-pick-body flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                  <div className="quick-pick-section text-[10px] font-bold uppercase tracking-[0.5px] text-text-muted px-2 py-2 pb-1">
                    Choose an AI provider
                  </div>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <div
                      key={opt.provider}
                      className={`qp-item flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer border border-transparent text-text-primary transition-colors duration-150 ${qpProvider === opt.provider ? "selected bg-bg-active border-focus-border" : ""}`}
                      onClick={() => selectQpProvider(opt.provider)}
                    >
                      <span className="qp-item-label flex-1 text-[13px]">
                        {opt.label}
                      </span>
                      {PROVIDER_DEFAULTS[opt.provider]?.requiresApiKey ? (
                        <span className="qp-item-meta text-[11px] text-text-muted shrink-0">
                          🔑 API key
                        </span>
                      ) : (
                        <span className="qp-item-meta text-[11px] text-text-muted shrink-0">
                          ✓ No key
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {setupStep === 2 && (
                <div className="quick-pick-body flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                  <div className="quick-pick-section text-[10px] font-bold uppercase tracking-[0.5px] text-text-muted px-2 py-2 pb-1">
                    Select Model
                  </div>
                  {(PROVIDER_DEFAULTS[qpProvider]?.models || []).map(
                    (model) => (
                      <div
                        key={model}
                        className={`qp-item flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer border border-transparent text-text-primary transition-colors duration-150 ${providerConfig?.model === model ? "active bg-bg-active border-focus-border" : ""}`}
                        onClick={() => selectQpModel(model)}
                      >
                        <span className="qp-item-label flex-1 text-[13px]">
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
                <div className="quick-pick-body flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                  <div className="quick-pick-section text-[10px] font-bold uppercase tracking-[0.5px] text-text-muted px-2 py-2 pb-1">
                    API Key · {PROVIDER_DEFAULTS[qpProvider]?.label}
                  </div>
                  {providerApiKeyStatus[qpProvider] ? (
                    <p className="card-subtext qp-help px-1 pb-1 text-text-muted text-xs">
                      ✓ API key already configured.
                    </p>
                  ) : (
                    <p className="card-subtext qp-help px-1 pb-1 text-text-muted text-xs">
                      This provider requires an API key. It will be saved
                      securely to your VS Code settings.
                    </p>
                  )}

                  {(!providerApiKeyStatus[qpProvider] || wizardChangingKey) && (
                    <input
                      type="password"
                      className="vscode-input bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border"
                      placeholder="sk-... or paste your key"
                      value={wizardKey}
                      onChange={(e) => setWizardKey(e.target.value)}
                      autoFocus
                    />
                  )}

                  <div className="provider-actions flex gap-2 mt-2">
                    <button
                      className="btn secondary-btn flex-1 bg-transparent text-text-primary border border-border rounded-md px-3.5 py-2"
                      onClick={() => setSetupStep(2)}
                    >
                      ← Change model
                    </button>
                    {providerApiKeyStatus[qpProvider] && !wizardChangingKey ? (
                      <>
                        <button
                          className="btn secondary-btn flex-1 bg-transparent text-text-primary border border-border rounded-md px-3.5 py-2"
                          onClick={() => {
                            setWizardKey("");
                            setWizardChangingKey(true);
                          }}
                        >
                          Change Key
                        </button>
                        <button
                          className="btn primary-btn flex-1 bg-button-bg text-button-fg rounded-md px-3.5 py-2 shadow-btn"
                          onClick={() => finishWizard()}
                        >
                          Done
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn primary-btn flex-1 bg-button-bg text-button-fg rounded-md px-3.5 py-2 shadow-btn disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => finishWizard()}
                        disabled={!wizardKey.trim()}
                      >
                        Done
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="quick-pick-footer shrink-0 flex items-center justify-end px-3.5 py-2 border-t border-border text-[11px] text-text-muted">
                <span>Step {setupStep} of 3</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="composer-container flex h-screen w-screen overflow-hidden container-webview">
      {/* Loading Modal */}
      {showLoadingModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(0,0,0,0.7)] backdrop-blur-[8px] animate-modal-fade-in">
          <div className="loading-modal w-[480px] max-w-[92vw] max-h-[80vh] bg-bg-secondary border border-border rounded-xl shadow-modal overflow-hidden flex flex-col">
            <div className="loading-modal-header flex items-center gap-3.5 px-6 py-5 border-b border-border bg-bg-card">
              <div className="loading-spinner w-7 h-7 border-[3px] border-border border-t-button-bg rounded-full animate-spin shrink-0" />
              <h3 className="text-base font-semibold text-text-primary">
                Generating Commits
              </h3>
            </div>
            <div
              className="loading-modal-body flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-2"
              ref={loadingModalBodyRef}
            >
              {loadingActivities.length === 0 ? (
                <div className="loading-placeholder flex items-center gap-2 py-5 text-text-muted text-sm">
                  <p>Analyzing changes...</p>
                  <div className="loading-dots inline-flex gap-0.5">
                    <span className="animate-dot-bounce [animation-delay:0s]">
                      .
                    </span>
                    <span className="animate-dot-bounce [animation-delay:0.2s]">
                      .
                    </span>
                    <span className="animate-dot-bounce [animation-delay:0.4s]">
                      .
                    </span>
                  </div>
                </div>
              ) : (
                loadingActivities.map((a) => (
                  <div
                    key={a.id}
                    className={`loading-activity-item flex items-start gap-2.5 px-3 py-2 rounded-md text-[13px] leading-relaxed animate-slide-in bg-bg-input border-l-[3px] border-border ${a.type === "loading" ? "border-l-alert-infoBorder text-text-primary" : a.type === "success" ? "border-l-success-text text-success-text bg-success-bg" : a.type === "error" ? "border-l-error-text text-error-text bg-error-bg" : a.type === "warning" ? "border-l-warning-text text-warning-text bg-warning-bg" : "border-l-alert-infoBorder text-text-primary bg-alert-infoBg"}`}
                  >
                    <span className="loading-activity-icon shrink-0 text-base">
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
                    <span className="loading-activity-message flex-1 break-words">
                      {a.message}
                    </span>
                    <span className="loading-activity-time shrink-0 text-text-muted text-[11px] self-center">
                      {a.timestamp}
                    </span>
                  </div>
                ))
              )}
              <div ref={activityEndRef} />
            </div>
          </div>
        </div>
      )}

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
              className={`settings-button text-xs px-2 py-1 whitespace-nowrap bg-bg-card border border-border rounded text-text-primary cursor-pointer transition-colors duration-150 ${showActivity ? "active bg-bg-hover border-focus-border" : ""}`}
              onClick={() => setShowActivity((v) => !v)}
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
              onClick={openQuickPick}
            >
              🔍 Change model / provider
            </button>

            <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px]">
              Instructions (optional)
            </label>
            <textarea
              placeholder="Include additional instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="input-textarea bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border resize-y min-h-[60px] leading-relaxed"
            />

            <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px]">
              Sample commit message (optional)
            </label>
            <textarea
              placeholder="Paste a commit message to use as a style reference…"
              value={sampleMessage}
              onChange={(e) => setSampleMessage(e.target.value)}
              className="input-textarea bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border resize-y min-h-[60px] leading-relaxed"
            />

            {error && (
              <div className="error-banner bg-error-bg border border-error-border rounded px-3 py-2 text-error-text text-xs animate-banner-in">
                {error}
              </div>
            )}

            <button
              onClick={handleAutoCompose}
              disabled={loading}
              className="btn primary-btn bg-button-bg text-button-fg w-full rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Analyzing changes..." : "✨ Auto-Compose Commits"}
            </button>
          </div>

          {showActivity && (
            <div className="activity-panel bg-bg-card border border-border rounded-lg overflow-hidden shrink-0">
              <div className="activity-header flex items-center justify-between px-3 py-2 border-b border-border">
                <h3 className="text-xs font-semibold text-text-primary">
                  Activity Log
                </h3>
                <div className="flex items-center gap-1.5">
                  <button
                    className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleCopyAllLog}
                    disabled={activityLog.length === 0}
                    title="Copy all log entries"
                  >
                    {copiedAll ? "✓ Copied" : "📋 Copy all"}
                  </button>
                  <button
                    className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                    onClick={clearActivityLog}
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
                    className={`activity-item flex items-start gap-2 text-xs leading-relaxed py-0.5 pl-1.5 border-l-[3px] border-border text-text-primary ${a.type === "info" ? "border-l-alert-infoBorder" : a.type === "loading" ? "border-l-alert-infoBorder text-text-primary" : a.type === "success" ? "border-l-success-text text-success-text" : a.type === "error" ? "border-l-error-text text-error-text" : a.type === "warning" ? "border-l-warning-text text-warning-text" : ""}`}
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
                      onClick={() => handleCopyActivityItem(a)}
                      title="Copy this entry"
                    >
                      {copiedItemId === a.id ? "✓" : "📋"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="section-title text-[11px] font-bold uppercase text-text-muted tracking-[0.5px]">
            Draft Commits
          </div>

          <div className="commits-timeline flex flex-col gap-0.5 relative">
            <div
              className={`timeline-node relative flex items-center gap-2.5 p-2.5 rounded-md cursor-pointer border border-transparent transition-colors duration-150 ${selectedCommitId === null ? "active bg-bg-active border-focus-border" : ""}`}
              onClick={() => setSelectedCommitId(null)}
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
                className={`timeline-node relative flex items-center gap-2.5 p-2.5 rounded-md cursor-pointer border border-transparent transition-colors duration-150 ${selectedCommitId === commit.id ? "active bg-bg-active border-focus-border" : ""}`}
                onClick={() => setSelectedCommitId(commit.id)}
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
              onClick={handleExecuteAll}
              disabled={draftCommits.length === 0 || loading}
              className="btn action-btn bg-button-bg text-button-fg w-full rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create {draftCommits.length} Commit
              {draftCommits.length === 1 ? "" : "s"}
            </button>
            <button
              onClick={openPrModal}
              disabled={loading}
              className="btn secondary-btn bg-transparent text-text-primary border border-border w-full rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🔀 Create Pull Request
            </button>
            <button
              onClick={handleCancel}
              disabled={draftCommits.length === 0}
              className="btn secondary-btn bg-transparent text-text-primary border border-border w-full rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </aside>

      <main className="main-stage flex-1 min-w-0 h-full flex flex-col bg-bg-primary overflow-hidden relative">
        <div className="main-stage-content flex-1 flex flex-col min-h-0 overflow-hidden relative">
          {selectedCommit ? (
            <div className="commit-editor-wrapper flex flex-col w-full shrink-0 bg-bg-secondary border-b border-border">
              <div className="commit-editor-header flex gap-4 px-6 py-4 items-start w-full">
                <div className="commit-message-box flex-1 flex flex-col gap-2.5 min-w-0">
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
                    className="commit-title-input bg-bg-input border border-input-border text-text-primary rounded-md px-3 py-2.5 text-sm font-medium outline-none w-full transition-colors duration-150 focus:border-input-focus-border placeholder:text-text-disabled"
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
                    className="commit-body-input bg-bg-input border border-input-border text-text-primary rounded-md px-3 py-2.5 text-[13px] outline-none w-full min-h-[80px] resize-y leading-relaxed transition-colors duration-150 focus:border-input-focus-border placeholder:text-text-disabled"
                    placeholder="Commit body overview..."
                  />
                </div>
                <button
                  className="btn outline-btn regenerate-btn shrink-0 self-start mt-0.5 px-4.5 py-2.5 text-[13px] bg-transparent text-text-primary border border-border rounded-md hover:bg-bg-hover hover:border-focus-border transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => handleRegenerateSingle(selectedCommit)}
                  disabled={loading}
                >
                  {loading ? "Regenerating..." : "✨ Regenerate Message"}
                </button>
              </div>

              {selectedCommit.aiOverview && (
                <div className="ai-overview-container flex flex-col mx-6 mb-4 bg-bg-card border border-border rounded-lg overflow-hidden transition-all duration-200">
                  <div
                    className="ai-overview-header flex items-center gap-2.5 px-4 py-3 bg-bg-secondary cursor-pointer select-none transition-colors duration-150 border-b border-border hover:bg-bg-hover"
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
                      className={`ai-overview-arrow text-text-muted text-xs transition-transform duration-200 inline-block ${aiOverviewCollapsed[selectedCommit.id] ? "collapsed -rotate-90" : ""}`}
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
                  {!aiOverviewCollapsed[selectedCommit.id] && (
                    <div className="ai-overview-content px-5 py-4 bg-bg-primary animate-slide-down">
                      <div className="ai-overview-text text-[13px] leading-[1.7] text-text-primary whitespace-pre-wrap break-words">
                        {selectedCommit.aiOverview}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="overview-header flex gap-3 px-6 py-4 border-b border-border shrink-0 bg-bg-secondary items-center w-full">
              <input
                type="text"
                placeholder="Enter a global commit summary..."
                value={globalMessage}
                onChange={(e) => setGlobalMessage(e.target.value)}
                className="commit-title-input flex-1 min-w-0 bg-bg-input border border-input-border text-text-primary rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors duration-150 focus:border-input-focus-border placeholder:text-text-disabled"
              />
              <button
                className="btn outline-btn shrink-0 whitespace-nowrap px-4.5 py-2.5 bg-transparent text-text-primary border border-border rounded-md hover:bg-bg-hover hover:border-focus-border transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleGenerateGlobal}
                disabled={loading}
              >
                {loading ? "Generating..." : "Generate Message"}
              </button>
            </div>
          )}

          <div className="stage-header px-6 py-3 border-b border-border flex items-center justify-between gap-3 shrink-0 bg-bg-secondary min-h-[52px]">
            <h3 className="text-[13px] font-semibold text-text-primary">
              Files Changed ({activeFiles.length})
            </h3>
            <div className="stage-header-actions flex gap-1.5 items-center shrink-0">
              <button
                className="btn small-btn shrink-0 px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                onClick={() =>
                  setCollapsedFiles(new Set(activeFiles.map((_, i) => i)))
                }
                title="Collapse all file diffs"
              >
                ▾ Collapse All
              </button>
              <button
                className="btn small-btn shrink-0 px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                onClick={() => setCollapsedFiles(new Set())}
                title="Expand all file diffs"
              >
                ▸ Expand All
              </button>
              <button
                className="btn small-btn shrink-0 px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                onClick={handleReloadChanges}
                title="Reload latest staged changes"
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {changeNotice && (
            <div className="change-banner flex items-center gap-3 mx-6 mt-3 px-3.5 py-2.5 bg-warning-bg border border-warning-border rounded-md text-warning-text text-[13px] shrink-0 animate-banner-in">
              <div className="change-banner-icon text-base shrink-0">⚠️</div>
              <div className="change-banner-text flex-1 flex flex-col gap-0.5 min-w-0">
                <strong className="text-[13px]">Changes detected</strong>
                <span className="text-xs text-text-muted">
                  {changeNotice.staged} staged · {changeNotice.unstaged}{" "}
                  unstaged
                </span>
              </div>
              <div className="change-banner-actions flex gap-1.5 shrink-0">
                <button
                  className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                  onClick={handleReloadChanges}
                >
                  ↻ Reload
                </button>
                <button
                  className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                  onClick={() => setChangeNotice(null)}
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
                  onClick={handleReloadChanges}
                >
                  ↻ Reload
                </button>
                <button
                  className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                  onClick={() => setDirChanged(false)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <div
            className="diff-viewer-list flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-6 flex flex-col gap-3.5 bg-bg-primary"
            ref={diffViewerRef}
          >
            {activeFiles.length === 0 && (
              <div className="empty-state flex flex-col items-center justify-center px-6 py-12 text-center border border-dashed border-border rounded-lg bg-bg-card flex-1 min-h-[300px]">
                <div className="empty-icon text-[44px] mb-3.5 opacity-50">
                  📄
                </div>
                <h3 className="text-[15px] mb-1.5 font-semibold text-text-primary">
                  No staged changes
                </h3>
                <p className="text-text-muted text-xs leading-relaxed max-w-[320px]">
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
                <div
                  key={idx}
                  className="file-diff-card border border-border rounded-md bg-bg-card overflow-hidden shrink-0"
                >
                  <div
                    className="file-header bg-bg-secondary px-3 py-2 flex items-center gap-2.5 text-xs font-mono border-b border-border min-h-[36px] cursor-pointer select-none transition-colors duration-150 hover:bg-bg-hover"
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
                      className={`collapse-arrow text-text-muted text-xs shrink-0 transition-transform duration-150 inline-block w-4 text-center ${isCollapsed ? "collapsed -rotate-90" : ""}`}
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
                      className={`status-tag text-[10px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${file.status.toLowerCase() === "added" ? "bg-diff-addBg text-diff-addText" : file.status.toLowerCase() === "modified" ? "bg-diff-hunkBg text-diff-hunkText" : "bg-diff-removeBg text-diff-removeText"}`}
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
                            className={`diff-line flex min-w-full whitespace-pre-wrap break-words ${line.type === "add" ? "bg-diff-addBg border-l-[3px] border-l-diff-addBorder" : line.type === "del" ? "bg-diff-removeBg border-l-[3px] border-l-diff-removeBorder" : line.type === "hunk" ? "bg-diff-hunkBg border-l-[3px] border-l-alert-infoBorder" : line.type === "header" ? "text-text-muted font-semibold" : ""}`}
                          >
                            <span className="gutter old shrink-0 px-1 text-right min-w-[2.2em] text-[11px] select-none opacity-60 text-text-muted text-diff-removeText">
                              {oldNum}
                            </span>
                            <span className="gutter new shrink-0 px-1 text-right min-w-[2.2em] text-[11px] select-none opacity-60 text-text-muted text-diff-addText">
                              {newNum}
                            </span>
                            <span
                              className={`gutter sign shrink-0 min-w-[1.5em] px-0.5 pl-1.5 text-center opacity-100 font-bold ${line.type === "add" ? "text-diff-addText" : line.type === "del" ? "text-diff-removeText" : ""}`}
                            >
                              {line.type === "add"
                                ? "+"
                                : line.type === "del"
                                  ? "−"
                                  : " "}
                            </span>
                            <span
                              className={`diff-line-text px-3 flex-1 min-w-0 whitespace-pre-wrap ${line.type === "add" ? "text-diff-addText" : line.type === "del" ? "text-diff-removeText" : line.type === "hunk" ? "text-diff-hunkText font-semibold" : line.type === "header" ? "text-text-muted" : "text-text-primary"}`}
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
      </main>

      {prOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(0,0,0,0.55)] backdrop-blur-[4px] animate-pr-in"
          onClick={() => setPrOpen(false)}
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
                onClick={() => setPrOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="pr-modal-body flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-2.5">
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
                  <strong>committed differences</strong> between the base and
                  head branches. Your working tree has{" "}
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

              <div className="pr-row grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px] mt-1">
                    Base branch
                  </label>
                  <select
                    className="input-field bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border"
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
                  <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px] mt-1">
                    Head branch
                  </label>
                  <select
                    className="input-field bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border"
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

              <label className="form-label text-[11px] font-semibold text-text-muted uppercase tracking-[0.5px]">
                Title
              </label>
              <div className="pr-title-row flex gap-2 items-center">
                <input
                  className="commit-title-input flex-1 bg-bg-input border border-input-border text-text-primary rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors duration-150 focus:border-input-focus-border placeholder:text-text-disabled"
                  placeholder="feat: ..."
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                />
                <button
                  className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={generatePrTitleOnly}
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
                  onChange={(e) => setPrDescription(e.target.value)}
                />
                <button
                  className="btn small-btn pr-desc-gen self-start whitespace-nowrap px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={generatePrDescOnly}
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
                onClick={() => setPrOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn action-btn w-auto min-w-[140px] bg-button-bg text-button-fg rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-[rgba(0,0,0,0.4)] backdrop-blur-[2px]"
          onClick={() => setQpOpen(false)}
        >
          <div
            className="quick-pick w-[480px] max-w-[92vw] max-h-[70vh] flex flex-col bg-quickPickBg text-quickPickFg border border-border rounded-xl shadow-modal overflow-hidden animate-qp-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="quick-pick-header flex items-center justify-between px-3.5 py-2.5 border-b border-border">
              {setupStep > 1 && (
                <button
                  className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                  onClick={() => setSetupStep((s) => (s - 1) as 1 | 2 | 3)}
                  title="Go back"
                >
                  ← Back
                </button>
              )}
              <h3 className="text-[13px] font-semibold text-text-primary">
                {setupStep === 1
                  ? "Step 1 · Select Provider"
                  : setupStep === 2
                    ? "Step 2 · Select Model"
                    : "Step 3 · Enter API Key"}
              </h3>
              <button
                className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
                onClick={() => setQpOpen(false)}
              >
                ✕
              </button>
            </div>

            {setupStep === 1 && (
              <div className="quick-pick-body flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                <div className="quick-pick-section text-[10px] font-bold uppercase tracking-[0.5px] text-text-muted px-2 py-2 pb-1">
                  Choose an AI provider
                </div>
                {PROVIDER_OPTIONS.map((opt) => (
                  <div
                    key={opt.provider}
                    className={`qp-item flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer border border-transparent text-text-primary transition-colors duration-150 hover:bg-bg-hover ${qpProvider === opt.provider ? "selected bg-bg-active border-focus-border" : ""}`}
                    onClick={() => selectQpProvider(opt.provider)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="qp-item-label flex-1 text-[13px]">
                      {opt.label}
                    </span>
                    {PROVIDER_DEFAULTS[opt.provider]?.requiresApiKey ? (
                      <span className="qp-item-meta text-[11px] text-text-muted shrink-0">
                        🔑 API key
                      </span>
                    ) : (
                      <span className="qp-item-meta text-[11px] text-text-muted shrink-0">
                        ✓ No key
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {setupStep === 2 && (
              <div className="quick-pick-body flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                <div className="quick-pick-section text-[10px] font-bold uppercase tracking-[0.5px] text-text-muted px-2 py-2 pb-1">
                  Models · {PROVIDER_DEFAULTS[qpProvider]?.label || "Provider"}
                </div>
                {(PROVIDER_DEFAULTS[qpProvider]?.models || []).map((model) => (
                  <div
                    key={model}
                    className={`qp-item flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer border border-transparent text-text-primary transition-colors duration-150 hover:bg-bg-hover ${providerConfig?.model === model ? "active bg-bg-active border-focus-border" : ""}`}
                    onClick={() => selectQpModel(model)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="qp-item-label flex-1 text-[13px]">
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
              <div className="quick-pick-body flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                <div className="quick-pick-section text-[10px] font-bold uppercase tracking-[0.5px] text-text-muted px-2 py-2 pb-1">
                  API Key · {PROVIDER_DEFAULTS[qpProvider]?.label}
                </div>
                {providerApiKeyStatus[qpProvider] ? (
                  <p className="card-subtext qp-help px-1 pb-1 text-text-muted text-xs">
                    ✓ API key already configured.
                  </p>
                ) : (
                  <p className="card-subtext qp-help px-1 pb-1 text-text-muted text-xs">
                    This provider requires an API key. It will be saved securely
                    to your VS Code settings.
                  </p>
                )}

                {(!providerApiKeyStatus[qpProvider] || wizardChangingKey) && (
                  <input
                    type="password"
                    className="vscode-input bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border"
                    placeholder="sk-... or paste your key"
                    value={wizardKey}
                    onChange={(e) => setWizardKey(e.target.value)}
                    autoFocus
                  />
                )}

                <div className="provider-actions flex gap-2 mt-2">
                  <button
                    className="btn secondary-btn flex-1 bg-transparent text-text-primary border border-border rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150"
                    onClick={() => setSetupStep(2)}
                  >
                    ← Change model
                  </button>
                  {providerApiKeyStatus[qpProvider] && !wizardChangingKey ? (
                    <>
                      <button
                        className="btn secondary-btn flex-1 bg-transparent text-text-primary border border-border rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150"
                        onClick={() => {
                          setWizardKey("");
                          setWizardChangingKey(true);
                        }}
                      >
                        Change Key
                      </button>
                      <button
                        className="btn primary-btn flex-1 bg-button-bg text-button-fg rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150"
                        onClick={() => finishWizard()}
                      >
                        Done
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn primary-btn flex-1 bg-button-bg text-button-fg rounded-md px-3.5 py-2 shadow-btn hover:bg-button-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => finishWizard()}
                      disabled={!wizardKey.trim()}
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="quick-pick-footer shrink-0 flex items-center justify-end px-3.5 py-2 border-t border-border text-[11px] text-text-muted">
              <span>Step {setupStep} of 3</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
