import { supabase } from "./supabase.js";
import { queryModel } from "./openrouter.js";

export async function generateAndSaveAiPrompts(projectId: string) {
  try {
    console.log(`[PromptGenerator] Generating AEO prompts for project ${projectId}...`);

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
      webContent = "No pages indexed yet.";
    }

    const brandName = project.brand_name || project.name;
    const domain = project.domain;
    const brandDescription = project.brand_description || project.brand_tagline || "a digital brand";

    // 3. Prompt for model
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

    const res = await queryModel("gemini", promptText, "You are a JSON generator. Respond ONLY with valid JSON array.");
    let cleanedText = res.text.trim();
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    let promptsArray;
    try {
      promptsArray = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error("[PromptGenerator] JSON Parse Error on raw response:", cleanedText);
      return;
    }

    if (!Array.isArray(promptsArray) || promptsArray.length === 0) {
      console.warn("[PromptGenerator] AI did not return a valid array of prompts.");
      return;
    }

    // Save to database
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
      console.log(`[PromptGenerator] Successfully inserted ${newRows.length} new dynamic AI prompts for project ${projectId}.`);
    } else {
      console.log(`[PromptGenerator] No new AEO prompts to insert for project ${projectId}.`);
    }
  } catch (err) {
    console.error(`[PromptGenerator] Error generating AEO prompts:`, err);
  }
}
