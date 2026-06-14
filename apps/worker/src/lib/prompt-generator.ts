import { supabase } from "./supabase.js";
import { queryModel } from "./openrouter.js";

export async function generateAndSaveAiPrompts(projectId: string) {
  try {
    console.log(`[PromptGenerator] Generating AEO prompts for project ${projectId}...`);

    // Check if custom prompts already exist (e.g. created in the onboarding wizard)
    const { count, error: countErr } = await supabase
      .from("aeo_prompts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId);

    if (!countErr && typeof count === "number" && count > 5) {
      console.log(`[PromptGenerator] Project ${projectId} already has ${count} custom prompts. Skipping AI prompt generation to preserve them.`);
      return;
    }

    // 1. Fetch project details
    const { data: project, error: fetchErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (fetchErr || !project) {
      console.error(`[PromptGenerator] Project ${projectId} not found:`, fetchErr);
      return;
    }

    const rawDesc = project.brand_description || "";
    let cleanDesc = rawDesc;
    let competitorsFromMeta: string[] = [];
    let location = "United States";
    const parts = rawDesc.split("\n---\nMETADATA: ");
    if (parts.length > 1) {
      cleanDesc = parts[0];
      try {
        const meta = JSON.parse(parts[1]);
        if (Array.isArray(meta.competitors)) {
          competitorsFromMeta = meta.competitors;
        }
        if (meta.location) {
          location = meta.location;
        }
      } catch (e) {
        console.warn("[PromptGenerator] Failed to parse project metadata:", e);
      }
    }

    const brandName = project.brand_name || project.name;
    const domain = project.domain;
    const brandDescription = cleanDesc || project.brand_tagline || "a digital brand";

    // 2. Fetch crawled pages to guide AI prompt generation
    const { data: pages } = await supabase
      .from("crawled_pages" as any)
      .select("url, title, meta_desc, h1")
      .eq("project_id", projectId)
      .limit(15);

    let webContent = "";
    if (pages && pages.length > 0) {
      webContent = pages.map(p => `* URL: ${p.url}\n  Title: ${p.title || ""}\n  H1: ${p.h1 || ""}\n  Description: ${p.meta_desc || ""}`).join("\n");
    } else {
      console.log(`[PromptGenerator] No crawled pages in database. Fetching homepage ${domain} dynamically...`);
      try {
        let cleanUrl = domain.trim();
        if (!/^https?:\/\//i.test(cleanUrl)) {
          cleanUrl = "https://" + cleanUrl;
        }
        const pageRes = await fetch(cleanUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const cleanText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .slice(0, 10000)
            .trim();
          webContent = `Homepage Context (Fetched Dynamically):\n${cleanText}`;
        } else {
          console.warn(`[PromptGenerator] Homepage fetch returned status ${pageRes.status}`);
        }
      } catch (err: any) {
        console.warn(`[PromptGenerator] Dynamic homepage fetch failed: ${err?.message || err}`);
      }
    }

    if (!webContent) {
      webContent = "No pages indexed yet.";
    }

    // 3. Prompt for model
    const promptText = `You are an expert SEO and Answer Engine Optimization (AEO/GEO) query researcher.
Your task is to analyze the following business details, crawled homepage content, and target market context to generate a comprehensive list of exactly 25 highly realistic, diverse, and natural conversational search queries (prompts) that buyers or clients located in "${location}" would search on conversational search engines (like ChatGPT Search, Gemini Search, Claude, or Perplexity) to discover, evaluate, compare, or research products/services in this vertical.

Business Information (For niche context only):
- Brand Name: "${brandName}"
- Domain: "${domain}"
- Target Location / Country: "${location}"
- Competitors: [${competitorsFromMeta.join(", ")}]

Crawled Website Content:
${webContent}

Guidelines for generating prompts:
1. Generate exactly 25 search prompts. Do not generate less or more.
2. Group the prompts logically under 6-8 key unbranded search-phrase keywords/topics relevant to the brand's industry (e.g. 'best budget friendly perfumes', 'long lasting fragrance for women', 'perfume vs eau de toilette', 'perfume sampler sets', 'perfume gift ideas for men'). 
3. CRITICAL: ALL GENERATED PROMPTS MUST BE COMPLETELY UNBRANDED. Do NOT include our brand name "${brandName}", our domain "${domain}", or the names of the competitors (like ${competitorsFromMeta.join(", ")}) in any of the prompts. They must be organic category/industry queries that real users would search (e.g. "perfumes under $50 that smell luxurious", "how do I choose a signature scent", "What are some highly recommended fragrances known for lasting all day?", "Compare perfume and EDT for longevity").
4. The queries must read naturally like queries typed or spoken by real users in "${location}" (e.g. including local search terms, pricing in local currency like INR if location is India, or targeting localized intent).
5. Do NOT generate generic placeholder templates such as "Is [Brand] trustworthy?". Instead, customize them to the actual niche, features, and topics of the business (e.g. fragrance, construction procurement, venue booking, etc.) while keeping them unbranded.

6. Return the result strictly as a valid JSON array of objects. Each object MUST contain these fields:
   - "topic": string (lowercase, max 5 words, capitalized search-phrase keyword topic, e.g. 'best budget friendly perfumes')
   - "prompt": string (the exact conversational search engine prompt)
   - "rationale": string (1-sentence explaining why this prompt is important for AEO research)

Format your output STRICTLY as a raw JSON array. Do not include markdown code block formatting (like \`\`\`json or backticks) or any additional text.`;

    const res = await queryModel("gemini", promptText, "You are a JSON generator. Respond ONLY with valid JSON array.", 2500);
    let cleanedText = res.text.trim();
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
        const candidate = cleanedText.slice(startIdx, endIdx + 1);
        try {
          promptsArray = JSON.parse(candidate);
        } catch (err) {
          console.error("[PromptGenerator] Failed to parse candidate JSON:", err);
        }
      }
    }

    if (!Array.isArray(promptsArray) || promptsArray.length === 0) {
      console.warn("[PromptGenerator] AI did not return a valid array of prompts.");
      return;
    }

    // 4. Delete existing prompts to make room for a completely fresh list of AI prompts
    const { error: deleteErr } = await supabase
      .from("aeo_prompts")
      .delete()
      .eq("project_id", projectId);

    if (deleteErr) {
      console.warn(`[PromptGenerator] Failed to clear old prompts: ${deleteErr.message}`);
    }

    const newRows = promptsArray
      .filter((p: any) => p && p.prompt)
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
      console.log(`[PromptGenerator] Successfully inserted ${newRows.length} new dynamic AI prompts for project ${projectId}.`);
    } else {
      console.log(`[PromptGenerator] No new AEO prompts to insert for project ${projectId}.`);
    }
  } catch (err) {
    console.error(`[PromptGenerator] Error generating AEO prompts:`, err);
  }
}
