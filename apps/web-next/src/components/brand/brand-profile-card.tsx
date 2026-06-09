"use client";

import React from "react";
import { User, Edit2, Globe, Building2, Tag, Target, Target as Positioning } from "lucide-react";
import Link from "next/link";
import { Project } from "@/types/project";

const cleanUrl = (url?: string | null) => {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `https://${url}`;
};

const getDisplayUrl = (url?: string | null) => {
  if (!url) return "";
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
};

const inferBrandDetails = (project: Project | null) => {
  const domain = project?.domain || "";
  const name = project?.name || project?.brand_name || "";
  const desc = project?.brand_description || "";

  let industry = "Software & Technology";
  let category = "SaaS Growth Platform";
  let targetAudience = "Founders, Marketers, Growth Teams at SMBs";

  const domainLower = domain.toLowerCase();
  const nameLower = name.toLowerCase();
  const descLower = desc.toLowerCase();

  if (domainLower.includes("venue") || nameLower.includes("venue") || descLower.includes("venue") || descLower.includes("event") || descLower.includes("hospitality")) {
    industry = "Event Management & Hospitality";
    category = "Corporate Venue Discovery & Event Scheduling";
    targetAudience = "Event Planners, Corporate Hosts, Venue Operators & Coordinators";
  } else if (domainLower.includes("scale") || nameLower.includes("scale") || descLower.includes("agency") || descLower.includes("marketing")) {
    industry = "Marketing & Advertising";
    category = "Growth Marketing & SEO Automation Agency";
    targetAudience = "B2B SaaS Founders, E-commerce Brands, CMOs & Growth Leaders";
  }

  return { industry, category, targetAudience };
};

export function BrandProfileCard({ project }: { project: Project | null }) {
  const displayUrl = project?.domain ? getDisplayUrl(project.domain) : "acmesolutions.com";
  const actualUrl = project?.domain ? cleanUrl(project.domain) : "#";
  const { industry, category, targetAudience } = inferBrandDetails(project);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" />
          Brand Profile
        </h3>
        <Link href="/app/en/settings/project" className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
          <Edit2 className="w-3 h-3" /> Edit
        </Link>
      </div>

      <div className="space-y-5">
        <div className="flex items-start">
          <div className="w-1/3 flex items-center gap-2 text-slate-500">
            <Globe className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold">Website</span>
          </div>
          <div className="w-2/3">
            <Link href={actualUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 hover:underline break-all">
              {displayUrl}
            </Link>
          </div>
        </div>

        <div className="flex items-start">
          <div className="w-1/3 flex items-center gap-2 text-slate-500">
            <Building2 className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold">Industry</span>
          </div>
          <div className="w-2/3">
            <p className="text-sm font-semibold text-slate-800">{industry}</p>
          </div>
        </div>

        <div className="flex items-start">
          <div className="w-1/3 flex items-center gap-2 text-slate-500">
            <Tag className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold">Business Category</span>
          </div>
          <div className="w-2/3">
            <p className="text-sm font-semibold text-slate-800">{category}</p>
          </div>
        </div>

        <div className="flex items-start">
          <div className="w-1/3 flex items-center gap-2 text-slate-500">
            <Target className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold">Target Audience</span>
          </div>
          <div className="w-2/3">
            <p className="text-sm font-semibold text-slate-800 leading-snug">{targetAudience}</p>
          </div>
        </div>

        <div className="flex items-start">
          <div className="w-1/3 flex items-center gap-2 text-slate-500">
            <Positioning className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold">Brand Positioning</span>
          </div>
          <div className="w-2/3">
            <p className="text-xs font-semibold text-slate-700 leading-relaxed">
              {project?.brand_description || "Acme Solutions helps ambition-driven teams scale faster with AI-powered marketing intelligence and automation."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
