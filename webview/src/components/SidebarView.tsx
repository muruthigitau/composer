import { ProviderConfig } from "../types";
import { sendMessage } from "../lib/vscodeApi";
import { QuickPickModal } from "./QuickPickModal";

interface SidebarViewProps {
  error: string | null;
  loading: boolean;
  providerConfig: ProviderConfig | null;
  selectedModel: string;
  qpOpen: boolean;
  qpProvider: ProviderConfig["provider"];
  setupStep: 1 | 2 | 3;
  wizardKey: string;
  wizardChangingKey: boolean;
  providerApiKeyStatus: Record<string, boolean>;
  onOpenQp: () => void;
  onCloseQp: () => void;
  onSetSetupStep: (step: 1 | 2 | 3) => void;
  onSelectProvider: (provider: ProviderConfig["provider"]) => void;
  onSelectModel: (model: string) => void;
  onWizardKeyChange: (key: string) => void;
  onSetWizardChangingKey: (changing: boolean) => void;
  onFinishWizard: () => void;
}

export function SidebarView({
  error,
  loading,
  providerConfig,
  selectedModel,
  qpOpen,
  qpProvider,
  setupStep,
  wizardKey,
  wizardChangingKey,
  providerApiKeyStatus,
  onOpenQp,
  onCloseQp,
  onSetSetupStep,
  onSelectProvider,
  onSelectModel,
  onWizardKeyChange,
  onSetWizardChangingKey,
  onFinishWizard,
}: SidebarViewProps) {
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
        onClick={onOpenQp}
      >
        🔍 Change model / provider
      </button>

      {error && <div className="error-banner">{error}</div>}

      <button
        className="btn primary-btn sidebar-btn sidebar-generate w-full px-3 py-2.5 mt-1"
        onClick={() => sendMessage({ command: "openEditor" })}
        disabled={loading}
      >
        {loading ? "Working…" : "⚡ Generate Commits"}
      </button>
      <p className="card-subtext text-xs text-text-muted">
        Opens the full Commit Composer panel in an editor tab.
      </p>

      <QuickPickModal
        open={qpOpen}
        provider={qpProvider}
        setupStep={setupStep}
        providerConfig={providerConfig}
        wizardKey={wizardKey}
        wizardChangingKey={wizardChangingKey}
        providerApiKeyStatus={providerApiKeyStatus}
        onClose={onCloseQp}
        onSetSetupStep={onSetSetupStep}
        onSelectProvider={onSelectProvider}
        onSelectModel={onSelectModel}
        onWizardKeyChange={onWizardKeyChange}
        onSetWizardChangingKey={onSetWizardChangingKey}
        onFinishWizard={onFinishWizard}
      />
    </div>
  );
}