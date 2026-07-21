import { useState, useRef } from "react";
import {
  ArrowRight,
  ArrowLeft,
  UploadSimple,
  FileCsv,
  FileDoc,
  FileCode,
  FileTs,
  CircleNotch,
} from "@phosphor-icons/react";
import { mockParsePreview } from "../api/mockData";

export default function StepUpload({ wizardData, updateWizard, goNext, goBack }) {
  const [file, setFile] = useState(wizardData.importJob?.file || null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(wizardData.importJob?.preview || null);
  const inputRef = useRef(null);

  const sourceFormat = file?.name?.split(".").pop()?.toLowerCase() || "csv";
  const FormatIcon =
    sourceFormat === "csv"
      ? FileCsv
      : sourceFormat === "json"
      ? FileCode
      : sourceFormat === "xlsx"
      ? FileDoc
      : FileCode;

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleFile = (f) => {
    setFile(f);
    setParsing(true);
    setTimeout(() => {
      const parsed = mockParsePreview(f.name);
      setPreview(parsed);
      setParsing(false);
    }, 800);
  };

  const handleContinue = () => {
    if (!preview) return;
    updateWizard({
      importJob: { ...wizardData.importJob, file, preview, sourceFormat },
    });
    goNext();
  };

  return (
    <div className="animate-fadeIn">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-text-muted">
          Step 2 of 5
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
          Upload File
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Upload a CSV, JSON, XLSX, or SQL file to import.
        </p>
      </div>

      {/* Drop zone */}
      {!file && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-all ${
            dragging
              ? "border-brand-500 bg-brand-500/10"
              : "border-border bg-surface-elevated hover:border-border-light"
          }`}
        >
          <UploadSimple size={40} className="text-text-muted" />
          <p className="mt-4 text-sm font-medium text-text-primary">
            Drop your file here or click to browse
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Supports CSV, JSON, XLSX, and SQL files
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.json,.xlsx,.xls,.sql"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* File preview */}
      {file && (
        <div className="rounded-2xl border border-border bg-surface-elevated p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10">
              <FormatIcon size={24} className="text-brand-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">{file.name}</p>
              <p className="text-xs text-text-muted">
                {(file.size / 1024).toFixed(1)} KB &middot; {sourceFormat.toUpperCase()}
              </p>
            </div>
            <button
              onClick={() => { setFile(null); setPreview(null); }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              Remove
            </button>
          </div>

          {parsing && (
            <div className="mt-6 flex items-center gap-3 rounded-xl bg-surface-hover px-4 py-3">
              <CircleNotch size={18} className="animate-spin text-brand-400" />
              <span className="text-sm text-text-secondary">Parsing file...</span>
            </div>
          )}

          {preview && !parsing && (
            <div className="mt-6">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                Preview ({preview.rows} rows, {preview.columns.length} columns)
              </p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface-hover">
                      <th className="px-3 py-2 font-medium text-text-muted">#</th>
                      {preview.columns.map((col) => (
                        <th key={col} className="px-3 py-2 font-medium text-text-muted">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="px-3 py-2 text-text-muted">{i + 1}</td>
                        {preview.columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-text-primary">
                            {row[col] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
        <button
          onClick={handleContinue}
          disabled={!preview || parsing}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
          <ArrowRight weight="bold" size={16} />
        </button>
      </div>
    </div>
  );
}
