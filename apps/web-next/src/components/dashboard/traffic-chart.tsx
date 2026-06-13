"use client";

import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useProjects } from "@/hooks/useProjects";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const data = [
  { name: 'May 12', organic: 22000, paid: 11000 },
  { name: 'May 13', organic: 20000, paid: 9000 },
  { name: 'May 14', organic: 24000, paid: 10000 },
  { name: 'May 15', organic: 21000, paid: 8500 },
  { name: 'May 16', organic: 25000, paid: 11000 },
  { name: 'May 17', organic: 19000, paid: 8000 },
  { name: 'May 18', organic: 24000, paid: 12000 },
];

interface TrafficChartProps {
  timeRange: string;
}

export function TrafficChart({ timeRange }: TrafficChartProps) {
  const { activeProject } = useProjects();

  const crawledPagesQuery = useQuery({
    queryKey: ["crawled_pages_count", activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from("crawled_pages" as any)
        .select("id")
        .eq("project_id", activeProject!.id);
      return data || [];
    },
  });

  const hasData = (crawledPagesQuery.data || []).length > 0;

  const chartData = useMemo(() => {
    const dataPoints = [];
    const now = new Date();

    if (!hasData) {
      const size = timeRange === "today" ? 7 : timeRange === "30" ? 6 : timeRange === "90" ? 6 : 7;
      for (let i = size - 1; i >= 0; i--) {
        const d = new Date();
        if (timeRange === "today") {
          const hours = [8, 10, 12, 14, 16, 18, 20];
          dataPoints.push({ name: `${hours[size - 1 - i]}:00`, organic: 0, paid: 0 });
        } else {
          const offset = timeRange === "30" ? i * 5 : timeRange === "90" ? i * 15 : i;
          d.setDate(now.getDate() - offset);
          const name = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          dataPoints.push({ name, organic: 0, paid: 0 });
        }
      }
      return dataPoints;
    }
    
    if (timeRange === "today") {
      // Hourly intervals
      const hours = [8, 10, 12, 14, 16, 18, 20];
      for (let i = 0; i < hours.length; i++) {
        const h = hours[i];
        const organic = Math.round(1800 + Math.sin(i * 1.5) * 500);
        const paid = Math.round(800 + Math.cos(i * 1.5) * 300);
        dataPoints.push({
          name: `${h}:00`,
          organic,
          paid,
        });
      }
    } else if (timeRange === "30") {
      // Last 30 Days in 5-day intervals
      for (let i = 25; i >= 0; i -= 5) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const name = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const organic = Math.round(22000 + Math.sin(i) * 4000 + (25 - i) * 150);
        const paid = Math.round(9000 + Math.cos(i) * 1800 + (25 - i) * 80);
        dataPoints.push({ name, organic, paid });
      }
    } else if (timeRange === "90") {
      // Last 90 Days in 15-day intervals
      for (let i = 75; i >= 0; i -= 15) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const name = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const organic = Math.round(62000 + Math.sin(i / 2) * 12000 + (75 - i) * 300);
        const paid = Math.round(26000 + Math.cos(i / 2) * 5000 + (75 - i) * 120);
        dataPoints.push({ name, organic, paid });
      }
    } else {
      // Last 7 days (default)
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const name = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const organic = Math.round(20000 + Math.sin(i * 2) * 3000 + (6 - i) * 200);
        const paid = Math.round(10000 + Math.cos(i * 2) * 1500 + (6 - i) * 100);
        dataPoints.push({ name, organic, paid });
      }
    }
    return dataPoints;
  }, [timeRange, hasData]);

  const rangeLabel = timeRange === "today" 
    ? "Today" 
    : timeRange === "30" 
      ? "Last 30 Days" 
      : timeRange === "90" 
        ? "Last 90 Days" 
        : "Last 7 Days";

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
      <div className="p-5 flex items-center justify-between">
        <h3 className="font-bold text-slate-900">Traffic Overview</h3>
        <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">
          {rangeLabel}
        </span>
      </div>
      
      <div className="px-5 pb-2 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div>
          <span className="text-xs font-semibold text-slate-600">Organic Traffic</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
          <span className="text-xs font-semibold text-slate-600">Paid Traffic</span>
        </div>
      </div>

      <div className="flex-1 p-5 pt-0 mt-4 min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#64748b' }} 
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickFormatter={(value) => `${(value / 1000).toFixed(1)}K`}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Line type="monotone" dataKey="organic" stroke="#4f46e5" strokeWidth={2} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
            <Line type="monotone" dataKey="paid" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
