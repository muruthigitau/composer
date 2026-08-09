import {
  PROVIDER_DEFAULTS,
  PROVIDER_OPTIONS,
  ProviderConfig,
  ProviderType,
} from "../types";

interface QuickPickModalProps {
  open: boolean;
  provider: ProviderConfig["provider"];
  setupStep: 1 | 2 | 3;
  providerConfig: ProviderConfig | null;
  wizardKey: string;
  wizardChangingKey: boolean;
  providerApiKeyStatus: Record<string, boolean>;
  onClose: () => void;
  onSetSetupStep: (step: 1 | 2 | 3) => void;
  onSelectProvider: (provider: ProviderType) => void;
  onSelectModel: (model: string) => void;
  onWizardKeyChange: (key: string) => void;
  onSetWizardChangingKey: (changing: boolean) => void;
  onFinishWizard: () => void;
}

export function QuickPickModal({
  open,
  provider,
  setupStep,
  providerConfig,
  wizardKey,
  wizardChangingKey,
  providerApiKeyStatus,
  onClose,
  onSetSetupStep,
  onSelectProvider,
  onSelectModel,
  onWizardKeyChange,
  onSetWizardChangingKey,
  onFinishWizard,
}: QuickPickModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-[rgba(0,0,0,0.4)] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="quick-pick w-[480px] max-w-[92vw] max-h-[70vh] flex flex-col bg-quickPickBg text-quickPickFg border border-border rounded-xl shadow-modal overflow-hidden animate-qp-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quick-pick-header flex items-center justify-between px-3.5 py-2.5 border-b border-border">
          {setupStep > 1 && (
            <button
              className="btn small-btn px-2 py-1 text-xs bg-bg-card text-text-primary border border-border rounded transition-colors duration-150 hover:bg-bg-hover hover:border-focus-border"
              onClick={() => onSetSetupStep((setupStep - 1) as 1 | 2 | 3)}
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
            onClick={onClose}
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
                className={`qp-item flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer border border-transparent text-text-primary transition-colors duration-150 hover:bg-bg-hover ${provider === opt.provider ? "selected bg-bg-active border-focus-border" : ""}`}
                onClick={() => onSelectProvider(opt.provider)}
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
              Models · {PROVIDER_DEFAULTS[provider]?.label || "Provider"}
            </div>
            {(PROVIDER_DEFAULTS[provider]?.models || []).map((model) => (
              <div
                key={model}
                className={`qp-item flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer border border-transparent text-text-primary transition-colors duration-150 hover:bg-bg-hover ${providerConfig?.model === model ? "active bg-bg-active border-focus-border" : ""}`}
                onClick={() => onSelectModel(model)}
                role="button"
                tabIndex={0}
              >
                <span className="qp-item-label flex-1 text-[13px]">
                  {model}
                  {PROVIDER_DEFAULTS[provider]?.recommendedModel === model
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
              API Key · {PROVIDER_DEFAULTS[provider]?.label}
            </div>
            {providerApiKeyStatus[provider] ? (
              <p className="card-subtext qp-help px-1 pb-1 text-text-muted text-xs">
                ✓ API key already configured.
              </p>
            ) : (
              <p className="card-subtext qp-help px-1 pb-1 text-text-muted text-xs">
                This provider requires an API key. It will be saved securely to
                your VS Code settings.
              </p>
            )}

            {(!providerApiKeyStatus[provider] || wizardChangingKey) && (
              <input
                type="password"
                className="vscode-input bg-bg-input border border-input-border text-text-primary rounded-md px-2.5 py-2 text-[13px] outline-none w-full transition-colors duration-150 focus:border-input-focus-border"
                placeholder="sk-... or paste your key"
                value={wizardKey}
                onChange={(e) => onWizardKeyChange(e.target.value)}
                autoFocus
              />
            )}

            <div className="provider-actions flex gap-2 mt-2">
              <button
                className="btn secondary-btn flex-1 bg-transparent text-text-primary border border-border rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150"
                onClick={() => onSetSetupStep(2)}
              >
                ← Change model
              </button>
              {providerApiKeyStatus[provider] && !wizardChangingKey ? (
                <>
                  <button
                    className="btn secondary-btn flex-1 bg-transparent text-text-primary border border-border rounded-md px-3.5 py-2 hover:bg-bg-hover hover:border-focus-border transition-colors duration-150"
                    onClick={() => {
                      onWizardKeyChange("");
                      onSetWizardChangingKey(true);
                    }}
                  >
                    Change Key
                  </button>
                  <></>
                </>
              ) : (
                <></>
              )}
            </div>
          </div>
        )}

        <div className="quick-pick-footer shrink-0 flex items-center justify-end px-3.5 py-2 border-t border-border text-[11px] text-text-muted">
          <span>Step {setupStep} of 3</span>
        </div>
      </div>
    </div>
  );
}
