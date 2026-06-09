import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/server/api";

export const runtime = "nodejs";

const GenerateTitleSchema = z.object({
  keyword: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = GenerateTitleSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid keyword provided" }, { status: 400 });
    }

    const { keyword } = parsed.data;
    const prompt = `You are a professional SEO copywriter. Generate one catchy, clickable, and SEO-optimized blog post title for the keyword: "${keyword}". Return ONLY the title string itself. Do not include quotes, explanations, markdown formatting, or extra text.`;

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    let title = "";

    // 1. Try OpenRouter (Gemini 2.5 Flash)
    if (openrouterKey) {
      try {
        console.log("[GenerateTitle] Calling OpenRouter...");
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
            max_tokens: 150,
            temperature: 0.7,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          title = data.choices?.[0]?.message?.content?.trim() || "";
        }
      } catch (err) {
        console.warn("[GenerateTitle] OpenRouter failed, falling back...", err);
      }
    }

    // 2. Fallback to Pollinations AI
    if (!title) {
      try {
        console.log("[GenerateTitle] Calling Pollinations AI fallback...");
        const pollinationsUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai`;
        const res = await fetch(pollinationsUrl);
        if (res.ok) {
          title = (await res.text()).trim();
        }
      } catch (err) {
        console.error("[GenerateTitle] Pollinations fallback failed:", err);
      }
    }

    // Clean up title (remove outer quotes if LLM added them)
    if (title) {
      title = title.replace(/^["']|["']$/g, "").trim();
    } else {
      // Final hardcoded fallback
      title = `Expert Guide to ${keyword.charAt(0).toUpperCase() + keyword.slice(1)}`;
    }

    return NextResponse.json({ title });
  } catch (error: any) {
    console.error("[GenerateTitle] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
