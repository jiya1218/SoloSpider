"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useProjects } from "@/hooks/useProjects";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { 
  Loader2, CheckCircle2, ChevronRight, AlertTriangle, 
  MapPin, Sparkles, Database, Plus, Play, Check 
} from "lucide-react";

type WizardStep = 1 | 2 | 3 | 4;

type TopicObj = {
  topic: string;
  description: string;
  volume: "High" | "Medium" | "Low";
};

type PromptObj = {
  topic: string;
  prompt: string;
  rationale: string;
  selected?: boolean;
};

const COUNTRIES = [
  { name: "United States", code: "US" },
  { name: "India", code: "IN" },
  { name: "United Kingdom", code: "GB" },
  { name: "Canada", code: "CA" },
  { name: "Australia", code: "AU" },
  { name: "Germany", code: "DE" },
  { name: "France", code: "FR" },
  { name: "Singapore", code: "SG" },
  { name: "United Arab Emirates", code: "AE" }
];

interface AeoWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AeoWizardModal({ isOpen, onClose }: AeoWizardModalProps) {
  const { addProject, canAddProject, currentPlan, projectLimit } = useProjects();
  const [step, setStep] = useState<WizardStep>(1);
  const [domain, setDomain] = useState("");
  const [brandName, setBrandName] = useState("");
  
  // Step 1 -> 2 state
  const [selectedLocation, setSelectedLocation] = useState("United States");
  const [deducedExplanation, setDeducedExplanation] = useState("");
  const [discoveredTopics, setDiscoveredTopics] = useState<TopicObj[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<Record<string, boolean>>({});
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);

  // Step 2 -> 3 state
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [prompts, setPrompts] = useState<PromptObj[]>([]);
  const [editingPromptIdx, setEditingPromptIdx] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState("");

