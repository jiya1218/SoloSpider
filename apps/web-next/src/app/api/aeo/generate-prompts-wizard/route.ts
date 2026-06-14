import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/server/api";

export const runtime = "nodejs";

const GeneratePromptsWizardSchema = z.object({
  brandName: z.string().min(1),
  domain: z.string().min(1),
  location: z.string().min(1),
  selectedTopics: z.array(z.string()).min(1),
  competitors: z.array(z.string()).optional().default([]),
});

async function callOpenRouter(prompt: string, model = "google/gemini-2.5-flash") {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    throw new Error("OPENROUTER_API_KEY is not defined in environment");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://solospider.ai",
      "X-Title": "SoloSpider",
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter responded with status ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export async function POST(request: NextRequest) {
  try {
    const parsed = GeneratePromptsWizardSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { brandName, domain, location, selectedTopics, competitors } = parsed.data;

    let webContent = "";
    try {
      console.log(`[GeneratePromptsWizard] Fetching homepage content for domain ${domain} dynamically...`);
      let cleanUrl = domain.trim();
      if (!/^https?:\/\//i.test(cleanUrl)) {
        cleanUrl = "https://" + cleanUrl;
      }
      const pageRes = await fetch(cleanUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        webContent = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 10000)
          .trim();
      }
    } catch (err: any) {
      console.warn(`[GeneratePromptsWizard] Dynamic homepage fetch failed: ${err?.message || err}`);
    }

    const promptText = `You are an expert SEO and Answer Engine Optimization (AEO/GEO) query researcher.
Your task is to analyze the following business details, crawled homepage content, and selected keyword topics to generate a comprehensive list of exactly 25 highly realistic, diverse, and natural conversational search queries (prompts) that buyers or clients located in "${location}" would search on conversational search engines (like ChatGPT Search, Gemini Search, Claude, or Perplexity) to discover, evaluate, compare, or research products/services in this vertical.

Business Information (For niche context only):
- Brand Name: "${brandName}"
- Domain: "${domain}"
- Target Location / Country: "${location}"
- Competitors: [${competitors.join(", ")}]
- Selected Focus Topics: [${selectedTopics.join(", ")}]

Crawled Homepage Content:
${webContent || "No page content available."}

Guidelines:
1. Generate EXACTLY 25 search prompts. Do not generate less or more.
2. Group the prompts under the selected focus topics: [${selectedTopics.join(", ")}]. Distribute the 25 prompts reasonably across these topics.
3. CRITICAL: ALL GENERATED PROMPTS MUST BE COMPLETELY UNBRANDED. Do NOT include our brand name "${brandName}", our domain "${domain}", or the names of the competitors (like ${competitors.join(", ")}) in any of the prompts. They must be organic category/industry queries that real users would search (e.g. "perfumes under $50 that smell luxurious", "how do I choose a signature scent", "What are some highly recommended fragrances known for lasting all day?", "Compare perfume and EDT for longevity").
4. The queries must read naturally like queries typed or spoken by real users in "${location}" (e.g. including local search terms, pricing in local currency like INR if location is India, or targeting localized intent).
5. Do NOT generate generic placeholder templates such as "Is [Brand] trustworthy?". Instead, customize them to the actual niche, features, and topics of the business (e.g. fragrance, construction procurement, venue booking, etc.) while keeping them unbranded.

6. Return the result STRICTLY as a valid JSON array of objects. Each object MUST contain these fields:
   - "topic": string (must match one of the focus topics exactly)
   - "prompt": string (the exact conversational prompt)
   - "rationale": string (1-sentence rationale explaining why this prompt matters for AEO)

Format the output strictly as raw JSON. Do not include markdown code block formatting (like \`\`\`json) or any additional text.`;

    const llmResponse = await callOpenRouter(promptText);
    let cleanedText = llmResponse.trim();
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    let promptsArray = [];
    try {
      promptsArray = JSON.parse(cleanedText);
    } catch {
      const startIdx = cleanedText.indexOf("[");
      const endIdx = cleanedText.lastIndexOf("]");
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        try {
          promptsArray = JSON.parse(cleanedText.slice(startIdx, endIdx + 1));
        } catch (err) {
          throw new Error("Failed to parse AI prompts response as JSON array");
        }
      } else {
        throw new Error("Invalid array format from AI model");
      }
    }

    if (!Array.isArray(promptsArray) || promptsArray.length === 0) {
      throw new Error("AI did not return a valid array of prompts");
    }

    return NextResponse.json(promptsArray);
  } catch (error: any) {
    console.error("[GeneratePromptsWizard] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
