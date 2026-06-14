"use client";

import { useState } from "react";
import { Sparkles, Plus } from "lucide-react";
import { AeoWizardModal } from "./aeo-wizard-modal";

export function CreateProjectCard() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <>
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 shadow-sm flex flex-col items-center justify-center text-center space-y-4 hover:border-violet-300 transition-all duration-300">
        <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600">
          <Sparkles className="h-6 w-6 animate-pulse" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-black text-slate-800">Add New Project</h3>
          <p className="text-[11px] text-slate-400 font-medium max-w-xs leading-relaxed">
            Discover target countries, check topics, and analyze visibility across conversational AI engines.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsWizardOpen(true)}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-md active:scale-[0.98] transition-all cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" /> Start Setup Wizard
        </button>
      </div>

      <AeoWizardModal isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
    </>
  );
}
