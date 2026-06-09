import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/server/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const GenerateBrandSummarySchema = z.object({
  projectId: z.string().uuid(),
});

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    {
      auth: { persistSession: false },
    }
  );
}

async function callLLM(prompt: string, maxTokens = 500) {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  let text = "";

  if (openrouterKey) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://solospider.ai",
          "X-Title": "SoloSpider",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.7,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        text = data.choices?.[0]?.message?.content?.trim() || "";
      }
    } catch (err) {
      console.warn("[generate-brand-summary] OpenRouter failed, falling back:", err);
    }
  }

  if (!text) {
    try {
      const pollinationsUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai`;
      const res = await fetch(pollinationsUrl);
      if (res.ok) {
        text = (await res.text()).trim();
      }
    } catch (err) {
      console.error("[generate-brand-summary] Pollinations fallback failed:", err);
    }
  }

  return text;
}

export async function POST(request: NextRequest) {
  try {
    const parsed = GenerateBrandSummarySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid projectId parameter" }, { status: 400 });
    }

    const { projectId } = parsed.data;
    const supabase = getSupabaseAdmin();

    // 1. Fetch project details
    const { data: project, error: fetchErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (fetchErr || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 2. Fetch some crawled pages to guide brand tone/topic
    const { data: pages } = await supabase
      .from("crawled_pages" as any)
      .select("url, title, meta_desc, h1")
      .eq("project_id", projectId)
      .limit(5);

    const homepage = (pages || []).find((p: any) => 
      p.url.replace(/\/$/, "") === project.domain.replace(/\/$/, "") || 
      p.url.includes(project.domain)
    ) || (pages?.[0]);

    let crawledContext = "";
    if (homepage) {
      crawledContext = `
Homepage Title: "${homepage.title || ""}"
Homepage Meta Description: "${homepage.meta_desc || ""}"
Homepage Top Heading (H1): "${homepage.h1 || ""}"
`;
    }

    // 3. Build branding prompt
    const prompt = `You are an elite branding consultant. Please write a highly professional, engaging, and premium brand summary paragraph (exactly 3 to 4 sentences long) representing the company:

Company Name: "${project.brand_name || project.name}"
Website URL: "${project.domain}"
Tagline: "${project.brand_tagline || ""}"
${crawledContext}

The summary should tie in their core values, target market, and highlight how they empower customers. Output ONLY the summary paragraph text itself. Do not include quote marks around the summary, introductory text, think blocks, or markdown formatting.`;

    const summary = await callLLM(prompt, 500);

    if (!summary) {
      throw new Error("Failed to generate brand summary from LLM");
    }

    // 4. Update the projects table with the generated summary
    const { error: updateErr } = await supabase
      .from("projects")
      .update({
        brand_description: summary,
      })
      .eq("id", projectId);

    if (updateErr) throw updateErr;

    return NextResponse.json({ brand_description: summary });
  } catch (error: any) {
    console.error("[GenerateBrandSummary] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
