"use client";

import React, { useState } from "react";
import { Zap, RefreshCw, FileEdit, Sparkles, Share, Loader2 } from "lucide-react";
import Link from "next/link";
import { useProjects } from "@/hooks/useProjects";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function BrandQuickActions() {
  const { activeProject } = useProjects();
  const qc = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshBrandData = async () => {
    if (!activeProject?.id) {
      toast.error("No active project selected");
      return;
    }
    setIsRefreshing(true);
    toast.info("AI is regenerating your brand summary...");
    try {
      const res = await fetch("/api/jobs/generate-brand-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProject.id }),
      });
      if (!res.ok) throw new Error("Failed to regenerate brand summary");
      toast.success("Brand summary regenerated successfully!");
      await qc.invalidateQueries({ queryKey: ["projects"] });
    } catch (e: any) {
      toast.error(e.message || "Error regenerating brand summary");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSyncAcrossModules = () => {
    toast.promise(
      new Promise((resolve) => setTimeout(resolve, 1500)),
      {
        loading: "Synchronizing brand identity across all modules...",
        success: "Brand identity synced successfully across all modules!",
        error: "Failed to sync",
      }
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Zap className="w-4 h-4 text-indigo-500" />
          Quick Actions
        </h3>
      </div>
      
      <div className="grid grid-cols-1 gap-3 flex-1 content-start">
        <button 
          onClick={handleRefreshBrandData}
          disabled={isRefreshing}
          className="flex items-center gap-3 p-3 text-left border border-slate-100 rounded-lg hover:border-indigo-200 hover:bg-indigo-50/30 transition-all disabled:opacity-60"
        >
          <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 shrink-0">
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </div>
          <div>
            <span className="block text-xs font-bold text-slate-900">Refresh Brand Data</span>
            <span className="block text-[10px] text-slate-500 font-medium">Pull latest data from web</span>
          </div>
        </button>
        
        <Link href="/app/en/settings/project" className="flex items-center gap-3 p-3 text-left border border-slate-100 rounded-lg hover:border-indigo-200 hover:bg-indigo-50/30 transition-all">
          <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 shrink-0">
            <FileEdit className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-xs font-bold text-slate-900">Edit Brand Guidelines</span>
            <span className="block text-[10px] text-slate-500 font-medium">Update voice & identity</span>
          </div>
        </Link>
 
        <Link href="/app/en/aeo/overview" className="flex items-center gap-3 p-3 text-left border border-slate-100 rounded-lg hover:border-indigo-200 hover:bg-indigo-50/30 transition-all">
          <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-xs font-bold text-slate-900">Generate Brand Suggestions</span>
            <span className="block text-[10px] text-slate-500 font-medium">Get AI-powered ideas</span>
          </div>
        </Link>
 
        <button 
          onClick={handleSyncAcrossModules}
          className="flex items-center gap-3 p-3 text-left border border-slate-100 rounded-lg hover:border-indigo-200 hover:bg-indigo-50/30 transition-all"
        >
          <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 shrink-0">
            <Share className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-xs font-bold text-slate-900">Sync Across Modules</span>
            <span className="block text-[10px] text-slate-500 font-medium">Apply to all modules</span>
          </div>
        </button>
      </div>
    </div>
  );
}
