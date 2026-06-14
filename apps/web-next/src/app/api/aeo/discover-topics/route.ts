import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/server/api";

export const runtime = "nodejs";

const DiscoverTopicsSchema = z.object({
  domain: z.string().min(1),
  brandName: z.string().optional().default(""),
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
      max_tokens: 1500,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter responded with status ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

function cleanDomain(raw: string) {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

export async function POST(request: NextRequest) {
  try {
    const parsed = DiscoverTopicsSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid domain parameter" }, { status: 400 });
    }

    const { domain, brandName } = parsed.data;
    const url = cleanDomain(domain);

    let htmlContent = "";
    try {
      console.log(`[DiscoverTopics] Fetching homepage content from ${url}...`);
      const pageRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        next: { revalidate: 0 }
      });
      if (pageRes.ok) {
        htmlContent = await pageRes.text();
      } else {
        console.warn(`[DiscoverTopics] Homepage fetch returned status ${pageRes.status}`);
      }
    } catch (fetchErr: any) {
      console.warn(`[DiscoverTopics] Homepage fetch failed: ${fetchErr?.message || fetchErr}`);
    }

    // Extract raw text clues from HTML (remove tags, script, style)
    const textClues = htmlContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 10000)
      .trim();

    const promptText = `You are a professional business analyst. Your task is to analyze the text content of a company's website homepage to:
1. DEDUCE the primary target country/market location of this brand. Analyze visible text, addresses, contact details, cities mentioned, currencies, regional spelling conventions (e.g. UK vs US spelling), phone number formats, or venue locations listed on the page. 
   CRITICAL: If the currency is USD and TLD is generic (like .com) but the cities, physical venues, addresses, or services are situated in India (e.g. Mumbai, Bangalore, Delhi), the target location MUST be deduced as "India".
2. DISCOVER exactly 6-8 relevant, high-volume search-phrase keywords/topics (representing unbranded keywords or query themes that actual customers use when looking for products or services in this niche, e.g. 'best budget friendly perfumes', 'long lasting fragrance for women', 'perfume vs eau de toilette', 'perfume sampler sets', 'perfume gift ideas for men') for conversational search engine optimization (AEO/GEO).
3. IDENTIFY exactly 3 actual competitors of this brand (their brand names and website domain names, if possible).

Business Metadata:
- Provided Brand Name: "${brandName}"
- Domain: "${domain}"

CRAWLED HOMEPAGE CONTENT:
"""
${textClues || "No page content crawled."}
"""

Guidelines for Output:
Return the results STRICTLY as a raw JSON object with the following structure:
{
  "targetLocation": "Country Name (e.g. India, United States, United Kingdom, Canada)",
  "locationCode": "Two-letter country code (e.g. IN, US, GB, CA)",
  "explanation": "1-sentence explaining why this location was deduced from the content",
  "competitors": [
    "competitor1.com",
    "competitor2.com",
    "competitor3.com"
  ],
  "topics": [
    {
      "topic": "Search-phrase keyword topic (lowercase, max 5 words, e.g. 'best budget friendly perfumes')",
      "description": "Short description of what search intents fall under this topic",
      "volume": "Estimated search demand ('High', 'Medium', or 'Low')"
    }
  ]
}

Ensure you output ONLY the raw valid JSON. Do not include markdown code block formatting (like \`\`\`json) or any additional explanation outside the JSON.`;

    const llmResponse = await callOpenRouter(promptText);
    let cleanedText = llmResponse.trim();
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(cleanedText);
    } catch {
      const startIdx = cleanedText.indexOf("{");
      const endIdx = cleanedText.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        try {
          parsedResult = JSON.parse(cleanedText.slice(startIdx, endIdx + 1));
        } catch (err) {
          throw new Error("Failed to parse AI response as JSON");
        }
      } else {
        throw new Error("Invalid response format from AI model");
      }
    }

    return NextResponse.json(parsedResult);
  } catch (error: any) {
    console.error("[DiscoverTopics] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
