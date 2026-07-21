import { ArrowRight, UploadSimple, GitMerge, CheckCircle, Database } from "@phosphor-icons/react";

export default function Hero({ onStart }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-500/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-brand-600/5 blur-3xl" />
      </div>

      <div className="relative z-10 flex max-w-3xl flex-col items-center text-center">
        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-1.5 text-xs font-medium text-text-secondary">
          <span className="flex h-2 w-2 rounded-full bg-success" />
          Import Wizard Demo
        </div>

        {/* Title */}
        <h1 className="text-balance text-4xl font-bold tracking-tight text-text-primary sm:text-5xl lg:text-6xl">
          Universal Data
          <br />
          <span className="bg-gradient-to-r from-brand-300 to-brand-500 bg-clip-text text-transparent">
            Onboarding Engine
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-text-secondary">
          A streaming-safe, adapter-driven pipeline for importing CSV, JSON, XLSX,
          and SQL data. Parse, map, validate, and commit rows idempotently with
          zero data loss.
        </p>

        {/* CTA */}
        <button
          onClick={onStart}
          className="mt-10 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:bg-brand-600 hover:shadow-xl hover:shadow-brand-500/30 active:scale-[0.98]"
        >
          Start Import Wizard
          <ArrowRight weight="bold" size={18} />
        </button>

        {/* Feature pills */}
        <div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { icon: UploadSimple, label: "Streaming Parse" },
            { icon: GitMerge, label: "Column Mapping" },
            { icon: CheckCircle, label: "Row Validation" },
            { icon: Database, label: "Idempotent Commit" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-elevated px-4 py-4 transition-colors hover:border-border-light"
            >
              <Icon size={22} className="text-brand-400" />
              <span className="text-xs font-medium text-text-secondary">
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* GitHub link */}
        <a
          href="https://github.com/IhsanKhann/universal-data-onboarder"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-12 text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary"
        >
          View on GitHub →
        </a>
      </div>
    </div>
  );
}
