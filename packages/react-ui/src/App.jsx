import { useState, useCallback } from "react";
import Hero from "./components/Hero";
import StepTarget from "./components/StepTarget";
import StepUpload from "./components/StepUpload";
import StepMapping from "./components/StepMapping";
import StepValidation from "./components/StepValidation";
import StepCommit from "./components/StepCommit";
import { mockModules } from "./api/mockData";

const STEPS = ["target", "upload", "mapping", "validate", "commit"];

export default function App() {
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState({
    modules: mockModules,
    selectedModule: null,
    selectedEntity: null,
    importJob: null,
    fieldMap: {},
    validationResult: null,
    commitResult: null,
  });

  const goNext = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, STEPS.length));
  }, []);

  const goBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const updateWizard = useCallback((patch) => {
    setWizardData((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setCurrentStep(0);
    setWizardData({
      modules: mockModules,
      selectedModule: null,
      selectedEntity: null,
      importJob: null,
      fieldMap: {},
      validationResult: null,
      commitResult: null,
    });
  }, []);

  if (currentStep === 0) {
    return <Hero onStart={() => setCurrentStep(1)} />;
  }

  const stepProps = { wizardData, updateWizard, goNext, goBack, reset };

  return (
    <div className="min-h-dvh bg-surface text-text-primary">
      {/* Top nav bar */}
      <header className="sticky top-0 z-50 border-b border-border bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <button
            onClick={reset}
            className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/10 text-xs font-bold text-brand-400">
              D
            </span>
            Data Onboarder
          </button>

          {/* Step indicators */}
          <div className="flex items-center gap-1">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                    i < currentStep
                      ? "bg-brand-500 text-white"
                      : i === currentStep
                      ? "border border-brand-500 text-brand-400"
                      : "border border-border text-text-muted"
                  }`}
                >
                  {i < currentStep ? "✓" : i + 1}
                </div>
                <span
                  className={`ml-1.5 hidden text-xs font-medium sm:block ${
                    i === currentStep ? "text-text-primary" : "text-text-muted"
                  }`}
                >
                  {step.charAt(0).toUpperCase() + step.slice(1)}
                </span>
                {i < STEPS.length - 1 && (
                  <div
                    className={`mx-2 h-px w-6 ${
                      i < currentStep ? "bg-brand-500" : "bg-border"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Step content */}
      <main className="mx-auto max-w-4xl px-6 py-12">
        {currentStep === 1 && <StepTarget {...stepProps} />}
        {currentStep === 2 && <StepUpload {...stepProps} />}
        {currentStep === 3 && <StepMapping {...stepProps} />}
        {currentStep === 4 && <StepValidation {...stepProps} />}
        {currentStep === 5 && <StepCommit {...stepProps} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center">
        <p className="text-xs text-text-muted">
          Universal Data Onboarding Engine &mdash; Demo Mode
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Connect to a running backend to use real data.
        </p>
      </footer>
    </div>
  );
}
