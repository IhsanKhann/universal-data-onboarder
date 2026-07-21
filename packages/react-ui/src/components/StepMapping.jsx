import { useState } from "react";
import { ArrowRight, ArrowLeft, GitMerge, Check } from "@phosphor-icons/react";
import { mockColumns, mockFields } from "../api/mockData";

export default function StepMapping({ wizardData, updateWizard, goNext, goBack }) {
  const entity = wizardData.selectedEntity;
  const fields = entity?.fields || mockFields;
  const columns = mockColumns;
  const [fieldMap, setFieldMap] = useState(wizardData.fieldMap || {});

  const updateMapping = (fieldKey, column) => {
    setFieldMap((prev) => ({ ...prev, [fieldKey]: column }));
  };

  const autoMap = () => {
    const map = {};
    fields.forEach((f) => {
      const match = columns.find(
        (c) => c.toLowerCase() === f.key.toLowerCase() || c.toLowerCase() === f.label.toLowerCase()
      );
      if (match) map[f.key] = match;
    });
    setFieldMap(map);
  };

  const mappedCount = Object.keys(fieldMap).length;
  const requiredFields = fields.filter((f) => f.required);
  const requiredMapped = requiredFields.filter((f) => fieldMap[f.key]).length;
  const allRequired = requiredMapped === requiredFields.length;

  const handleContinue = () => {
    if (!allRequired) return;
    updateWizard({ fieldMap });
    goNext();
  };

  return (
    <div className="animate-fadeIn">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted">
            Step 3 of 5
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
            Map Columns
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            Map source columns to {entity?.label || "entity"} fields.
          </p>
        </div>
        <button
          onClick={autoMap}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-text-secondary transition-all hover:border-brand-500 hover:text-brand-400"
        >
          <GitMerge size={14} />
          Auto-map
        </button>
      </div>

      {/* Progress */}
      <div className="mb-6 flex items-center gap-2 rounded-xl bg-surface-hover px-4 py-2.5">
        <Check size={16} className={allRequired ? "text-success" : "text-text-muted"} />
        <span className="text-xs text-text-secondary">
          {requiredMapped} of {requiredFields.length} required fields mapped
        </span>
        <span className="ml-auto text-xs text-text-muted">
          {mappedCount} of {fields.length} total
        </span>
      </div>

      {/* Field mapping list */}
      <div className="space-y-2">
        {fields.map((f) => (
          <div
            key={f.key}
            className={`flex items-center gap-3 rounded-xl border p-3 ${
              fieldMap[f.key]
                ? "border-brand-500/30 bg-brand-500/5"
                : f.required
                ? "border-border bg-surface-elevated"
                : "border-border/60 bg-surface-elevated/50"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {f.label}
                </span>
                {f.required && (
                  <span className="rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-medium text-error">
                    Required
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {f.key} &middot; {f.type}
              </p>
            </div>

            <select
              value={fieldMap[f.key] || ""}
              onChange={(e) => updateMapping(f.key, e.target.value)}
              className={`rounded-lg border bg-surface px-3 py-2 text-xs ${
                fieldMap[f.key]
                  ? "border-brand-500/30 text-text-primary"
                  : "border-border text-text-muted"
              } focus:border-brand-500 focus:outline-none`}
            >
              <option value="">-- Select column --</option>
              {columns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
              <option value="__skip__">Skip this field</option>
            </select>

            {fieldMap[f.key] && (
              <button
                onClick={() => updateMapping(f.key, null)}
                className="rounded p-1 text-text-muted hover:text-error"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-text-secondary transition-all hover:border-border-light hover:text-text-primary"
        >
          <ArrowLeft weight="bold" size={16} />
          Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!allRequired}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
          <ArrowRight weight="bold" size={16} />
        </button>
      </div>
    </div>
  );
}