  // Step 3 -> 4 state
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  function normalizeUrl(raw: string) {
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) return `https://${raw}`;
    return raw;
  }

  // Action: Discover Topics (Step 1 -> Step 2)
  const handleDiscoverTopics = async () => {
    if (!domain) {
      toast.error("Please enter a domain URL");
      return;
    }
    if (!canAddProject) {
      toast.error(`Your ${currentPlan} plan is limited to ${projectLimit} project(s).`);
      return;
    }

    setLoadingTopics(true);
    setStep(2);
    try {
      const res = await fetch("/api/aeo/discover-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, brandName }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to analyze website");

      if (data.targetLocation) {
        setSelectedLocation(data.targetLocation);
      }
      if (data.explanation) {
        setDeducedExplanation(data.explanation);
      }
      if (data.competitors && Array.isArray(data.competitors)) {
        setCompetitors(data.competitors);
      } else {
        setCompetitors([]);
      }
      if (data.topics && Array.isArray(data.topics)) {
        setDiscoveredTopics(data.topics);
        const activeTopics: Record<string, boolean> = {};
        data.topics.forEach((t: TopicObj) => {
          activeTopics[t.topic] = true; // select all by default
        });
        setSelectedTopics(activeTopics);
      } else {
        throw new Error("No topics discovered");
      }
    } catch (err: any) {
      toast.error(err?.message || "An error occurred during discovery");
      setStep(1);
    } finally {
      setLoadingTopics(false);
    }
  };

  // Action: Craft Prompts (Step 2 -> Step 3)
  const handleCraftPrompts = async () => {
    const focusTopics = Object.keys(selectedTopics).filter(t => selectedTopics[t]);
    if (focusTopics.length === 0) {
      toast.error("Please select at least one topic to track");
      return;
    }

    setLoadingPrompts(true);
    setStep(3);
    try {
      const res = await fetch("/api/aeo/generate-prompts-wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: brandName || domain,
          domain: normalizeUrl(domain),
          location: selectedLocation,
          selectedTopics: focusTopics,
          competitors: competitors,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to craft prompts");

      if (Array.isArray(data)) {
        const formatted = data.map((p: any) => ({
          ...p,
          selected: true
        }));
        setPrompts(formatted);
      } else {
        throw new Error("Invalid prompts array response");
      }
    } catch (err: any) {
      toast.error(err?.message || "An error occurred during query generation");
      setStep(2);
    } finally {
      setLoadingPrompts(false);
    }
  };

  // Action: Complete wizard & trigger crawl pipeline
  const handleLaunchScan = async () => {
    const selectedPrompts = prompts.filter(p => p.selected);
    if (selectedPrompts.length === 0) {
      toast.error("Please select at least one prompt to scan");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Create the project record with embedded metadata in description
      const cleanBrand = brandName.trim() || domain.trim();
      const metadataBlock = `\n---\nMETADATA: ${JSON.stringify({
        location: selectedLocation,
        competitors: competitors,
      })}`;
      const cleanDesc = `Market audience targeted: ${selectedLocation}. Generated based on selection.${metadataBlock}`;
      const created = await addProject.mutateAsync({
        name: cleanBrand,
        domain: normalizeUrl(domain),
        brand_name: cleanBrand,
        brand_description: cleanDesc,
      });

      // 2. Insert the custom prompts into aeo_prompts
      const supabase = getSupabaseBrowserClient();
      const promptRows = selectedPrompts.map(p => ({
        project_id: created.id,
        topic: p.topic,
        prompt: p.prompt.trim(),
        is_active: true,
      }));

      const { error: insertErr } = await supabase
        .from("aeo_prompts" as any)
        .insert(promptRows as any);

      if (insertErr) throw insertErr;

      // 3. Trigger background crawl & scans
      const crawlRes = await fetch("/api/jobs/crawl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": process.env.NEXT_PUBLIC_WORKER_SECRET || "dev-secret",
        },
        body: JSON.stringify({
          project_id: created.id,
          website: normalizeUrl(domain),
          max_pages: 50,
        }),
      });

      if (!crawlRes.ok) {
        throw new Error("Failed to queue background crawl worker");
      }

      setStep(4);
      toast.success("Success! Site crawler launched and scan scheduled.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to launch scanner pipeline");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditPrompt = (idx: number, text: string) => {
    setEditingPromptIdx(idx);
    setEditingPromptText(text);
  };

  const saveEditedPrompt = () => {
    if (editingPromptIdx === null) return;
    const updated = [...prompts];
    updated[editingPromptIdx].prompt = editingPromptText;
    setPrompts(updated);
    setEditingPromptIdx(null);
  };

  const togglePromptSelect = (idx: number) => {
    const updated = [...prompts];
    updated[idx].selected = !updated[idx].selected;
    setPrompts(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl border border-slate-150 shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        {/* Wizard Header */}
        <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="space-y-0.5">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Sparkles className="h-4.5 w-4.5 text-violet-600" />
              AEO Workspace Setup Wizard
            </h3>
            <p className="text-[10px] text-slate-450 font-bold uppercase tracking-wider">
              Step {step} of 4 · {step === 1 ? "Target Domain" : step === 2 ? "Market Discovery" : step === 3 ? "Conversational Prompts" : "Ready"}
            </p>
          </div>
          {step < 4 && (
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 font-black text-lg p-1 transition-colors"
            >
              ×
            </button>
          )}
        </div>

        {/* Wizard Steps Content */}
        <div className="p-6 flex-1 overflow-y-auto min-h-0 space-y-5 text-left text-xs font-semibold text-slate-650">
          {/* STEP 1: Enter Domain and Brand Details */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-violet-50/50 border border-violet-100 p-4 space-y-2">
                <h4 className="text-[11px] font-black uppercase text-violet-700 tracking-wider flex items-center gap-1">
                  <Database className="h-4 w-4" /> Discover Topics to Track
                </h4>
                <p className="text-slate-500 font-medium leading-relaxed">
                  Provide your brand details. SoloSpider will browse your website content and deduce your target geographical market and key topics to analyze.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-450">Website URL (Domain)</label>
                  <input
                    type="text"
                    required
                    placeholder="example.com"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-450">Brand Name</label>
                  <input
                    type="text"
                    placeholder="Brand (optional)"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Loading or Checklist of Topics */}
          {step === 2 && (
            <div className="space-y-5">
              {loadingTopics ? (
                <div className="py-16 text-center space-y-4 flex flex-col items-center">
                  <Loader2 className="h-8 w-8 text-violet-600 animate-spin" />
                  <div className="space-y-1">
                    <p className="font-black text-slate-850 text-sm">Discovering topics for your markets...</p>
                    <p className="text-slate-400 font-medium max-w-sm leading-relaxed text-[11px]">
                      Analyzing homepage landmarks, regional addresses, and listings to deduce target audience country...
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Location deduced display */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white shrink-0">
                          <MapPin className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Deduced Target Location</p>
                          <p className="text-slate-800 font-black text-sm mt-1 flex items-center gap-1.5">
                            {selectedLocation}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Change:</label>
                        <select
                          value={selectedLocation}
                          onChange={(e) => setSelectedLocation(e.target.value)}
                          className="bg-white border border-slate-200 rounded-lg text-xs font-bold px-2.5 py-1 text-slate-700 focus:outline-none"
                        >
                          {COUNTRIES.map((c) => (
                            <option key={c.code} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {deducedExplanation && (
                      <p className="text-[10px] font-bold text-slate-400 border-t border-slate-100 pt-2 flex items-center gap-1 leading-snug">
                        <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        Explanation: {deducedExplanation}
                      </p>
                    )}
                  </div>

                  {/* Competitors List display & edit */}
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0 border border-indigo-100">
                          <Database className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Discovered Competitors</p>
                          <p className="text-slate-500 text-[11px] font-semibold mt-1">
                            Review and edit domains to benchmark against in comparison prompts:
                          </p>
                        </div>
                      </div>
                      <input
                        type="text"
                        placeholder="competitor1.com, competitor2.com, competitor3.com"
                        value={competitors.join(", ")}
                        onChange={(e) => setCompetitors(e.target.value.split(",").map(c => c.trim()).filter(Boolean))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-violet-500 font-bold transition-all shadow-inner-sm"
                      />
                    </div>
                  </div>

                  {/* Topics List */}
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Select Topics to Track</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {discoveredTopics.map((item) => {
                        const active = selectedTopics[item.topic];
                        return (
                          <div 
                            key={item.topic} 
                            onClick={() => setSelectedTopics(prev => ({ ...prev, [item.topic]: !active }))}
                            className={`rounded-2xl border p-4 cursor-pointer select-none transition-all flex items-start justify-between gap-3 ${
                              active 
                                ? "bg-violet-50/40 border-violet-200 shadow-sm" 
                                : "bg-white border-slate-150 hover:bg-slate-50/50"
                            }`}
                          >
                            <div className="min-w-0 space-y-1">
                              <p className={`font-black text-[13px] ${active ? "text-violet-750" : "text-slate-800"}`}>{item.topic}</p>
                              <p className="text-[10px] text-slate-450 leading-relaxed font-semibold">{item.description}</p>
                            </div>
                            <div className="flex flex-col items-end shrink-0 gap-1.5">
                              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                                item.volume === "High" ? "bg-emerald-50 text-emerald-700" :
                                item.volume === "Medium" ? "bg-amber-50 text-amber-700" :
                                "bg-slate-100 text-slate-500"
                              }`}>
                                {item.volume} vol
                              </span>
                              <div className={`w-4.5 h-4.5 rounded-md border flex items-center justify-center transition-colors ${
                                active ? "bg-violet-600 border-violet-600 text-white" : "border-slate-300 bg-white"
                              }`}>
                                {active && <Check className="w-3.5 h-3.5 stroke-[3.5]" />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Loading or Table of Crafted Prompts */}
          {step === 3 && (
            <div className="space-y-4 flex flex-col h-full min-h-0">
              {loadingPrompts ? (
                <div className="py-16 text-center space-y-4 flex flex-col items-center">
                  <Loader2 className="h-8 w-8 text-violet-600 animate-spin" />
                  <div className="space-y-1">
                    <p className="font-black text-slate-850 text-sm">Crafting realistic search engine prompts...</p>
                    <p className="text-slate-400 font-medium max-w-sm leading-relaxed text-[11px]">
                      Writing exactly 25 conversational queries targeted for searchers in {selectedLocation}...
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 flex flex-col flex-1 min-h-0">
                  <div className="rounded-xl bg-violet-50/50 border border-violet-100 px-4 py-3 flex items-center justify-between shrink-0">
                    <p className="text-violet-750 font-bold text-xs">
                      We crafted <strong>{prompts.length} prompts</strong>. Review, edit, and select which queries to run in active scans.
                    </p>
                  </div>

                  {/* Prompts Table List */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden flex-1 overflow-y-auto max-h-[380px] bg-white shadow-inner-sm">
                    <table className="w-full border-collapse text-left text-xs font-semibold text-slate-650">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-150 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          <th className="px-3.5 py-2.5 w-12 text-center">Track</th>
                          <th className="px-3.5 py-2.5 min-w-[120px]">Topic</th>
                          <th className="px-3.5 py-2.5 min-w-[280px]">Prompt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {prompts.map((row, idx) => {
                          const isEditing = editingPromptIdx === idx;
                          return (
                            <tr key={idx} className="hover:bg-slate-50/30 align-middle">
                              <td className="px-3.5 py-3.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={row.selected}
                                  onChange={() => togglePromptSelect(idx)}
                                  className="w-4 h-4 text-violet-600 rounded border-slate-300 focus:ring-violet-500 cursor-pointer"
                                />
                              </td>
                              <td className="px-3.5 py-3.5">
                                <span className="px-2 py-0.5 rounded bg-violet-50 border border-violet-100 text-[8px] font-black uppercase tracking-wider text-violet-750">
                                  {row.topic}
                                </span>
                              </td>
                              <td className="px-3.5 py-3.5">
                                {isEditing ? (
                                  <div className="flex gap-2 items-center">
                                    <input
                                      type="text"
                                      value={editingPromptText}
                                      onChange={(e) => setEditingPromptText(e.target.value)}
                                      className="flex-1 bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                                    />
                                    <button 
                                      onClick={saveEditedPrompt}
                                      className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-750 text-white font-bold text-[10px]"
                                    >
                                      Save
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex justify-between gap-3 items-center font-medium leading-relaxed group">
                                    <span>"{row.prompt}"</span>
                                    <button 
                                      onClick={() => handleEditPrompt(idx, row.prompt)}
                                      className="text-[9px] text-violet-600 font-bold hover:underline opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                    >
                                      Edit
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Success & Scan Queue tracking */}
          {step === 4 && (
            <div className="py-8 text-center space-y-4 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 animate-bounce">
                <CheckCircle2 className="h-9 w-9 stroke-[2.5]" />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-lg font-black text-slate-850">AEO Pipeline Initiated!</h4>
                <p className="text-slate-500 font-medium max-w-sm leading-relaxed">
                  Your project has been successfully registered. The background site crawler has started, and active real-time grounded AEO scans will execute immediately after.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-slate-900 text-white font-extrabold shadow hover:bg-slate-800 transition-all text-xs"
              >
                Go to Workspace
              </button>
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        {step < 4 && (
          <div className="px-6 py-4.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
            <div>
              {step > 1 && (
                <button
                  type="button"
                  disabled={loadingTopics || loadingPrompts || submitting}
                  onClick={() => setStep((prev) => (prev - 1) as WizardStep)}
                  className="px-4 py-2 text-xs font-bold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                >
                  Back
                </button>
              )}
            </div>
            
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-all cursor-pointer"
              >
                Cancel
              </button>

              {step === 1 && (
                <button
                  type="button"
                  onClick={handleDiscoverTopics}
                  disabled={!domain}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold shadow hover:shadow-md active:scale-[0.98] transition-all flex items-center gap-1.5 text-xs disabled:opacity-50 cursor-pointer"
                >
                  Discover Topics <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}

              {step === 2 && !loadingTopics && (
                <button
                  type="button"
                  onClick={handleCraftPrompts}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold shadow hover:shadow-md active:scale-[0.98] transition-all flex items-center gap-1.5 text-xs cursor-pointer"
                >
                  Craft realistic prompts <Sparkles className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                </button>
              )}

              {step === 3 && !loadingPrompts && (
                <button
                  type="button"
                  onClick={handleLaunchScan}
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-violet-650 hover:bg-violet-700 text-white font-extrabold shadow-md hover:shadow-lg active:scale-[0.98] transition-all flex items-center gap-1.5 text-xs disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Launching...</>
                  ) : (
                    <><Play className="h-3.5 w-3.5 fill-white text-white" /> Launch AEO Scan</>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
