import { useEffect, useRef, useState } from "react";
import { LeftPanel } from "./components/LeftPanel";
import { LoadingModal } from "./components/LoadingModal";
import { MainStage } from "./components/MainStage";
import { PrModal } from "./components/PrModal";
import { SidebarView } from "./components/SidebarView";
import { copyText } from "./lib/clipboard";
import { filterDiffToHunks } from "./lib/commitMessage";
import { isSidebar, sendMessage } from "./lib/vscodeApi";
import {
  ActivityItem,
  DraftCommit,
  DraftCommitPlan,
  ExtensionToWebviewMessage,
  FileDiff,
  PROVIDER_DEFAULTS,
  ProviderConfig,
  ProviderType,
} from "./types";

export function App() {
  const [stagedFiles, setStagedFiles] = useState<FileDiff[]>([]);
  const [draftCommits, setDraftCommits] = useState<DraftCommit[]>([]);
  const [planWarnings, setPlanWarnings] = useState<string[]>([]);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [sampleMessage, setSampleMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalMessage, setGlobalMessage] = useState("");

  // Provider config state (managed only via the wizard modal).
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(
    null,
  );
  // Ref mirroring providerConfig so async handlers always read the latest value.
  const providerConfigRef = useRef<ProviderConfig | null>(null);
  providerConfigRef.current = providerConfig;

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
  const [loadingVariant, setLoadingVariant] = useState<"commits" | "pr">(
    "commits",
  );
  const showLoadingModalRef = useRef(false);
  const loadingModalBodyRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    showLoadingModalRef.current = showLoadingModal;
  }, [showLoadingModal]);

  useEffect(() => {
    sendMessage({ command: "loadStaged" });
    sendMessage({ command: "getProviderConfig" });
    sendMessage({ command: "reloadChanges" });

    const pollId = window.setInterval(() => {
      sendMessage({ command: "reloadChanges" });
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
          setPlanWarnings(msg.warnings || []);
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
          // Keep the UI's selected model in sync with what's actually persisted.
          if (msg.config.model) {
            setSelectedModel(msg.config.model);
          }
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
          setShowLoadingModal(false);
          break;
        case "prCreated":
          setPrCreatedMsg(msg.message || "Pull request created!");
          setPrLink(msg.url || null);
          setPrGenerating(false);
          setShowLoadingModal(false);
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

  const selectedCommit =
    draftCommits.find((c) => c.id === selectedCommitId) || null;
  // Show only the hunks the selected commit will actually contain so the
  // preview matches the commit exactly.
  const activeFiles = selectedCommit
    ? selectedCommit.files.map((file) => {
        const change = (selectedCommit.changes || []).find((c) => c.file === file.path);
        if (!change || change.hunks.length === 0) {
          return file;
        }
        return { ...file, diffText: filterDiffToHunks(file.diffText, change.hunks) };
      })
    : stagedFiles;

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
    if (!treeClean || !prBase || !prHead || autoGeneratedRef.current) {
      return;
    }
    autoGeneratedRef.current = true;
    setPrGenerating(true);
    setShowLoadingModal(true);
    setLoadingVariant("pr");
    setLoadingActivities([]);
    sendMessage({
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
    setLoadingVariant("commits");
    setLoadingActivities([]);
    sendMessage({
      command: "generatePlan",
      prompt: instructions,
      model: selectedModel,
      instructions,
      sampleMessage,
    });
  };

  const handleGenerateGlobal = () => {
    setError(null);
    sendMessage({
      command: "generatePlan",
      prompt: globalMessage || instructions,
      model: selectedModel,
      instructions,
      sampleMessage,
    });
  };

  const handleRegenerateSingle = (commit: DraftCommit) => {
    setError(null);
    sendMessage({
      command: "regenerateSingle",
      commitId: commit.id,
      prompt: instructions,
    });
  };

  const handleExecuteAll = () => {
    if (draftCommits.length === 0) return;
    setError(null);
    const plan: DraftCommitPlan = { commits: draftCommits, summary: "" };
    sendMessage({ command: "executeCommits", plan });
    setDraftCommits([]);
    setPlanWarnings([]);
    setSelectedCommitId(null);
  };

  const openPrModal = () => {
    setError(null);
    setPrCreatedMsg(null);
    setPrLink(null);
    setPrOpen(true);
    sendMessage({ command: "getRemoteInfo" });
  };

  // Generate BOTH the PR title and description in a single AI request.
  // This avoids making 2 separate API calls (which can exhaust quotas) and
  // ensures the AI has full context to write a coherent PR.
  const generatePrContent = () => {
    if (!treeClean) return;
    setPrGenerating(true);
    setShowLoadingModal(true);
    setLoadingVariant("pr");
    setLoadingActivities([]);
    sendMessage({
      command: "generatePrContent",
      title: true,
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
    setShowLoadingModal(true);
    setLoadingVariant("pr");
    setLoadingActivities([]);
    sendMessage({
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
    setPlanWarnings([]);
    setSelectedCommitId(null);
    setError(null);
  };

  const handleReloadChanges = () => {
    sendMessage({ command: "loadStaged" });
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
      apiKey: providerConfigRef.current?.apiKey || "",
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

  const selectQpProvider = (provider: ProviderType) => {
    setQpProvider(provider);
    handleProviderChange(provider);
    setSetupStep(2);
  };

  const selectQpModel = (model: string) => {
    setSelectedModel(model);
    const current = providerConfigRef.current;
    if (current) {
      const nextConfig = { ...current, model };
      setProviderConfig(nextConfig);

      const needsKey = PROVIDER_DEFAULTS[qpProvider]?.requiresApiKey;
      if (needsKey) {
        setSetupStep(3);
        setWizardChangingKey(false);
      } else {
        // Persist immediately for providers without an API-key step
        setQpOpen(false);
        sendMessage({
          command: "saveProviderConfig",
          config: {
            ...nextConfig,
            apiKey: current.apiKey || "",
            // Always persist the Google provider under the canonical key.
            provider: qpProvider,
          },
        });
      }
    }
  };

  // Persist the current provider selection (provider/model/key) and close the
  // wizard. This is shared by BOTH the header "✓ Done" button (onDone) and the
  // final "Done" button so provider details are NEVER lost — including for
  // providers that require an API-key step.
  const saveAndCloseQuickPick = () => {
    const current = providerConfigRef.current;
    if (current) {
      const configToSave: ProviderConfig = {
        ...current,
        // Preserve any already-stored key when the user didn't type a new one.
        apiKey: wizardKey.trim() || current.apiKey,
      };
      sendMessage({
        command: "saveProviderConfig",
        config: configToSave,
      });
    }
    setQpOpen(false);
  };

  const finishWizard = (skipSave = false) => {
    if (skipSave) {
      setQpOpen(false);
      return;
    }
    saveAndCloseQuickPick();
  };

  // Sidebar handling for quick-pick state
  const handleCommitChange = (id: string, updates: Partial<DraftCommit>) => {
    setDraftCommits((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    );
  };

  // ── Compact sidebar variant ──
  if (isSidebar) {
    return (
      <SidebarView
        error={error}
        loading={loading}
        providerConfig={providerConfig}
        selectedModel={selectedModel}
        qpOpen={qpOpen}
        qpProvider={qpProvider}
        setupStep={setupStep}
        wizardKey={wizardKey}
        wizardChangingKey={wizardChangingKey}
        providerApiKeyStatus={providerApiKeyStatus}
        onOpenQp={openQuickPick}
        onCloseQp={saveAndCloseQuickPick}
        onSetSetupStep={setSetupStep}
        onSelectProvider={selectQpProvider}
        onSelectModel={selectQpModel}
        onWizardKeyChange={setWizardKey}
        onSetWizardChangingKey={setWizardChangingKey}
        onFinishWizard={finishWizard}
      />
    );
  }

  return (
    <div className="composer-container flex h-screen w-screen overflow-hidden container-webview">
      {/* Advanced Loading Modal with variant-aware title */}
      <LoadingModal
        show={showLoadingModal}
        activities={loadingActivities}
        variant={loadingVariant}
        bodyRef={loadingModalBodyRef}
      />

      <LeftPanel
        providerConfig={providerConfig}
        selectedModel={selectedModel}
        instructions={instructions}
        sampleMessage={sampleMessage}
        error={error}
        loading={loading}
        showActivity={showActivity}
        activityLog={activityLog}
        copiedAll={copiedAll}
        copiedItemId={copiedItemId}
        stagedFiles={stagedFiles}
        draftCommits={draftCommits}
        planWarnings={planWarnings}
        selectedCommitId={selectedCommitId}
        qpOpen={qpOpen}
        qpProvider={qpProvider}
        setupStep={setupStep}
        wizardKey={wizardKey}
        wizardChangingKey={wizardChangingKey}
        providerApiKeyStatus={providerApiKeyStatus}
        onToggleActivity={() => setShowActivity((v) => !v)}
        onOpenQuickPick={openQuickPick}
        onCloseQuickPick={saveAndCloseQuickPick}
        onSetSetupStep={setSetupStep}
        onSelectProvider={selectQpProvider}
        onSelectModel={selectQpModel}
        onWizardKeyChange={setWizardKey}
        onSetWizardChangingKey={setWizardChangingKey}
        onFinishWizard={finishWizard}
        onInstructionsChange={setInstructions}
        onSampleMessageChange={setSampleMessage}
        onAutoCompose={handleAutoCompose}
        onCopyAllLog={handleCopyAllLog}
        onClearLog={clearActivityLog}
        onCopyItem={handleCopyActivityItem}
        onSelectCommit={setSelectedCommitId}
        onExecuteAll={handleExecuteAll}
        onOpenPr={openPrModal}
        onCancel={handleCancel}
      />

      <MainStage
        selectedCommit={selectedCommit}
        aiOverviewCollapsed={aiOverviewCollapsed}
        loading={loading}
        globalMessage={globalMessage}
        activeFiles={activeFiles}
        collapsedFiles={collapsedFiles}
        changeNotice={changeNotice}
        dirChanged={dirChanged}
        onCommitChange={handleCommitChange}
        onRegenerate={handleRegenerateSingle}
        onToggleOverview={(id) =>
          setAiOverviewCollapsed((prev) => ({
            ...prev,
            [id]: !prev[id],
          }))
        }
        onGlobalMessageChange={setGlobalMessage}
        onGenerateGlobal={handleGenerateGlobal}
        onToggleCollapse={(idx) =>
          setCollapsedFiles((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
          })
        }
        onCollapseAll={() =>
          setCollapsedFiles(new Set(activeFiles.map((_, i) => i)))
        }
        onExpandAll={() => setCollapsedFiles(new Set())}
        onReload={handleReloadChanges}
        onDismissChangeNotice={() => setChangeNotice(null)}
        onDismissDirChanged={() => setDirChanged(false)}
      />

      <PrModal
        open={prOpen}
        remotes={remotes}
        branches={branches}
        currentBranch={currentBranch}
        defaultBranch={defaultBranch}
        prRemote={prRemote}
        prBase={prBase}
        prHead={prHead}
        prTitle={prTitle}
        prDescription={prDescription}
        prGenerating={prGenerating}
        prCreatedMsg={prCreatedMsg}
        prLink={prLink}
        treeClean={treeClean}
        changeNotice={changeNotice}
        error={error}
        draftCommits={draftCommits}
        onClose={() => setPrOpen(false)}
        onRemoteChange={setPrRemote}
        onBaseChange={setPrBase}
        onHeadChange={setPrHead}
        onTitleChange={setPrTitle}
        onDescriptionChange={setPrDescription}
        onGenerateTitle={generatePrContent}
        onGenerateDesc={generatePrContent}
        onCreate={createPr}
      />

    </div>
  );
}
