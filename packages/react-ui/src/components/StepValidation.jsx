import { useState } from "react";
import { ArrowRight, ArrowLeft, CheckCircle, XCircle, Warning, ListChecks } from "@phosphor-icons/react";
import { mockValidationResult } from "../api/mockData";

export default function StepValidation({ wizardData, updateWizard, goNext, goBack }) {
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState(wizardData.validationResult || null);

  const runValidation = () => {
    setValidating(true);
    setTimeout(() => {
      const res = mockValidationResult;
      setResult(res);
      setValidating(false);
    }, 1200);
  };

  const handleContinue = () => {
    if (!result) return;
    updateWizard({ validationResult: result });
    goNext();
  };

  const errorPct = result ? ((result.invalidCount / result.totalCount) * 100).toFixed(0) : 0;

  return (
    <div className="animate-fadeIn">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-text-muted">
          Step 4 of 5
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
          Validate Rows
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Run validation rules against the mapped data.
        </p>
      </div>

      {/* Run validation */}
      {!result && (
        <div className="flex flex-col items-center rounded-2xl border border-border bg-surface-elevated p-12">
          <ListChecks size={48} className="text-text-muted" />
          <p className="mt-4 text-sm font-medium text-text-primary">
            Ready to validate {wizardData.importJob?.preview?.rows || 0} rows
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Checks include required fields, format validation, and duplicate detection
          </p>
          <button
            onClick={runValidation}
            disabled={validating}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {validating ? "Validating..." : "Run Validation"}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-center">
              <p className="text-2xl font-bold text-text-primary">{result.totalCount}</p>
              <p className="mt-1 text-xs text-text-muted">Total Rows</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-center">
              <p className="text-2xl font-bold text-success">{result.validCount}</p>
              <p className="mt-1 text-xs text-text-muted">Valid</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-center">
              <p className="text-2xl font-bold text-error">{result.invalidCount}</p>
              <p className="mt-1 text-xs text-text-muted">Invalid</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full rounded-full bg-success transition-all duration-500"
              style={{ width: `${100 - Number(errorPct)}%` }}
            />
          </div>

          {/* Errors list */}
          {result.sampleErrors.length > 0 && (
            <div>
              <p className="mb-3 text-sm font-medium text-text-primary">
                Sample Errors ({result.sampleErrors.length} shown)
              </p>
              <div className="space-y-2">
                {result.sampleErrors.map((err, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-xl border border-border/60 bg-surface-hover p-3"
                  >
                    <XCircle size={18} className="mt-0.5 shrink-0 text-error" />
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        Row {err.row}
                      </p>
                      <p className="mt-0.5 text-xs text-text-secondary">{err.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.invalidCount === 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-success/10 px-4 py-3">
              <CheckCircle size={20} className="text-success" />
              <p className="text-sm text-text-primary">
                All rows passed validation!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-text-secondary transition-all hover:border-border-light hover:text-text-primary"
        >
          <ArrowLeft weight="bold" size={16} />
          Back
        </button>
        {result && (
          <button
            onClick={handleContinue}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-600"
          >
            Continue
            <ArrowRight weight="bold" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
