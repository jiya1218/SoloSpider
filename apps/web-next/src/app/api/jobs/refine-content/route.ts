import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/server/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const RefineContentSchema = z.object({
  contentId: z.string().uuid(),
  prompt: z.string().min(1),
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
          temperature: 0.7,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        text = data.choices?.[0]?.message?.content?.trim() || "";
      }
    } catch (err) {
      console.warn("[callLLM] OpenRouter failed:", err);
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
      console.error("[callLLM] Pollinations fallback failed:", err);
    }
  }

  return text;
}

export async function POST(request: NextRequest) {
  try {
    const parsed = RefineContentSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { contentId, prompt } = parsed.data;
    const supabase = getSupabaseAdmin();

    // 1. Fetch current content
    const { data: item, error: fetchErr } = await supabase
      .from("content_items")
      .select("generated_content, h1, tone")
      .eq("id", contentId)
      .single();

    if (fetchErr || !item) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }

    const currentContent = item.generated_content || "";

    // 2. Call LLM to refine
    const refinementPrompt = `You are a professional editor. Please refine the following blog post content based on the instruction.
Article Title: "${item.h1}"
Instruction: "${prompt}"

Current Article Content:
${currentContent}

Output only the new, fully refined markdown content. Do not include introductory notes, explanations, or think blocks. Keep the tone "${item.tone}".`;

    const refinedContent = await callLLM(refinementPrompt, 3000);

    if (!refinedContent) {
      throw new Error("Failed to generate refined content from AI model.");
    }

    // 3. Update database
    const { error: updateErr } = await supabase
      .from("content_items")
      .update({
        generated_content: refinedContent,
      })
      .eq("id", contentId);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[RefineContent] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
