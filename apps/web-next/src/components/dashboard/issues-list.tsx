"use client";

import React, { useMemo } from "react";
import { FileText, Link as LinkIcon, AlertCircle, AlertTriangle, CheckCircle2, LayoutTemplate } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useProjects } from "@/hooks/useProjects";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface CrawledPage {
  id: string;
  project_id: string;
  url: string;
  title: string | null;
  meta_desc: string | null;
  h1: string | null;
  word_count: number | null;
  schema_types: string[];
  status_code: number | null;
  crawled_at: string;
  created_at: string;
}

const getBgColor = (color: string) => {
  if (color === "text-red-500") return "bg-red-50 text-red-500";
  if (color === "text-amber-500") return "bg-amber-50 text-amber-500";
  if (color === "text-yellow-500") return "bg-yellow-50 text-yellow-500";
  if (color === "text-emerald-500") return "bg-emerald-50 text-emerald-500";
  return "bg-slate-50 text-slate-500";
};

export function IssuesList() {
  const { activeProject } = useProjects();

  const crawledPagesQuery = useQuery<CrawledPage[]>({
    queryKey: ["crawled_pages", activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("crawled_pages" as any)
        .select("*")
        .eq("project_id", activeProject!.id)
        .order("crawled_at", { ascending: false });
      
      if (error) throw error;
      return (data || []) as CrawledPage[];
    },
  });

  const pages = crawledPagesQuery.data || [];

  const computedIssues = useMemo(() => {
    if (pages.length === 0) {
      return [
        { id: "no-data", icon: <AlertTriangle className="w-4 h-4 text-amber-500" />, title: "No pages crawled yet. Run a site audit.", severity: "Medium", color: "text-amber-500" }
      ];
    }

    const list = [];

    // 1. Broken pages
    const broken = pages.filter((p) => p.status_code && p.status_code !== 200).length;
    if (broken > 0) {
      list.push({
        id: "broken",
        icon: <AlertCircle className="w-4 h-4 text-red-500" />,
        title: `${broken} page${broken > 1 ? "s" : ""} returned error status codes`,
        severity: "High",
        color: "text-red-500"
      });
    }

    // 2. Missing titles
    const missingTitle = pages.filter((p) => !p.title || p.title.trim() === "").length;
    if (missingTitle > 0) {
      list.push({
        id: "missing-title",
        icon: <FileText className="w-4 h-4 text-red-500" />,
        title: `${missingTitle} page${missingTitle > 1 ? "s are" : " is"} missing title tags`,
        severity: "High",
        color: "text-red-500"
      });
    }

    // 3. Duplicate titles
    const titleCounts: Record<string, number> = {};
    pages.forEach((p) => {
      if (p.title && p.title.trim() !== "") {
        const t = p.title.trim().toLowerCase();
        titleCounts[t] = (titleCounts[t] || 0) + 1;
      }
    });
    const duplicateTitle = pages.filter((p) => p.title && titleCounts[p.title.trim().toLowerCase()] > 1).length;
    if (duplicateTitle > 0) {
      list.push({
        id: "duplicate-title",
        icon: <FileText className="w-4 h-4 text-amber-500" />,
        title: `${duplicateTitle} page${duplicateTitle > 1 ? "s have" : " has"} duplicate title tags`,
        severity: "Medium",
        color: "text-amber-500"
      });
    }

    // 4. Missing descriptions
    const missingDesc = pages.filter((p) => !p.meta_desc || p.meta_desc.trim() === "").length;
    if (missingDesc > 0) {
      list.push({
        id: "missing-desc",
        icon: <FileText className="w-4 h-4 text-amber-500" />,
        title: `${missingDesc} page${missingDesc > 1 ? "s are" : " is"} missing descriptions`,
        severity: "Medium",
        color: "text-amber-500"
      });
    }

    // 5. Missing H1
    const missingH1 = pages.filter((p) => !p.h1 || p.h1.trim() === "").length;
    if (missingH1 > 0) {
      list.push({
        id: "missing-h1",
        icon: <LayoutTemplate className="w-4 h-4 text-yellow-500" />,
        title: `${missingH1} page${missingH1 > 1 ? "s are" : " is"} missing H1 tags`,
        severity: "Low",
        color: "text-yellow-500"
      });
    }

    // 6. Thin content
    const thin = pages.filter((p) => typeof p.word_count === "number" && p.word_count < 200).length;
    if (thin > 0) {
      list.push({
        id: "thin-content",
        icon: <FileText className="w-4 h-4 text-yellow-500" />,
        title: `${thin} page${thin > 1 ? "s have" : " has"} thin content (<200 words)`,
        severity: "Low",
        color: "text-yellow-500"
      });
    }

    // 7. Missing Schema
    const missingSchema = pages.filter((p) => !p.schema_types || p.schema_types.length === 0).length;
    if (missingSchema > 0) {
      list.push({
        id: "missing-schema",
        icon: <LinkIcon className="w-4 h-4 text-yellow-500" />,
        title: `${missingSchema} page${missingSchema > 1 ? "s lack" : " lacks"} structured schema`,
        severity: "Low",
        color: "text-yellow-500"
      });
    }

    // If everything is clean
    if (list.length === 0) {
      list.push({
        id: "all-clear",
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
        title: "All SEO checks passed! Excellent job.",
        severity: "Low",
        color: "text-emerald-500"
      });
    }

    return list.slice(0, 5);
  }, [pages]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-bold text-slate-900">Top SEO Issues</h3>
        <Link href="/app/en/seo" className="text-xs font-semibold text-blue-600 hover:text-blue-700">View All</Link>
      </div>
      <div className="p-5 pt-3 flex-1 flex flex-col gap-2">
        {computedIssues.map((issue) => (
          <div key={issue.id} className="flex items-center justify-between py-2.5 hover:bg-slate-50 rounded-lg transition-colors px-2 -mx-2">
            <div className="flex items-center gap-3">
              <div className={`p-1.5 rounded-md ${getBgColor(issue.color)}`}>
                {issue.icon}
              </div>
              <span className="text-sm font-semibold text-slate-700 leading-tight truncate max-w-[160px] sm:max-w-[200px] md:max-w-[250px] lg:max-w-[160px] xl:max-w-[240px]" title={issue.title}>
                {issue.title}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-bold flex items-center gap-1.5 ${issue.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${issue.color.replace('text-', 'bg-')}`}></span>
                {issue.severity}
              </span>
              <Link 
                href="/app/en/seo"
                className="px-2.5 py-1 text-xs font-bold text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition-colors shrink-0"
              >
                Fix Now
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
