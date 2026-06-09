import { NextResponse, type NextRequest } from "next/server";
import { readJson } from "@/server/api";

export const runtime = "nodejs";

async function callLLM(prompt: string, maxTokens = 1500) {
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
      }
    } catch (err) {
      console.warn("[generate-social-post] OpenRouter failed, falling back:", err);
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
      console.error("[generate-social-post] Pollinations fallback failed:", err);
    }
  }

  return text;
}

function cleanAndParseJson(text: string) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }
  return JSON.parse(cleaned);
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);

    // 1. Image generation
    if (body.type === "image" || body.action === "image") {
      const promptText = body.prompt || "Minimalist aesthetic social media post graphic";
      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/p/${encodeURIComponent(promptText)}?width=1080&height=1080&nologo=true&seed=${seed}`;
      return NextResponse.json({ imageUrl });
    }

    // 2. Social ideas generation
    if (body.action === "ideas") {
      const prompt = `You are an expert Instagram content strategist. Generate 5 high-performing Instagram post ideas for this brand.

Brand: ${body.brandName}
Description: ${body.brandDescription || "Not provided"}
Instagram Bio: ${body.instagramBio || "Not provided"}
Recent Post Samples: ${(body.recentCaptions || []).slice(0, 3).join(" | ") || "None"}
Common Hashtags: ${(body.recentHashtags || []).slice(0, 10).join(", ") || "None"}

Return ONLY a valid JSON array with exactly 5 objects. Each object must have:
- "id": unique string like "idea_1"
- "type": one of "educational", "promotional", "engagement", "story", "product"
- "hook": a powerful opening line (max 15 words)
- "caption": full Instagram caption (150-300 chars, engaging, with emojis)
- "hashtags": array of 15-20 relevant hashtags (without # symbol)
- "imagePrompt": a detailed visual description for image generation (describe the scene, style, colors)

Make captions authentic, engaging, and platform-native. Mix the types across the 5 posts. Do not wrap in markdown code blocks like \`\`\`json. Output raw JSON.`;

      const text = await callLLM(prompt, 1800);
      try {
        const json = cleanAndParseJson(text);
        return NextResponse.json(json);
      } catch (parseError) {
        console.error("JSON parse failed, raw LLM text was:", text);
        // Fallback hardcoded ideas structured array
        return NextResponse.json([
          {
            id: "idea_1",
            type: "educational",
            hook: `Top tips for growing your business with ${body.brandName}!`,
            caption: `Did you know that strategic consistency is key? Let's talk about it. We are dedicated to providing the best values. 📈💡`,
            hashtags: ["business", "growth", "strategy", "innovation"],
            imagePrompt: `Clean, modern office space with laptops and charts showing upward trends.`
          }
        ]);
      }
    }

    // 3. Single post generation
    if (body.action === "single_post") {
      const prompt = `You are an expert copywriter. Generate a social media post draft for:
Brand: ${body.brandName}
Description: ${body.brandDescription || ""}
Goal: ${body.goal || "Brand awareness"}
Tone: ${body.tone || "engaging"}
Topic/Instruction: ${body.prompt || "General overview"}

Return ONLY a valid JSON object with the following fields:
- "hook": a catchy opening line (max 15 words)
- "caption": full post caption (150-300 chars, engaging, with emojis)
- "hashtags": array of 10-15 relevant hashtags (without # symbol)
- "imagePrompt": a visual prompt for generating a matching post image

Do not wrap in markdown code blocks. Output raw JSON.`;

      const text = await callLLM(prompt, 1000);
      try {
        const json = cleanAndParseJson(text);
        return NextResponse.json(json);
      } catch (parseError) {
        console.error("JSON parse failed, raw LLM text was:", text);
        return NextResponse.json({
          hook: `Discover ${body.brandName} today!`,
          caption: `We are redefining what is possible in our industry. Join us on this journey. ✨`,
          hashtags: ["onbrand", "launch", "innovation"],
          imagePrompt: `Minimal abstract illustration with pastel shapes representing growth`
        });
      }
    }

    return NextResponse.json({ error: "Invalid action or type parameter" }, { status: 400 });
  } catch (error: any) {
    console.error("[GenerateSocialPost] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
