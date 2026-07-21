import { useState } from "react";
import { CheckCircle, Clock, FileText, ArrowClockwise } from "@phosphor-icons/react";
import { mockCommitResult } from "../api/mockData";

export default function StepCommit({ wizardData, updateWizard, goBack, reset }) {
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(wizardData.commitResult || null);

  const runCommit = () => {
    setCommitting(true);
    setTimeout(() => {
      const res = mockCommitResult;
      setResult(res);
      updateWizard({ commitResult: res });
      setCommitting(false);
    }, 2000);
  };

  const entity = wizardData.selectedEntity;

  return (
    <div className="animate-fadeIn">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-text-muted">
          Step 5 of 5
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
          Commit Data
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Idempotently commit validated rows to the target.
        </p>
      </div>

      {/* Summary */}
      <div className="mb-8 rounded-2xl border border-border bg-surface-elevated p-6">
        <h3 className="mb-4 text-sm font-semibold text-text-primary">Import Summary</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-xl bg-surface-hover px-4 py-3">
            <FileText size={18} className="text-brand-400" />
            <div>
              <p className="text-xs text-text-muted">Target</p>
              <p className="text-sm font-medium text-text-primary">
                {entity?.label || "Product"} ({wizardData.selectedModule})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-surface-hover px-4 py-3">
            <Clock size={18} className="text-brand-400" />
            <div>
              <p className="text-xs text-text-muted">Rows</p>
              <p className="text-sm font-medium text-text-primary">
                {wizardData.validationResult?.validCount || 0} valid of{" "}
                {wizardData.validationResult?.totalCount || 0} total
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Commit action */}
      {!result && (
        <div className="flex flex-col items-center rounded-2xl border border-border bg-surface-elevated p-12">
          <Clock size={48} className="text-text-muted" />
          <p className="mt-4 text-sm font-medium text-text-primary">Ready to commit</p>
          <p className="mt-1 text-xs text-text-muted">
            All validated rows will be committed idempotently
          </p>
          <button
            onClick={runCommit}
            disabled={committing}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {committing ? "Committing..." : "Commit Import"}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-6">
          <div
            className={`rounded-2xl border p-6 text-center ${
              result.status === "completed"
                ? "border-success/30 bg-success/5"
                : result.status === "completed_with_errors"
                ? "border-warning/30 bg-warning/5"
                : "border-error/30 bg-error/5"
            }`}
          >
            <CheckCircle
              size={48}
              className={`mx-auto ${
                result.status === "completed"
                  ? "text-success"
                  : result.status === "completed_with_errors"
                  ? "text-warning"
                  : "text-error"
              }`}
            />
            <p className="mt-4 text-lg font-bold text-text-primary">
              {result.status === "completed"
                ? "Import Complete!"
                : result.status === "completed_with_errors"
                ? "Completed with Errors"
                : "Import Failed"}
            </p>
            <p className="mt-2 text-sm text-text-secondary">{result.message}</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-center">
              <p className="text-2xl font-bold text-text-primary">{result.committed}</p>
              <p className="mt-1 text-xs text-text-muted">Committed</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-center">
              <p className="text-2xl font-bold text-warning">{result.skipped}</p>
              <p className="mt-1 text-xs text-text-muted">Skipped</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-center">
              <p className="text-2xl font-bold text-error">{result.failed}</p>
              <p className="mt-1 text-xs text-text-muted">Failed</p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-8 flex items-center justify-between">
        {!result && (
          <button
            onClick={goBack}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-text-secondary transition-all hover:border-border-light hover:text-text-primary"
          >
            Back
          </button>
        )}
        {result && (
          <div className="flex w-full justify-center gap-4">
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-6 py-2.5 text-sm font-medium text-text-secondary transition-all hover:border-border-light hover:text-text-primary"
            >
              <ArrowClockwise size={16} />
              Start Over
            </button>
            <a
              href="https://github.com/IhsanKhann/universal-data-onboarder"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-600"
            >
              View on GitHub
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
