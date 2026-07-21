import { useState } from "react";
import { ArrowRight, Buildings, Users, CurrencyDollar, ChatCircle } from "@phosphor-icons/react";

const moduleIcons = {
  hr: Users,
  finance: CurrencyDollar,
  biz: Buildings,
  communication: ChatCircle,
};

const defaultModule = "hr";

export default function StepTarget({ wizardData, updateWizard, goNext }) {
  const [selectedModule, setSelectedModule] = useState(wizardData.selectedModule || defaultModule);
  const [selectedEntity, setSelectedEntity] = useState(wizardData.selectedEntity || null);

  const currentModule = wizardData.modules.find((m) => m.module === selectedModule);
  const Icon = moduleIcons[selectedModule] || Buildings;

  const handleContinue = () => {
    if (!selectedEntity) return;
    updateWizard({ selectedModule, selectedEntity });
    goNext();
  };

  return (
    <div className="animate-fadeIn">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-text-muted">
          Step 1 of 5
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
          Select Import Target
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Choose the module and entity type you want to import data into.
        </p>
      </div>

      {/* Module selector */}
      <div className="mb-8">
        <label className="mb-3 block text-sm font-medium text-text-secondary">
          Module
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {wizardData.modules.map((m) => {
            const ModIcon = moduleIcons[m.module] || Buildings;
            const isActive = selectedModule === m.module;
            return (
              <button
                key={m.module}
                onClick={() => {
                  setSelectedModule(m.module);
                  setSelectedEntity(null);
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-all ${
                  isActive
                    ? "border-brand-500 bg-brand-500/10 text-brand-400"
                    : "border-border bg-surface-elevated text-text-secondary hover:border-border-light hover:text-text-primary"
                }`}
              >
                <ModIcon size={24} weight={isActive ? "fill" : "regular"} />
                <span className="text-xs font-medium">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Entity selector */}
      {currentModule && (
        <div className="mb-8">
          <label className="mb-3 block text-sm font-medium text-text-secondary">
            Entity Type
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {currentModule.entities.map((e) => {
              const isActive = selectedEntity?.entityKey === e.entityKey;
              const requiredFields = e.fields.filter((f) => f.required);
              return (
                <button
                  key={e.entityKey}
                  onClick={() => setSelectedEntity(e)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    isActive
                      ? "border-brand-500 bg-brand-500/10"
                      : "border-border bg-surface-elevated hover:border-border-light"
                  }`}
                >
                  <p
                    className={`text-sm font-semibold ${
                      isActive ? "text-brand-400" : "text-text-primary"
                    }`}
                  >
                    {e.label}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {e.fields.length} fields &middot;{" "}
                    {requiredFields.length} required
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {e.fields.slice(0, 4).map((f) => (
                      <span
                        key={f.key}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          f.required
                            ? "bg-brand-500/15 text-brand-300"
                            : "bg-surface-hover text-text-muted"
                        }`}
                      >
                        {f.label}
                      </span>
                    ))}
                    {e.fields.length > 4 && (
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-muted">
                        +{e.fields.length - 4} more
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Continue */}
      <button
        onClick={handleContinue}
        disabled={!selectedEntity}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue
        <ArrowRight weight="bold" size={16} />
      </button>
    </div>
  );
}
