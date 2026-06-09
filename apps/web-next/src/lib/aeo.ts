import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AeoAnalysisResult = {
  overallScore: number;
  providers: any[];
  categoryScores: any[];
  recommendations: any[];
  promptSuggestions: any[];
};

export async function runAeoAnalysis(params: {
  website: string;
  brandName: string;
  topics: string[];
  brandDescription?: string;
}): Promise<AeoAnalysisResult> {
  const res = await fetch("/api/jobs/generate-aeo-analysis", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server returned ${res.status}`);
  }

  const data = await res.json();
  return data as AeoAnalysisResult;
}
