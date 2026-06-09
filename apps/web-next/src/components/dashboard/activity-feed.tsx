"use client";

import React, { useMemo } from "react";
import { CheckCircle2, FileText, Share2, Eye, Link as LinkIcon, Loader2 } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useProjects } from "@/hooks/useProjects";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const timeAgo = (date: Date) => {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 0) return "just now";
  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return `${interval}y ago`;
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return `${interval}mo ago`;
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return `${interval}d ago`;
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return `${interval}h ago`;
  interval = Math.floor(seconds / 60);
  if (interval >= 1) return `${interval}m ago`;
  return "just now";
};

const getIcon = (type: string) => {
  if (type === "crawl") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (type === "content") return <FileText className="w-4 h-4 text-indigo-500" />;
  if (type === "scan") return <Eye className="w-4 h-4 text-amber-500" />;
  if (type === "social") return <Share2 className="w-4 h-4 text-pink-500" />;
  return <LinkIcon className="w-4 h-4 text-slate-500" />;
};

const getBgColor = (type: string) => {
  if (type === "crawl") return "bg-emerald-50";
  if (type === "content") return "bg-indigo-50";
  if (type === "scan") return "bg-amber-50";
  if (type === "social") return "bg-pink-50";
  return "bg-slate-50";
};

export function ActivityFeed() {
  const { activeProject } = useProjects();

  const activityQuery = useQuery({
    queryKey: ["recent_activities", activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const pid = activeProject!.id;

      let crawls: any[] = [];
      try {
        const { data } = await supabase
          .from("crawl_runs" as any)
          .select("id, status, created_at, pages_found")
          .eq("project_id", pid)
          .order("created_at", { ascending: false })
          .limit(5);
        if (data) crawls = data;
      } catch (e) {
        console.error("Error fetching crawl_runs:", e);
      }

      let content: any[] = [];
      try {
        const { data } = await supabase
          .from("content_items" as any)
          .select("id, title, status, created_at")
          .eq("project_id", pid)
          .order("created_at", { ascending: false })
          .limit(5);
        if (data) content = data;
      } catch (e) {
        console.error("Error fetching content_items:", e);
      }

      let promptScans: any[] = [];
      try {
        const { data } = await supabase
          .from("prompt_scan_runs" as any)
          .select("id, status, created_at, score")
          .eq("project_id", pid)
          .order("created_at", { ascending: false })
          .limit(5);
        if (data) promptScans = data;
      } catch (e) {
        console.error("Error fetching prompt_scan_runs:", e);
      }

      let socialPosts: any[] = [];
      try {
        const { data } = await supabase
          .from("social_posts" as any)
          .select("id, status, created_at, platform")
          .eq("project_id", pid)
          .order("created_at", { ascending: false })
          .limit(5);
        if (data) socialPosts = data;
      } catch (e) {
        console.error("Error fetching social_posts:", e);
      }

      const list: any[] = [];

      crawls.forEach((c: any) => {
        list.push({
          id: `crawl-${c.id}`,
          title: "SEO Site Crawl",
          desc: c.status === "completed" 
            ? `Crawl completed successfully (${c.pages_found || 0} pages)`
            : c.status === "failed" 
              ? "Crawl scan failed" 
              : "Crawl run in progress",
          created_at: new Date(c.created_at),
          type: "crawl"
        });
      });

      content.forEach((c: any) => {
        list.push({
          id: `content-${c.id}`,
          title: "Blog Created",
          desc: `Blog: "${c.title || "Untitled"}" (${c.status || "draft"})`,
          created_at: new Date(c.created_at),
          type: "content"
        });
      });

      promptScans.forEach((s: any) => {
        list.push({
          id: `scan-${s.id}`,
          title: "AI Visibility Scan",
          desc: s.status === "completed" 
            ? `Scan completed (Score: ${s.score || 0})`
            : s.status === "failed" 
              ? "Scan failed" 
              : "Scan run in progress",
          created_at: new Date(s.created_at),
          type: "scan"
        });
      });

      socialPosts.forEach((p: any) => {
        list.push({
          id: `social-${p.id}`,
          title: "Social Post",
          desc: `Post generated for ${p.platform || "social"} (${p.status || "draft"})`,
          created_at: new Date(p.created_at),
          type: "social"
        });
      });

      list.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return list.slice(0, 5);
    }
  });

  const activities = activityQuery.data || [];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-bold text-slate-900">Recent Activity</h3>
        <Link href="/app/en/reports" className="text-xs font-semibold text-blue-600 hover:text-blue-700">View All</Link>
      </div>
      
      {activityQuery.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-8 text-xs text-slate-500 font-medium">
          No recent activities found.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start gap-3.5">
              <div className={`p-2 rounded-full ${getBgColor(activity.type)} shrink-0 mt-0.5`}>
                {getIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-800 truncate leading-snug">{activity.title}</h4>
                <p className="text-xs text-slate-500 font-medium truncate mt-0.5 leading-snug">{activity.desc}</p>
              </div>
              <span className="text-[10px] font-semibold text-slate-400 shrink-0 mt-1">{timeAgo(activity.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
