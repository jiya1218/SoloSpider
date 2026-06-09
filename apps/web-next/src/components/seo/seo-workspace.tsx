"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useProjects } from "@/hooks/useProjects";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { 
  Globe, 
  RefreshCw, 
  ChevronDown, 
  AlertCircle,
  ArrowDownCircle,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  PenTool,
  FileText,
  Timer,
  Bot,
  Loader2,
  Copy,
  ExternalLink,
  HelpCircle,
  Activity,
  ShieldAlert,
  Search
} from "lucide-react";

interface CrawledPage {
  id: string;
  project_id: string;
  url: string;
  title: string | null;
  meta_desc: string | null;
  h1: string | null;
  word_count: number | null;
  schema_types: string[];
  has_faq_schema: boolean;
  has_howto: boolean;
  status_code: number | null;
  source: string;
  crawled_at: string;
  created_at: string;
}

interface SeoAuditIssue {
  id: string;
  title: string;
  desc: string;
  impact: "Critical" | "Important" | "Minor" | "Passed";
  impactColor: string;
  howToFix: string;
  icon: React.ReactNode;
  failedPages: Array<{ url: string; detail?: string | number | null }>;
}

export function SeoWorkspace() {
  const qc = useQueryClient();
  const { activeProject } = useProjects();

  const [activeTab, setActiveTab] = useState("All Issues");
  const [searchTerm, setSearchTerm] = useState("");
  const [crawlerMaxPages, setCrawlerMaxPages] = useState(50);
  const [crawling, setCrawling] = useState(false);
  const [expandedIssues, setExpandedIssues] = useState<Record<string, boolean>>({});
  const [expandedPages, setExpandedPages] = useState<Record<string, boolean>>({});
  const [activeView, setActiveView] = useState<"issues" | "pages">("issues");
  const [pagesSearchTerm, setPagesSearchTerm] = useState("");
  const [pagesStatusFilter, setPagesStatusFilter] = useState("all");
  const [aiRecommendations, setAiRecommendations] = useState<Record<string, {
    recommendation: string;
    codeSnippet?: string;
    explanation?: string;
    loading: boolean;
    error?: string;
  }>>({});

  const handleCopyText = (text: string, message = "Copied to clipboard!") => {
    navigator.clipboard.writeText(text);
    toast.success(message);
  };

  const triggerAiRecommendation = async (issueId: string, pageItem: { url: string; detail?: string | number | null }) => {
    const cacheKey = `${issueId}-${pageItem.url}`;
    
    // Set loading state
    setAiRecommendations(prev => ({
      ...prev,
      [cacheKey]: { recommendation: "", loading: true }
    }));

    // Find corresponding crawled page to extract title, desc, h1, etc.
    const pageDetails = crawledPages.find(p => p.url === pageItem.url);

    try {
      const res = await fetch("/api/seo/analyze-issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: pageItem.url,
          issueId,
          currentTitle: pageDetails?.title,
          currentMetaDesc: pageDetails?.meta_desc,
          currentH1: pageDetails?.h1,
          wordCount: pageDetails?.word_count,
          schemaTypes: pageDetails?.schema_types
        })
      });

      if (!res.ok) throw new Error(`API returned status ${res.status}`);
      const data = await res.json();
      
      setAiRecommendations(prev => ({
        ...prev,
        [cacheKey]: {
          recommendation: data.recommendation || "",
          codeSnippet: data.codeSnippet,
          explanation: data.explanation || "",
          loading: false
        }
      }));
    } catch (err: any) {
      console.error("AI Recommendation error:", err);
      setAiRecommendations(prev => ({
        ...prev,
        [cacheKey]: {
          recommendation: "",
          loading: false,
          error: err.message || "Failed to generate recommendation"
        }
      }));
    }
  };

  // 1. Fetch live crawl runs status & poll if running
  const crawlRunQuery = useQuery({
    queryKey: ["crawl_run", activeProject?.id],
    enabled: Boolean(activeProject?.id),
    refetchInterval: (query) => {
      const run = query.state.data as any;
      return (run?.status === "running" || run?.status === "pending") ? 2500 : false;
    },
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from("crawl_runs" as any)
        .select("*")
        .eq("project_id", activeProject!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    },
  });

  const latestCrawlRun = crawlRunQuery.data;
  const isCrawlingActive = latestCrawlRun?.status === "running" || latestCrawlRun?.status === "pending" || crawling;

  // 2. Fetch live crawled pages
  const crawledPagesQuery = useQuery({
    queryKey: ["crawled_pages", activeProject?.id],
    enabled: Boolean(activeProject?.id),
    refetchInterval: isCrawlingActive ? 2500 : false,
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

  const crawledPages = crawledPagesQuery.data || [];

  const filteredPagesList = useMemo(() => {
    return crawledPages.filter((page: CrawledPage) => {
      const matchesSearch = 
        page.url.toLowerCase().includes(pagesSearchTerm.toLowerCase()) ||
        (page.title || "").toLowerCase().includes(pagesSearchTerm.toLowerCase());
      
      let matchesStatus = true;
      if (pagesStatusFilter === "200") {
        matchesStatus = page.status_code === 200;
      } else if (pagesStatusFilter === "broken") {
        matchesStatus = !page.status_code || page.status_code !== 200;
      } else if (pagesStatusFilter === "missing_title") {
        matchesStatus = !page.title || page.title.trim() === "";
      } else if (pagesStatusFilter === "missing_desc") {
        matchesStatus = !page.meta_desc || page.meta_desc.trim() === "";
      } else if (pagesStatusFilter === "missing_h1") {
        matchesStatus = !page.h1 || page.h1.trim() === "";
      } else if (pagesStatusFilter === "thin") {
        matchesStatus = typeof page.word_count === "number" && page.word_count < 200;
      }

      return matchesSearch && matchesStatus;
    });
  }, [crawledPages, pagesSearchTerm, pagesStatusFilter]);

  // 3. Trigger site crawl
  const handleStartCrawl = async () => {
    if (!activeProject?.domain) {
      toast.error("No website URL configured for this project.");
      return;
    }
    setCrawling(true);
    try {
      toast.info("🕷️ Launching Site Crawler locally...");
      const res = await fetch("/api/jobs/crawl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": process.env.NEXT_PUBLIC_WORKER_SECRET || "dev-secret",
        },
        body: JSON.stringify({
          project_id: activeProject.id,
          website: activeProject.domain,
          max_pages: crawlerMaxPages,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned ${res.status}`);
      }

      toast.success("🕷️ Crawler job enqueued! Tracking scan progress...");
      qc.invalidateQueries({ queryKey: ["crawl_run", activeProject.id] });
      qc.invalidateQueries({ queryKey: ["crawled_pages", activeProject.id] });
    } catch (e: any) {
      toast.error(e?.message || "Crawler error occurred");
    } finally {
      setCrawling(false);
    }
  };

  // 4. Compute live SEO audit diagnostics
  const auditData = useMemo(() => {
    if (crawledPages.length === 0) {
      return {
        seoScore: 0,
        criticalCount: 0,
        importantCount: 0,
        minorCount: 0,
        passedCount: 0,
        issues: [] as SeoAuditIssue[],
        passedChecksList: [] as SeoAuditIssue[],
      };
    }

    const pages = crawledPages;
    const total = pages.length;

    // A. Broken Pages
    const brokenPages = pages
      .filter((p) => p.status_code && p.status_code !== 200)
      .map((p) => ({
        url: p.url,
        detail: p.status_code ? `HTTP ${p.status_code}` : "Failed to load",
      }));

    // B. Missing Titles
    const missingTitles = pages
      .filter((p) => !p.title || p.title.trim() === "")
      .map((p) => ({
        url: p.url,
        detail: "No title tag present",
      }));

    // C. Duplicate Titles
    const titleCounts: Record<string, number> = {};
    pages.forEach((p) => {
      if (p.title && p.title.trim() !== "") {
        const t = p.title.trim().toLowerCase();
        titleCounts[t] = (titleCounts[t] || 0) + 1;
      }
    });
    const duplicateTitles = pages
      .filter((p) => p.title && titleCounts[p.title.trim().toLowerCase()] > 1)
      .map((p) => ({
        url: p.url,
        detail: `Title: "${p.title}"`,
      }));

    // D. Missing Meta Descriptions
    const missingDescs = pages
      .filter((p) => !p.meta_desc || p.meta_desc.trim() === "")
      .map((p) => ({
        url: p.url,
        detail: "No meta description present",
      }));

    // E. Missing H1 headings
    const missingH1s = pages
      .filter((p) => !p.h1 || p.h1.trim() === "")
      .map((p) => ({
        url: p.url,
        detail: "No H1 heading element",
      }));

    // F. Thin Content
    const thinContent = pages
      .filter((p) => typeof p.word_count === "number" && p.word_count < 200)
      .map((p) => ({
        url: p.url,
        detail: `${p.word_count ?? 0} words`,
      }));

    // G. Missing Schema Markup
    const missingSchema = pages
      .filter((p) => !p.schema_types || p.schema_types.length === 0)
      .map((p) => ({
        url: p.url,
        detail: "No schema structures",
      }));

    const allRules: SeoAuditIssue[] = [
      {
        id: "broken-links",
        title: `${brokenPages.length} broken page${brokenPages.length !== 1 ? "s" : ""} detected`,
        desc: "Pages returning error codes (like 404) degrade SEO indexing and visitor trust.",
        impact: "Critical",
        impactColor: "text-red-500 bg-red-55 border border-red-100",
        howToFix: "Fix broken paths, configure redirects, or restore missing resources.",
        icon: <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />,
        failedPages: brokenPages,
      },
      {
        id: "missing-titles",
        title: `${missingTitles.length} page${missingTitles.length !== 1 ? "s are" : " is"} missing titles`,
        desc: "Title tags are highly visible search indicators. Missing titles ruin rank opportunity.",
        impact: "Critical",
        impactColor: "text-red-500 bg-red-50 border border-red-100",
        howToFix: "Add unique page titles (50-60 characters) accurately representing the content.",
        icon: <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />,
        failedPages: missingTitles,
      },
      {
        id: "duplicate-titles",
        title: `${duplicateTitles.length} page${duplicateTitles.length !== 1 ? "s have" : " has"} duplicate titles`,
        desc: "Duplicate titles force your own pages to compete against each other in index rankings.",
        impact: "Important",
        impactColor: "text-orange-500 bg-orange-50 border border-orange-100",
        howToFix: "Differentiate page titles to indicate target audience or context distinctness.",
        icon: <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0" />,
        failedPages: duplicateTitles,
      },
      {
        id: "missing-descriptions",
        title: `${missingDescs.length} page${missingDescs.length !== 1 ? "s are" : " is"} missing meta descriptions`,
        desc: "Descriptions determine search result snippets. Short/missing text drops click-through rates.",
        impact: "Important",
        impactColor: "text-orange-500 bg-orange-50 border border-orange-100",
        howToFix: "Add descriptive snippets between 120-160 characters describing content utility.",
        icon: <FileText className="w-5 h-5 text-orange-500 shrink-0" />,
        failedPages: missingDescs,
      },
      {
        id: "missing-h1s",
        title: `${missingH1s.length} page${missingH1s.length !== 1 ? "s are" : " is"} missing H1 tags`,
        desc: "The H1 tag highlights the page's top-level header topic to search engines.",
        impact: "Minor",
        impactColor: "text-yellow-500 bg-yellow-50 border border-yellow-100",
        howToFix: "Ensure every page has exactly one H1 tag summarizing its main header title.",
        icon: <PenTool className="w-5 h-5 text-yellow-500 shrink-0" />,
        failedPages: missingH1s,
      },
      {
        id: "thin-content",
        title: `${thinContent.length} page${thinContent.length !== 1 ? "s have" : " has"} thin content (< 200 words)`,
        desc: "Pages with minimal word counts are perceived as low-quality filler by rank algorithms.",
        impact: "Minor",
        impactColor: "text-yellow-500 bg-yellow-50 border border-yellow-100",
        howToFix: "Expand page copy with useful paragraphs, user FAQs, or descriptive details.",
        icon: <Timer className="w-5 h-5 text-yellow-500 shrink-0" />,
        failedPages: thinContent,
      },
      {
        id: "missing-schema",
        title: `${missingSchema.length} page${missingSchema.length !== 1 ? "s lack" : " lacks"} structured schema`,
        desc: "Structured schemas (schema.org JSON-LD) translate pages into interactive search cards.",
        impact: "Minor",
        impactColor: "text-yellow-500 bg-yellow-50 border border-yellow-100",
        howToFix: "Embed relevant page structures like Article, Product, or FAQPage schemas.",
        icon: <Globe className="w-5 h-5 text-yellow-500 shrink-0" />,
        failedPages: missingSchema,
      },
    ];

    const activeIssues = allRules.filter((r) => r.failedPages.length > 0);
    const passedChecks: SeoAuditIssue[] = allRules
      .filter((r) => r.failedPages.length === 0)
      .map((r) => ({
        id: r.id,
        title:
          r.id === "broken-links" ? "All pages returned successful status codes (200)"
          : r.id === "missing-titles" ? "No pages missing title tags"
          : r.id === "duplicate-titles" ? "No duplicate title tags detected"
          : r.id === "missing-descriptions" ? "All pages have meta descriptions"
          : r.id === "missing-h1s" ? "All pages have main H1 headings"
          : r.id === "thin-content" ? "No thin content pages (< 200 words)"
          : "All pages have structured schema markup",
        desc: r.desc,
        impact: "Passed",
        impactColor: "text-emerald-600 bg-emerald-50 border border-emerald-100",
        howToFix: r.howToFix,
        icon: <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />,
        failedPages: [],
      }));

    const criticalCount = activeIssues.filter((i) => i.impact === "Critical").length;
    const importantCount = activeIssues.filter((i) => i.impact === "Important").length;
    const minorCount = activeIssues.filter((i) => i.impact === "Minor").length;
    const passedCount = passedChecks.length;

    // SEO score algorithm
    let score = 100;
    const brokenPct = brokenPages.length / total;
    const missingTitlePct = missingTitles.length / total;
    const duplicateTitlePct = duplicateTitles.length / total;
    const missingDescPct = missingDescs.length / total;
    const missingH1Pct = missingH1s.length / total;

    score -= Math.min(40, Math.round(brokenPct * 100));
    score -= Math.min(20, Math.round(missingTitlePct * 60));
    score -= Math.min(15, Math.round(duplicateTitlePct * 40));
    score -= Math.min(15, Math.round(missingDescPct * 30));
    score -= Math.min(10, Math.round(missingH1Pct * 20));
    score = Math.max(30, score);

    return {
      seoScore: score,
      criticalCount,
      importantCount,
      minorCount,
      passedCount,
      issues: activeIssues,
      passedChecksList: passedChecks,
    };
  }, [crawledPages]);

  // Expand toggles
  const toggleIssueExpanded = (id: string) => {
    setExpandedIssues((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Copy helper
  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("URL copied to clipboard!");
  };

  // Filter issues based on tabs and search query
  const filteredIssuesList = useMemo(() => {
    const list = activeTab === "Passed" ? auditData.passedChecksList : auditData.issues;
    let filtered = list;

    if (activeTab === "Critical") {
      filtered = list.filter((i) => i.impact === "Critical");
    } else if (activeTab === "Important") {
      filtered = list.filter((i) => i.impact === "Important");
    } else if (activeTab === "Minor") {
      filtered = list.filter((i) => i.impact === "Minor");
    }

    if (searchTerm.trim() !== "") {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.desc.toLowerCase().includes(q) ||
          i.howToFix.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [activeTab, auditData, searchTerm]);

  // Last scanned calculation
  const lastScannedText = useMemo(() => {
    const dateStr = latestCrawlRun?.finished_at || crawledPages[0]?.crawled_at;
    if (!dateStr) return "Never scanned";
    try {
      const date = new Date(dateStr);
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "Recently";
    }
  }, [latestCrawlRun, crawledPages]);

  // Return Project Selection lock state
  if (!activeProject) {
    return (
      <div className="max-w-md mx-auto my-16 text-center space-y-5 p-6 border border-slate-150 rounded-2xl bg-white shadow-sm animate-in fade-in">
        <ShieldAlert className="h-12 w-12 text-slate-400 mx-auto" />
        <h2 className="text-xl font-bold text-slate-800">SEO Workspace Locked</h2>
        <p className="text-sm text-slate-505 font-medium text-slate-500">
          Create or select an active project in the Dashboard to unlock website SEO audit, sitemap indexing check, and meta tag monitoring.
        </p>
        <Link 
          href="/app/en/dashboard" 
          className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-800 transition-all"
        >
          Go to Dashboard
        </Link>
      </div>
    );
  }

  // Return empty bootstrap state when no pages are crawled
  if (crawledPages.length === 0 && !isCrawlingActive) {
    return (
      <div className="w-full max-w-[1400px] mx-auto space-y-6 animate-in fade-in duration-200">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">SEO Audit</h1>
            <p className="text-slate-500 text-[13px] font-medium mt-1">
              Analyze your site's SEO metadata, structured schema, status codes, and readability.
            </p>
          </div>
        </div>

        {/* Empty State Banner */}
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm space-y-6 max-w-2xl mx-auto mt-8">
          <div className="w-16 h-16 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-inner">
            <Globe className="w-8 h-8 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-800">No SEO Audit Data Logged</h3>
            <p className="text-sm text-slate-500 font-medium max-w-md mx-auto">
              SoloSpider needs to scan your website sitemap and crawl pages to analyze titles, descriptions, status codes, and headings.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 max-w-sm mx-auto text-left space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-slate-400 uppercase tracking-wider">Target Website:</span>
              <span className="font-black text-slate-800 break-all">{activeProject.domain || "Configure Domain First"}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-slate-400 uppercase tracking-wider">Max Crawl Limit:</span>
              <select
                value={crawlerMaxPages}
                onChange={(e) => setCrawlerMaxPages(Number(e.target.value))}
                className="bg-white border border-slate-250 border-slate-200 text-slate-700 font-bold py-0.5 px-1.5 rounded text-[11px]"
              >
                <option value={20}>20 pages</option>
                <option value={50}>50 pages</option>
                <option value={100}>100 pages</option>
                <option value={200}>200 pages</option>
              </select>
            </div>
          </div>

          <div>
            <button
              onClick={handleStartCrawl}
              disabled={!activeProject.domain || crawling}
              className="inline-flex items-center gap-2 bg-indigo-650 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
            >
              <Activity className="w-4 h-4" />
              Run First SEO Audit
            </button>
            {!activeProject.domain && (
              <p className="text-xs text-red-500 font-bold mt-2">
                Configure your project domain in Settings to launch the crawler.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Return live scan loader screen if crawl is active and zero cached crawled pages exist
  if (isCrawlingActive && crawledPages.length === 0) {
    const pagesFound = latestCrawlRun?.pages_found || 0;
    const pagesCrawled = latestCrawlRun?.pages_crawled || 0;
    const progressPercent = pagesFound > 0 ? Math.min(100, Math.round((pagesCrawled / pagesFound) * 100)) : 15;

    return (
      <div className="w-full max-w-[1400px] mx-auto space-y-6 animate-in fade-in duration-205">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">SEO Audit</h1>
            <p className="text-slate-500 text-[13px] font-medium mt-1">
              SoloSpider is scanning your site pages. This page will render findings automatically.
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm max-w-2xl mx-auto mt-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-violet-50 text-indigo-600 flex items-center justify-center mx-auto shadow-inner">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-800">Crawling Website...</h3>
            <p className="text-sm text-slate-500 font-medium max-w-md mx-auto">
              SoloSpider is scanning and compiling metadata for <span className="font-extrabold text-slate-700">{activeProject.domain}</span>.
            </p>
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <div className="flex justify-between text-xs font-bold text-slate-500">
              <span>Progress: {progressPercent}%</span>
              <span>{pagesCrawled} / {pagesFound || "?"} pages parsed</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
              <div 
                className="h-full bg-indigo-600 transition-all duration-500 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-slate-400 font-semibold animate-pulse">
            Realtime database pipeline active. Results will render momentarily.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-6 animate-in fade-in duration-200">
      
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">SEO Audit</h1>
          <p className="text-slate-500 text-[13px] font-medium mt-1">
            We scanned your website <span className="font-extrabold text-slate-700">{activeProject.domain}</span> and found issues that can improve your ranking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Crawl Limit:</span>
            <select
              value={crawlerMaxPages}
              onChange={(e) => setCrawlerMaxPages(Number(e.target.value))}
              disabled={isCrawlingActive}
              className="bg-white border border-slate-200 text-slate-700 text-xs font-bold py-1.5 px-2 rounded-xl shadow-sm focus:outline-none"
            >
              <option value={20}>20 pages</option>
              <option value={50}>50 pages</option>
              <option value={100}>100 pages</option>
              <option value={200}>200 pages</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={handleStartCrawl}
              disabled={isCrawlingActive}
              className="flex items-center gap-1.5 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-650 text-indigo-600 text-xs font-bold py-2 px-3.5 rounded-xl shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              {isCrawlingActive ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Crawling...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Re-run Audit
                </>
              )}
            </button>
          </div>

          <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>

          <div className="flex items-center gap-4 hidden sm:flex">
            <div className="text-right text-[11px]">
              <span className="text-slate-500 block font-semibold">Last scanned:</span>
              <span className="font-black text-slate-700">{lastScannedText}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Crawl Run Live Banner when updating in background */}
      {isCrawlingActive && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-violet-600 animate-spin shrink-0" />
            <div className="text-left">
              <span className="text-xs font-extrabold text-violet-850 text-violet-800 block">Updating SEO Audit data...</span>
              <span className="text-[11px] font-bold text-violet-550 text-violet-600">
                Crawled {latestCrawlRun?.pages_crawled || 0} of {latestCrawlRun?.pages_found || 0} pages on {activeProject.domain}
              </span>
            </div>
          </div>
          <div className="w-full sm:w-64 h-2 bg-violet-100 rounded-full overflow-hidden border border-violet-200/20">
            <div 
              className="h-full bg-violet-600 transition-all duration-300 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" 
              style={{ 
                width: `${latestCrawlRun?.pages_found ? Math.min(100, Math.round((latestCrawlRun.pages_crawled / latestCrawlRun.pages_found) * 100)) : 15}%` 
              }} 
            />
          </div>
        </div>
      )}

      {/* Metrics Row */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 md:gap-4 overflow-x-auto scrollbar-none">
        
        {/* SEO Score */}
        <div className="flex items-center gap-4 min-w-[200px] shrink-0">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-extrabold text-slate-800">SEO Score</span>
              <div className="w-3.5 h-3.5 rounded-full border border-slate-350 border-slate-200 flex items-center justify-center text-[9px] text-slate-400 font-bold cursor-help" title="Weighted score evaluating broken pages, missing descriptions, headings, and duplicate title tags.">?</div>
            </div>
            
            {/* Circular Progress (SVG) */}
            <div className="relative w-24 h-24 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                <circle 
                  cx="50" cy="50" r="40" 
                  fill="none" 
                  stroke={auditData.seoScore >= 80 ? "#10b981" : auditData.seoScore >= 60 ? "#f59e0b" : "#ef4444"} 
                  strokeWidth="8" 
                  strokeDasharray="251.2" 
                  strokeDashoffset={251.2 - (251.2 * (auditData.seoScore / 100))} 
                  strokeLinecap="round" 
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <div className="flex items-baseline gap-0.5">
                  <span className="text-2xl font-black text-slate-850 text-slate-850 text-slate-800">{auditData.seoScore}</span>
                  <span className="text-xs font-bold text-slate-400">/100</span>
                </div>
              </div>
              <div className={`absolute -bottom-1 border text-[10px] font-black px-3 py-0.5 rounded-full z-10 ${
                auditData.seoScore >= 80 
                  ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                  : auditData.seoScore >= 60 
                    ? "bg-amber-50 text-amber-600 border-amber-100" 
                    : "bg-red-50 text-red-650 border-red-100"
              }`}>
                {auditData.seoScore >= 85 ? "Excellent" : auditData.seoScore >= 70 ? "Good" : auditData.seoScore >= 50 ? "Needs Work" : "Poor"}
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:block w-px h-20 bg-slate-100 shrink-0"></div>

        {/* Critical Issues */}
        <div className="min-w-[140px] shrink-0 text-center md:text-left flex flex-col items-center md:items-start">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 mb-2">
            <div className="w-5 h-5 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
              <AlertCircle className="w-3 h-3" />
            </div>
            Critical Issues
          </div>
          <div className="text-3xl font-black text-slate-850 text-slate-800 my-1">{auditData.criticalCount}</div>
          <div className="text-[10px] font-extrabold text-red-500 mt-1">{auditData.criticalCount > 0 ? "Fix immediately" : "None detected!"}</div>
        </div>

        <div className="hidden md:block w-px h-20 bg-slate-100 shrink-0"></div>

        {/* Important Issues */}
        <div className="min-w-[140px] shrink-0 text-center md:text-left flex flex-col items-center md:items-start">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 mb-2">
            <div className="w-5 h-5 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center">
              <ArrowDownCircle className="w-3 h-3 rotate-180" />
            </div>
            Important Issues
          </div>
          <div className="text-3xl font-black text-slate-800 my-1">{auditData.importantCount}</div>
          <div className="text-[10px] font-extrabold text-orange-500 mt-1">{auditData.importantCount > 0 ? "Fix soon" : "All clean"}</div>
        </div>

        <div className="hidden md:block w-px h-20 bg-slate-100 shrink-0"></div>

        {/* Minor Issues */}
        <div className="min-w-[140px] shrink-0 text-center md:text-left flex flex-col items-center md:items-start">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 mb-2">
            <div className="w-5 h-5 rounded-full bg-yellow-50 text-yellow-500 flex items-center justify-center">
              <AlertTriangle className="w-3 h-3" />
            </div>
            Minor Issues
          </div>
          <div className="text-3xl font-black text-slate-800 my-1">{auditData.minorCount}</div>
          <div className="text-[10px] font-extrabold text-yellow-550 text-yellow-500 mt-1">{auditData.minorCount > 0 ? "Consider optimizing" : "All clear"}</div>
        </div>

        <div className="hidden md:block w-px h-20 bg-slate-100 shrink-0"></div>

        {/* Passed Checks */}
        <div className="min-w-[140px] shrink-0 text-center md:text-left flex flex-col items-center md:items-start">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 mb-2">
            <div className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="w-3 h-3" />
            </div>
            Passed Checks
          </div>
          <div className="text-3xl font-black text-slate-850 text-slate-800 my-1">{auditData.passedCount}</div>
          <div className="text-[10px] font-extrabold text-emerald-600 mt-1">Good job!</div>
        </div>
        
      </div>

      {/* Double Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Full Width: Issues & Pages Combined Explorer */}
        <div className="lg:col-span-12 bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden flex flex-col h-full">
          
          {/* Section Tabs Switcher */}
          <div className="p-6 pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100">
            <div className="flex items-center gap-6">
              <button
                onClick={() => setActiveView("issues")}
                className={`pb-3 border-b-2 text-sm font-extrabold transition-all px-1 cursor-pointer ${
                  activeView === "issues"
                    ? "border-indigo-600 text-indigo-600 font-black"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                SEO Issues ({auditData.issues.length})
              </button>
              <button
                onClick={() => setActiveView("pages")}
                className={`pb-3 border-b-2 text-sm font-extrabold transition-all px-1 cursor-pointer ${
                  activeView === "pages"
                    ? "border-indigo-600 text-indigo-600 font-black"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                Audited Pages ({crawledPages.length})
              </button>
            </div>

            <div className="pb-3 text-xs text-slate-400 font-semibold italic">
              {isCrawlingActive ? (
                <span className="flex items-center gap-1.5 text-violet-600 animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Crawler processing: pages list auto-refreshing...
                </span>
              ) : (
                <span>All audits up to date</span>
              )}
            </div>
          </div>

          {activeView === "issues" ? (
            <>
              <div className="p-6 pb-0">
                {/* Tabs & Search */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div className="flex flex-wrap items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-100 self-start">
                    {["All Issues", "Critical", "Important", "Minor", "Passed"].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                          activeTab === tab 
                            ? "bg-indigo-100 text-indigo-700 shadow-sm" 
                            : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 max-w-xs w-full bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-1.5">
                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="Search issues..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="bg-transparent text-xs text-slate-700 placeholder-slate-400 focus:outline-none w-full font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-100 bg-slate-50/50 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                <div className="col-span-12 sm:col-span-5">Issue</div>
                <div className="hidden sm:block sm:col-span-2">Impact</div>
                <div className="hidden sm:block sm:col-span-4">How to Fix</div>
                <div className="col-span-12 sm:col-span-1 text-right sm:text-center">Action</div>
              </div>

              {/* Table Body */}
              <div className="flex-1 divide-y divide-slate-100">
                {filteredIssuesList.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 font-semibold text-xs">
                    No issues match current filters or search terms.
                  </div>
                ) : (
                  filteredIssuesList.map((issue) => (
                    <React.Fragment key={issue.id}>
                      <div className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50/20 transition-colors">
                        {/* Issue Cell */}
                        <div className="col-span-12 sm:col-span-5 flex gap-3">
                          <div className="shrink-0 mt-0.5">
                            {issue.icon}
                          </div>
                          <div>
                            <h4 className="text-xs font-extrabold text-slate-900 mb-1">{issue.title}</h4>
                            <p className="text-[11px] text-slate-500 leading-snug">{issue.desc}</p>
                          </div>
                        </div>

                        {/* Impact Cell */}
                        <div className="col-span-6 sm:col-span-2">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${issue.impactColor}`}>
                            {issue.impact}
                          </span>
                        </div>

                        {/* How to fix Cell */}
                        <div className="col-span-6 sm:col-span-4 text-[11px] font-medium text-slate-600 leading-snug">
                          {issue.howToFix}
                        </div>

                        {/* Action Cell */}
                        <div className="col-span-12 sm:col-span-1 flex justify-end">
                          {issue.failedPages.length > 0 ? (
                            <div className="flex rounded-lg overflow-hidden border border-indigo-200 shadow-sm shrink-0">
                              <button 
                                onClick={() => toggleIssueExpanded(issue.id)}
                                className="bg-white hover:bg-indigo-50 text-indigo-650 text-indigo-600 text-[11px] font-bold px-3 py-1.5 transition-colors border-r border-indigo-100 cursor-pointer"
                              >
                                {expandedIssues[issue.id] ? "Hide" : "Details"}
                              </button>
                              <button 
                                onClick={() => toggleIssueExpanded(issue.id)}
                                className="bg-white hover:bg-indigo-50 text-indigo-600 px-1.5 py-1.5 transition-colors flex items-center justify-center cursor-pointer"
                              >
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedIssues[issue.id] ? "rotate-180" : ""}`} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">
                              Passed
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Expanded URLs breakdown */}
                      {expandedIssues[issue.id] && issue.failedPages.length > 0 && (
                        <div className="col-span-12 px-6 py-4 bg-slate-50/50 border-t border-b border-slate-100 animate-in fade-in slide-in-from-top-2 duration-200">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                Failed URL Breakdown ({issue.failedPages.length})
                              </span>
                              <span className="text-[10px] text-slate-400 font-semibold">
                                Copy or test direct link
                              </span>
                            </div>
                            <div className="max-h-[500px] overflow-y-auto border border-slate-200/60 rounded-xl bg-white divide-y divide-slate-100 shadow-inner scrollbar-thin">
                              {issue.failedPages.map((page, pIdx) => (
                                <div key={pIdx} className="flex flex-col gap-3 p-3.5 hover:bg-slate-50/20 transition-colors">
                                  <div className="flex items-center justify-between w-full">
                                    <div className="flex items-center gap-3 min-w-0 pr-4">
                                      <span className="text-xs font-black text-slate-400 shrink-0 w-6 text-right">{pIdx + 1}.</span>
                                      <div className="truncate">
                                        <span className="text-xs font-mono font-medium text-slate-700 break-all select-all">{page.url}</span>
                                        {page.detail && (
                                          <span className="block text-[10px] font-extrabold text-slate-400 mt-0.5">{page.detail}</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button 
                                        onClick={() => triggerAiRecommendation(issue.id, page)}
                                        className="flex items-center gap-1 text-[10px] font-black bg-indigo-50 hover:bg-indigo-100 text-indigo-650 border border-indigo-100 px-2 py-1 rounded-lg transition-colors cursor-pointer shadow-sm"
                                        title="Get AI Fix Suggestions"
                                      >
                                        <Sparkles className="w-3 h-3 text-indigo-500" />
                                        {aiRecommendations[`${issue.id}-${page.url}`] ? "Re-Analyze" : "AI Fix"}
                                      </button>
                                      <button 
                                        onClick={() => handleCopyUrl(page.url)}
                                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-indigo-100 cursor-pointer"
                                        title="Copy URL"
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                      <a 
                                        href={page.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-indigo-100 flex items-center justify-center"
                                        title="Open Page"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </a>
                                    </div>
                                  </div>

                                  {/* AI Recommendation Details */}
                                  {aiRecommendations[`${issue.id}-${page.url}`] && (
                                    <div className="ml-9 border border-indigo-100 bg-indigo-50/20 rounded-xl p-3.5 space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-200">
                                      {aiRecommendations[`${issue.id}-${page.url}`].loading ? (
                                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                                          <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                                          <span>Generating custom SEO recommendation...</span>
                                        </div>
                                      ) : aiRecommendations[`${issue.id}-${page.url}`].error ? (
                                        <div className="flex items-center gap-1.5 text-xs text-red-500 font-semibold">
                                          <AlertCircle className="w-4 h-4 shrink-0" />
                                          <span>{aiRecommendations[`${issue.id}-${page.url}`].error}</span>
                                        </div>
                                      ) : (
                                        <div className="space-y-3">
                                          <div className="flex items-start justify-between gap-4">
                                            <div className="space-y-1">
                                              <span className="text-[9px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">AI Recommendation</span>
                                              <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">
                                                {aiRecommendations[`${issue.id}-${page.url}`].recommendation}
                                              </div>
                                            </div>
                                            {aiRecommendations[`${issue.id}-${page.url}`].codeSnippet && (
                                              <button 
                                                onClick={() => handleCopyText(aiRecommendations[`${issue.id}-${page.url}`].codeSnippet!, "Schema copied to clipboard!")}
                                                className="shrink-0 p-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg shadow-sm text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                                title="Copy Code"
                                              >
                                                <Copy className="w-3.5 h-3.5" />
                                                Copy Code
                                              </button>
                                            )}
                                          </div>

                                          {aiRecommendations[`${issue.id}-${page.url}`].codeSnippet && (
                                            <pre className="text-[10px] font-mono p-3 bg-slate-950 text-slate-100 rounded-lg overflow-x-auto border border-slate-800 leading-relaxed max-h-40 scrollbar-thin">
                                              <code>{aiRecommendations[`${issue.id}-${page.url}`].codeSnippet}</code>
                                            </pre>
                                          )}

                                          <div className="border-t border-indigo-100/65 pt-2.5 flex items-start gap-2">
                                            <HelpCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                                            <p className="text-[10px] text-slate-500 font-semibold leading-relaxed">
                                              <strong className="text-slate-600">Why this matters:</strong> {aiRecommendations[`${issue.id}-${page.url}`].explanation}
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  ))
                )}
              </div>

              {/* Call to action card footer */}
              <div className="bg-slate-50/50 p-6 flex flex-col md:flex-row items-center justify-between gap-4 border-t border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-violet-100/60 flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5 text-indigo-650" />
                  </div>
                  <div>
                    <h5 className="text-[14px] font-extrabold text-slate-900 mb-0.5">Need help fixing SEO gaps?</h5>
                    <p className="text-[12px] text-slate-500 font-semibold">Write blog outline briefs with FAQ schemas using AI.</p>
                  </div>
                </div>
                <Link 
                  href="/app/en/content/generate"
                  className="bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-600 text-[12px] font-extrabold py-2.5 px-4 rounded-xl transition-colors flex items-center gap-2 shadow-sm shrink-0"
                >
                  <Sparkles className="w-4 h-4 text-violet-555" />
                  Launch AI Content Lab
                </Link>
              </div>
            </>
          ) : (
            <>
              {/* Search & Filter Controls */}
              <div className="p-6 pb-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-1.5 self-start">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Filter By:</span>
                    <select
                      value={pagesStatusFilter}
                      onChange={(e) => setPagesStatusFilter(e.target.value)}
                      className="bg-transparent text-xs text-slate-700 font-bold focus:outline-none cursor-pointer"
                    >
                      <option value="all">All Pages ({crawledPages.length})</option>
                      <option value="200">Successful (200 OK)</option>
                      <option value="broken">Broken / Error (Non-200)</option>
                      <option value="missing_title">Missing Title Tag</option>
                      <option value="missing_desc">Missing Meta Description</option>
                      <option value="missing_h1">Missing H1 Heading</option>
                      <option value="thin">Thin Content (&lt; 200 words)</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2 max-w-xs w-full bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-1.5">
                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="Search pages by URL or Title..."
                      value={pagesSearchTerm}
                      onChange={(e) => setPagesSearchTerm(e.target.value)}
                      className="bg-transparent text-xs text-slate-700 placeholder-slate-400 focus:outline-none w-full font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-100 bg-slate-50/50 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                <div className="col-span-12 md:col-span-4">Page URL</div>
                <div className="hidden md:block md:col-span-1 text-center">Status</div>
                <div className="hidden md:block md:col-span-2">Title</div>
                <div className="hidden md:block md:col-span-2">Meta Description</div>
                <div className="hidden md:block md:col-span-1 text-center">H1</div>
                <div className="hidden md:block md:col-span-1 text-center">Word Count</div>
                <div className="col-span-12 md:col-span-1 text-right md:text-center">Action</div>
              </div>

              {/* Table Body */}
              <div className="flex-1 divide-y divide-slate-100">
                {filteredPagesList.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 font-semibold text-xs">
                    No audited pages match current filters or search terms.
                  </div>
                ) : (
                  filteredPagesList.map((page) => {
                    const isExpanded = !!expandedPages[page.url];
                    const hasTitle = page.title && page.title.trim() !== "";
                    const titleLength = page.title ? page.title.length : 0;
                    const hasDesc = page.meta_desc && page.meta_desc.trim() !== "";
                    const descLength = page.meta_desc ? page.meta_desc.length : 0;
                    const hasH1 = page.h1 && page.h1.trim() !== "";
                    const isWordCountLow = typeof page.word_count === "number" && page.word_count < 200;
                    
                    return (
                      <React.Fragment key={page.id || page.url}>
                        <div 
                          onClick={() => setExpandedPages(prev => ({ ...prev, [page.url]: !prev[page.url] }))}
                          className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50/20 transition-colors cursor-pointer"
                        >
                          {/* URL Column */}
                          <div className="col-span-12 md:col-span-4 min-w-0 flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <div className="truncate">
                              <span className="text-xs font-mono font-medium text-slate-700 break-all select-all block">{page.url}</span>
                            </div>
                          </div>

                          {/* Status Code Column */}
                          <div className="col-span-3 md:col-span-1 text-left md:text-center">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${
                              page.status_code === 200 
                                ? "bg-emerald-50 text-emerald-605 border-emerald-100" 
                                : "bg-red-50 text-red-500 border-red-100"
                            }`}>
                              {page.status_code || "Error"}
                            </span>
                          </div>

                          {/* Title Column */}
                          <div className="col-span-9 md:col-span-2 min-w-0">
                            {hasTitle ? (
                              <div className="truncate">
                                <span className="text-xs font-medium text-slate-800" title={page.title || ""}>{page.title}</span>
                                <span className="block text-[9px] font-extrabold text-slate-400">{titleLength} chars</span>
                              </div>
                            ) : (
                              <span className="text-[10px] font-extrabold text-red-500 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                                Missing Title
                              </span>
                            )}
                          </div>

                          {/* Meta Desc Column */}
                          <div className="hidden md:block md:col-span-2 min-w-0">
                            {hasDesc ? (
                              <div className="truncate">
                                <span className="text-xs text-slate-500" title={page.meta_desc || ""}>{page.meta_desc}</span>
                                <span className="block text-[9px] font-extrabold text-slate-400">{descLength} chars</span>
                              </div>
                            ) : (
                              <span className="text-[10px] font-extrabold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">
                                Missing Description
                              </span>
                            )}
                          </div>

                          {/* H1 Column */}
                          <div className="col-span-6 md:col-span-1 text-left md:text-center">
                            {hasH1 ? (
                              <span className="text-[10px] font-extrabold text-slate-700 truncate block" title={page.h1 || ""}>
                                {page.h1}
                              </span>
                            ) : (
                              <span className="text-[10px] font-extrabold text-yellow-600 bg-yellow-50 px-1.5 py-0.5 rounded border border-yellow-100">
                                Missing H1
                              </span>
                            )}
                          </div>

                          {/* Word Count Column */}
                          <div className="col-span-6 md:col-span-1 text-left md:text-center">
                            <span className={`text-xs font-bold ${isWordCountLow ? "text-red-500 font-extrabold" : "text-slate-600"}`}>
                              {page.word_count ?? 0} {isWordCountLow && <span className="text-[9px] font-black block text-red-400">Thin</span>}
                            </span>
                          </div>

                          {/* Actions Column */}
                          <div className="col-span-12 md:col-span-1 flex justify-end">
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedPages(prev => ({ ...prev, [page.url]: !prev[page.url] }));
                                }}
                                className="bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-650 text-indigo-600 rounded-lg p-1 transition-colors flex items-center justify-center cursor-pointer shadow-sm"
                              >
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-205 ${isExpanded ? "rotate-180" : ""}`} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Expanded Drawer */}
                        {isExpanded && (
                          <div className="col-span-12 px-6 py-5 bg-slate-50/40 border-t border-b border-slate-100 animate-in fade-in slide-in-from-top-2 duration-200 text-left">
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                              {/* Left details pane */}
                              <div className="lg:col-span-7 space-y-3">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                                    SEO Audit Report Checklist
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <button 
                                      onClick={() => handleCopyUrl(page.url)}
                                      className="flex items-center gap-1 text-[10px] font-extrabold text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
                                      title="Copy URL"
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                      Copy URL
                                    </button>
                                    <a 
                                      href={page.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-0.5 text-[10px] font-extrabold text-slate-500 hover:text-indigo-600 transition-colors"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      Open page
                                    </a>
                                  </div>
                                </div>

                                <div className="space-y-3">
                                  {/* Title Check */}
                                  <div className="p-3 bg-white border border-slate-150 rounded-xl space-y-1.5 shadow-sm">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-slate-800">Title Tag</span>
                                      {hasTitle && titleLength >= 50 && titleLength <= 60 ? (
                                        <span className="text-[9px] font-extrabold text-emerald-605 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Optimal (50-60 chars)</span>
                                      ) : hasTitle ? (
                                        <span className="text-[9px] font-extrabold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-100">{titleLength} chars (Not optimal)</span>
                                      ) : (
                                        <span className="text-[9px] font-extrabold text-red-500 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">Critical: Missing tag</span>
                                      )}
                                    </div>
                                    <p className={`text-xs font-mono break-all p-2 rounded ${hasTitle ? "bg-slate-50 text-slate-700" : "bg-red-50/40 text-red-650 font-bold"}`}>
                                      {page.title || "No title defined on this page."}
                                    </p>
                                    <div className="flex justify-end pt-1">
                                      <button
                                        onClick={() => triggerAiRecommendation("missing-titles", { url: page.url })}
                                        className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-700 cursor-pointer"
                                      >
                                        <Sparkles className="w-3.5 h-3.5" />
                                        Optimize Title with AI
                                      </button>
                                    </div>
                                  </div>

                                  {/* Meta Desc Check */}
                                  <div className="p-3 bg-white border border-slate-150 rounded-xl space-y-1.5 shadow-sm">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-slate-800">Meta Description</span>
                                      {hasDesc && descLength >= 120 && descLength <= 160 ? (
                                        <span className="text-[9px] font-extrabold text-emerald-650 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Optimal (120-160 chars)</span>
                                      ) : hasDesc ? (
                                        <span className="text-[9px] font-extrabold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-100">{descLength} chars (Not optimal)</span>
                                      ) : (
                                        <span className="text-[9px] font-extrabold text-red-500 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">Critical: Missing tag</span>
                                      )}
                                    </div>
                                    <p className={`text-xs font-mono break-all p-2 rounded ${hasDesc ? "bg-slate-50 text-slate-700" : "bg-red-50/40 text-red-650 font-bold"}`}>
                                      {page.meta_desc || "No meta description tag configured."}
                                    </p>
                                    <div className="flex justify-end pt-1">
                                      <button
                                        onClick={() => triggerAiRecommendation("missing-descriptions", { url: page.url })}
                                        className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-700 cursor-pointer"
                                      >
                                        <Sparkles className="w-3.5 h-3.5" />
                                        Optimize Description with AI
                                      </button>
                                    </div>
                                  </div>

                                  {/* H1 Heading Check */}
                                  <div className="p-3 bg-white border border-slate-150 rounded-xl space-y-1.5 shadow-sm">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-slate-800">H1 Tag</span>
                                      {hasH1 ? (
                                        <span className="text-[9px] font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">1 H1 Heading Found</span>
                                      ) : (
                                        <span className="text-[9px] font-extrabold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-100">Missing H1 Heading</span>
                                      )}
                                    </div>
                                    <p className={`text-xs font-mono p-2 rounded ${hasH1 ? "bg-slate-50 text-slate-700 font-bold" : "bg-yellow-50/40 text-yellow-750 font-bold"}`}>
                                      {page.h1 || "No H1 header element detected."}
                                    </p>
                                    <div className="flex justify-end pt-1">
                                      <button
                                        onClick={() => triggerAiRecommendation("missing-h1s", { url: page.url })}
                                        className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-700 cursor-pointer"
                                      >
                                        <Sparkles className="w-3.5 h-3.5" />
                                        Optimize H1 Header with AI
                                      </button>
                                    </div>
                                  </div>

                                  {/* Content & Schema Row */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Word Count */}
                                    <div className="p-3 bg-white border border-slate-150 rounded-xl space-y-1.5 shadow-sm">
                                      <span className="text-xs font-bold text-slate-800 block">Content Quality</span>
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">Word Count:</span>
                                        <span className={`text-xs font-black ${isWordCountLow ? "text-red-500" : "text-emerald-600"}`}>
                                          {page.word_count || 0} words
                                        </span>
                                      </div>
                                      <button
                                        onClick={() => triggerAiRecommendation("thin-content", { url: page.url })}
                                        className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-700 w-full justify-end pt-1.5 mt-1 border-t border-slate-50 cursor-pointer"
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        Outline Expansion
                                      </button>
                                    </div>

                                    {/* Schema Markup */}
                                    <div className="p-3 bg-white border border-slate-150 rounded-xl space-y-1.5 shadow-sm">
                                      <span className="text-xs font-bold text-slate-800 block">Structured Schema</span>
                                      <div className="flex flex-wrap gap-1">
                                        {page.schema_types && page.schema_types.length > 0 ? (
                                          page.schema_types.map((st, idx) => (
                                            <span key={idx} className="text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-md px-1.5 py-0.5">
                                              {st}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="text-[10px] font-semibold text-slate-400">None detected</span>
                                        )}
                                      </div>
                                      <button
                                        onClick={() => triggerAiRecommendation("missing-schema", { url: page.url })}
                                        className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-700 w-full justify-end pt-1.5 mt-1 border-t border-slate-50 cursor-pointer"
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        Generate JSON-LD
                                      </button>
                                    </div>
                                  </div>

                                  {/* GEO / AI Search Readiness Audit Section */}
                                  <div className="border-t border-slate-200/60 pt-4 mt-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                      <Bot className="w-4 h-4 text-indigo-650 text-indigo-600 shrink-0" />
                                      <h6 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
                                        GEO & AI Search Readiness (sitefire.ai)
                                      </h6>
                                    </div>

                                    {/* AI Readiness Rubric Score & AI Crawler Directives */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      {/* AI Extraction Score Rubric */}
                                      <div className="p-3 bg-white border border-slate-150 rounded-xl space-y-2.5 shadow-sm">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-bold text-slate-850 text-slate-800">AI Extractability Score</span>
                                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                                            (hasTitle ? 20 : 0) + (hasDesc ? 20 : 0) + (hasH1 ? 20 : 0) + (!isWordCountLow ? 20 : 0) + (page.schema_types && page.schema_types.length > 0 ? 20 : 0) >= 80
                                              ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                              : "bg-amber-50 text-amber-600 border-amber-100"
                                          }`}>
                                            {(hasTitle ? 20 : 0) + (hasDesc ? 20 : 0) + (hasH1 ? 20 : 0) + (!isWordCountLow ? 20 : 0) + (page.schema_types && page.schema_types.length > 0 ? 20 : 0)}/100
                                          </span>
                                        </div>
                                        
                                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                          <div 
                                            className="h-full bg-indigo-600 transition-all duration-500 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                                            style={{ width: `${(hasTitle ? 20 : 0) + (hasDesc ? 20 : 0) + (hasH1 ? 20 : 0) + (!isWordCountLow ? 20 : 0) + (page.schema_types && page.schema_types.length > 0 ? 20 : 0)}%` }}
                                          />
                                        </div>

                                        <p className="text-[10px] text-slate-500 font-semibold leading-relaxed">
                                          Measures formatting accessibility, metadata signals, and tag density for LLM token processing models.
                                        </p>
                                      </div>

                                      {/* AI Bot Crawl Directives */}
                                      <div className="p-3 bg-white border border-slate-150 rounded-xl space-y-1.5 shadow-sm text-xs font-semibold text-slate-700">
                                        <span className="text-xs font-bold text-slate-800 block mb-1">AI Agent Access (robots.txt)</span>
                                        <div className="flex items-center justify-between text-[11px]">
                                          <span className="text-slate-500">ChatGPT (GPTBot)</span>
                                          <span className="text-emerald-600 font-extrabold flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                            Allowed
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px]">
                                          <span className="text-slate-500">Claude (ClaudeBot)</span>
                                          <span className="text-emerald-600 font-extrabold flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                            Allowed
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px]">
                                          <span className="text-slate-500">Gemini (Google-Extended)</span>
                                          <span className="text-emerald-600 font-extrabold flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                            Allowed
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Structured Schema Audit Matrix (Sitefire Check) */}
                                    <div className="p-3 bg-white border border-slate-150 rounded-xl space-y-2 shadow-sm">
                                      <span className="text-xs font-bold text-slate-850 text-slate-800 block">AI Schema Rich Markups Checklist</span>
                                      
                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                                        {[
                                          { type: "Article", label: "Article Schema" },
                                          { type: "FAQPage", label: "FAQPage Schema" },
                                          { type: "Organization", label: "Organization" },
                                          { type: "HowTo", label: "HowTo Schema" },
                                          { type: "Product", label: "Product Schema" },
                                          { type: "Review", label: "Review Schema" }
                                        ].map((sch) => {
                                          const isPresent = page.schema_types && page.schema_types.some(s => s.toLowerCase().includes(sch.type.toLowerCase()));
                                          return (
                                            <div 
                                              key={sch.type}
                                              className={`flex items-center justify-between p-2 rounded-lg border text-[11px] font-bold ${
                                                isPresent 
                                                  ? "bg-emerald-50/50 text-emerald-700 border-emerald-100" 
                                                  : "bg-slate-50/50 text-slate-400 border-slate-150/70"
                                              }`}
                                            >
                                              <span>{sch.label}</span>
                                              <span className="font-extrabold text-[10px]">
                                                {isPresent ? "✅ Present" : "❌ Missing"}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Right recommendation generator pane */}
                              <div className="lg:col-span-5 space-y-3.5 border-l border-slate-200/60 pl-0 lg:pl-6 text-left">
                                <h6 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                                  AI Optimization Suggestions
                                </h6>
                                <p className="text-[11px] text-slate-500">
                                  Click any <strong className="text-indigo-600 font-bold">Optimize</strong> link on the left to invoke the SoloSpider AI agent to automatically formulate content outline briefs, missing schema tags, or ideal titles.
                                </p>

                                {/* Render suggestions in real-time */}
                                <div className="space-y-4">
                                  {["missing-titles", "missing-descriptions", "missing-h1s", "thin-content", "missing-schema"].map(issueKey => {
                                    const rec = aiRecommendations[`${issueKey}-${page.url}`];
                                    if (!rec) return null;

                                    return (
                                      <div key={issueKey} className="border border-indigo-100 bg-indigo-50/20 rounded-xl p-3.5 space-y-2 animate-in fade-in duration-200">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[9px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                                            {issueKey === "missing-titles" ? "AI Title Tag suggestion" 
                                             : issueKey === "missing-descriptions" ? "AI Meta Description"
                                             : issueKey === "missing-h1s" ? "AI H1 Heading tag"
                                             : issueKey === "thin-content" ? "AI Expansion Outline"
                                             : "AI Structured Schema Code"}
                                          </span>
                                          {rec.codeSnippet && !rec.loading && (
                                            <button 
                                              onClick={() => handleCopyText(rec.codeSnippet!, "Schema code copied!")}
                                              className="p-1 text-slate-400 hover:text-indigo-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors cursor-pointer"
                                              title="Copy Code"
                                            >
                                              <Copy className="w-3 h-3" />
                                            </button>
                                          )}
                                        </div>

                                        {rec.loading ? (
                                          <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold py-2">
                                            <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                                            <span>SoloSpider AI formulating answers...</span>
                                          </div>
                                        ) : rec.error ? (
                                          <div className="flex items-center gap-1.5 text-xs text-red-500 font-semibold">
                                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                            <span>{rec.error}</span>
                                          </div>
                                        ) : (
                                          <div className="space-y-2.5">
                                            <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">
                                              {rec.recommendation}
                                            </div>
                                            {rec.codeSnippet && (
                                              <pre className="text-[9px] font-mono p-2.5 bg-slate-950 text-slate-100 rounded-lg overflow-x-auto border border-slate-800 leading-relaxed max-h-40 scrollbar-thin">
                                                <code>{rec.codeSnippet}</code>
                                              </pre>
                                            )}
                                            <div className="border-t border-indigo-100/60 pt-2 flex items-start gap-1.5">
                                              <HelpCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                                              <p className="text-[10px] text-slate-500 font-semibold leading-relaxed">
                                                <strong className="text-slate-650">Context:</strong> {rec.explanation}
                                              </p>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </div>

              {/* Crawled Summary Footer */}
              <div className="bg-slate-50/50 p-6 flex flex-col md:flex-row items-center justify-between gap-4 border-t border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-50/80 flex items-center justify-center shrink-0">
                    <Globe className="w-5 h-5 text-indigo-650" />
                  </div>
                  <div>
                    <h5 className="text-[14px] font-extrabold text-slate-900 mb-0.5">Comprehensive Site Audit Completed</h5>
                    <p className="text-[12px] text-slate-500 font-semibold">
                      Currently tracking <span className="font-extrabold text-indigo-600">{crawledPages.length} scanned paths</span> on your project domain.
                    </p>
                  </div>
                </div>
                <button 
                  onClick={handleStartCrawl}
                  disabled={isCrawlingActive}
                  className="bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-600 text-[12px] font-extrabold py-2.5 px-4 rounded-xl transition-colors flex items-center gap-2 shadow-sm shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isCrawlingActive ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                      Crawling website...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 text-violet-550" />
                      Trigger Fresh Crawler Audit
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
