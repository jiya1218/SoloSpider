import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/server/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const GeneratePromptsSchema = z.object({
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

async function callLLM(prompt: string, maxTokens = 2000) {
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
          temperature: 0.8,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        text = data.choices?.[0]?.message?.content?.trim() || "";
      } else {
        console.warn(`[callLLM] OpenRouter responded with ${response.status}: ${await response.text()}`);
      }
    } catch (err) {
      console.warn("[callLLM] OpenRouter failed, falling back:", err);
    }
  }

  // Fallback to pollinations if OpenRouter is unavailable
  if (!text) {
    try {
      const pollinationsUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai`;
      const res = await fetch(pollinationsUrl);
      if (res.ok) {
        text = (await res.text()).trim();
      }
    } catch (err) {
      console.error("[callLLM] Pollinations fallback failed:", err);
    }
  }

  return text;
}

export async function POST(request: NextRequest) {
  try {
    const parsed = GeneratePromptsSchema.safeParse(await readJson(request));
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

    // 2. Fetch crawled pages to extract context
    const { data: pages } = await supabase
      .from("crawled_pages" as any)
      .select("url, title, meta_desc, h1")
      .eq("project_id", projectId)
      .limit(15);

    let webContent = "";
    if (pages && pages.length > 0) {
      webContent = pages.map(p => `* URL: ${p.url}\n  Title: ${p.title || ""}\n  H1: ${p.h1 || ""}\n  Description: ${p.meta_desc || ""}`).join("\n");
    } else {
      webContent = "No pages indexed yet.";
    }

    const brandName = project.brand_name || project.name;
    const domain = project.domain;
    const brandDescription = project.brand_description || project.brand_tagline || "a digital brand";

    // 3. Build Prompt
    const promptText = `You are an expert SEO and Answer Engine Optimization (AEO/GEO) query researcher.
Your task is to analyze the following business/website metadata and generate a comprehensive list of exactly 25 highly realistic, diverse, and natural search queries (prompts) that potential clients or buyers would ask conversational AI search engines (like ChatGPT Search, Gemini, Claude, or Perplexity) to discover, evaluate, compare, or research a business like ours.

Business Information:
- Brand Name: "${brandName}"
- Website Domain: "${domain}"
- Description: "${brandDescription}"

Crawled Website Content:
${webContent}

Guidelines for generating prompts:
1. Generate exactly 25 search prompts. Do not generate less or more.
2. Structure the prompts around real-world topics relevant to the brand's industry (e.g. if construction/buying: supply chain management, concrete rates, cash flow, reverse auctions, inventory management, builder tools, sourcing platforms).
3. The prompts must include:
   - Industry-specific informational/problem queries (e.g., "how can I improve cash flow on my next big building project", "what do successful builders use to track stock")
   - Comparison queries (e.g., "compare ${brandName} vs sitefire.ai", "is ${brandName} better than traditional procurement")
   - Commercial buying intent queries (e.g., "what is the best construction sourcing tool for supplying materials")
4. Group the prompts logically into brief 'topic' tags (e.g. "Inventory Management", "Procurement Process", "Sourcing Software", "Pricing Transparency").
5. Return the result strictly as a valid JSON array of objects. Each object MUST contain these fields:
   - "topic": string (max 4 words, capitalized topic name)
   - "prompt": string (the exact conversational search engine prompt)
   - "rationale": string (1-sentence explaining why this prompt is important for AEO research)

Format your output STRICTLY as a raw JSON array. Do not include markdown code block formatting (like \`\`\`json or backticks) or any additional text.`;

    const llmResponse = await callLLM(promptText, 2500);
    if (!llmResponse) {
      throw new Error("Failed to generate response from LLM");
    }

    // Sanitize JSON response block in case the LLM returned code block formatting
    let cleanedText = llmResponse.trim();
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    let promptsArray;
    try {
      promptsArray = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error("[GeneratePrompts] JSON Parse Error on raw response:", cleanedText);
      throw new Error("Invalid JSON returned by the AI model");
    }

    if (!Array.isArray(promptsArray) || promptsArray.length === 0) {
      throw new Error("AI did not return a valid array of prompts");
    }

    // 4. Save prompts to aeo_prompts table in Supabase
    // To ensure we don't insert exact duplicates, query existing prompts
    const { data: existingPrompts } = await supabase
      .from("aeo_prompts")
      .select("prompt")
      .eq("project_id", projectId);

    const existingSet = new Set((existingPrompts || []).map(p => p.prompt.toLowerCase().trim()));

    const newRows = promptsArray
      .filter((p: any) => p && p.prompt && !existingSet.has(p.prompt.toLowerCase().trim()))
      .map((p: any) => ({
        project_id: projectId,
        topic: (p.topic || "General").trim(),
        prompt: p.prompt.trim(),
        is_active: true,
      }));

    if (newRows.length > 0) {
      const { error: insertError } = await supabase
        .from("aeo_prompts")
        .insert(newRows);
      
      if (insertError) throw insertError;
    }

    return NextResponse.json({ ok: true, generated: promptsArray.length, inserted: newRows.length });
  } catch (error: any) {
    console.error("[GeneratePrompts] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
