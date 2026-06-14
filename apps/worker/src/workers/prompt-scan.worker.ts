import { Worker, Job } from "bullmq";
import { redis } from "../config.js";
import { supabase } from "../lib/supabase.js";
import { queryModel, MODEL_MAP } from "../lib/openrouter.js";
import { parseCitations, extractCitationsFromText } from "../lib/citation-parser.js";
import { generateFanouts } from "../lib/fanout-generator.js";
import { persistGapsForRun } from "../lib/gap-detector.js";
import { PromptScanJobData, scoringQueue } from "../queues.js";

async function processPromptScanJob(job: Job<PromptScanJobData>): Promise<object> {
  const {
    project_id, brand_name,
    models = ["chatgpt", "gemini", "perplexity", "claude"],
    competitors = [],
    prompt_ids = null,
    run_id,
  } = job.data;

  // Load project domain metadata & target market details for grounding
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, domain, brand_name, brand_description, brand_tagline")
    .eq("id", project_id)
    .single();

  const rawDesc = project?.brand_description || "";
  let cleanDesc = rawDesc;
  let competitorsFromMeta: string[] = [];
  const parts = rawDesc.split("\n---\nMETADATA: ");
  if (parts.length > 1) {
    cleanDesc = parts[0];
    try {
      const meta = JSON.parse(parts[1]);
      if (Array.isArray(meta.competitors)) {
        competitorsFromMeta = meta.competitors;
      }
    } catch (e) {
      console.warn("[PromptScanWorker] Failed to parse project metadata:", e);
    }
  }

  // Merge default competitors to guarantee they are always tracked in scans if none are specified
  const competitorsInput = Array.isArray(competitors) ? competitors : [];
  const allParsedCompetitors = [...competitorsInput, ...competitorsFromMeta].map(c => c.toLowerCase().trim()).filter(Boolean);
  
  const mergedCompetitors = allParsedCompetitors.length > 0
    ? Array.from(new Set(allParsedCompetitors))
    : [];

  console.log(`[PromptScanWorker] Job ${job.id} — project=${project_id} models=${models.join(",")} competitors=${mergedCompetitors.join(",")}`);

  // ── 1. Load prompts ─────────────────────────────────────────────────────────
  let query = supabase
    .from("aeo_prompts")
    .select("id, prompt, topic")
    .eq("project_id", project_id)
    .eq("is_active", true);

  if (prompt_ids && prompt_ids.length > 0) query = query.in("id", prompt_ids);

  const { data: prompts, error: promptsErr } = await query.limit(50);
  if (promptsErr) throw promptsErr;
  if (!prompts || prompts.length === 0) {
    throw new Error("No active prompts found. Add prompts in the Prompt Lab tab first.");
  }

  // Load crawled pages for RAG grounding context
  const { data: crawledPages } = await supabase
    .from("crawled_pages")
    .select("url, title, meta_desc, h1")
    .eq("project_id", project_id)
    .eq("status_code", 200)
    .limit(15);

  const brandNameGround = project?.brand_name || project?.name || brand_name;
  const brandDomainGround = project?.domain || "";
  const brandDescriptionGround = cleanDesc || project?.brand_tagline || "A leading platform in its space.";

  let competitorsSection = "";
  if (mergedCompetitors.length > 0) {
    competitorsSection = `Target Competitors:\n${mergedCompetitors.map(c => `- ${c}`).join("\n")}\n\n`;
  }

  let groundingContext = `\nWeb Search Grounding Context:\nBrand Information:\n- Brand Name: ${brandNameGround}\n- Website Domain: ${brandDomainGround}\n- Description: ${brandDescriptionGround}\n\n${competitorsSection}Indexed Web Pages for ${brandNameGround}:\n`;

  if (crawledPages && crawledPages.length > 0) {
    groundingContext += crawledPages.map(p => `* URL: ${p.url}\n  Title: ${p.title || ""}\n  Description: ${p.meta_desc || ""}\n  Heading: ${p.h1 || ""}`).join("\n");
  } else {
    groundingContext += "No indexed web pages available yet.";
  }

  const competitorInstruction = mergedCompetitors.length > 0
    ? ` and its competitors (${mergedCompetitors.join(", ")})`
    : "";

  const systemPrompt = `You are a search engine assistant (like ChatGPT Search, Perplexity, or Gemini Search) with access to real-time search results and web indices.
To answer the user's query, you must utilize the following search engine index records and grounding context:

${groundingContext}

Instructions:
1. Provide a comprehensive, detailed, and realistic response to the search query.
2. Integrate citations, links, or mentions of the brand (${brandNameGround})${competitorInstruction} where relevant to the user query, as a search engine would.
3. Be objective. Cite specific tools, products, companies, and brand names where appropriate.
4. Maintain a natural, authoritative search engine synthesis tone.`;

  // Create tasks list representing prompt x model combinations
  const tasks: Array<{
    prompt: { id: string; prompt: string; topic: string };
    modelKey: string;
  }> = [];

  for (const prompt of prompts as Array<{ id: string; prompt: string; topic: string }>) {
    for (const modelKey of models) {
      if (MODEL_MAP[modelKey]) {
        tasks.push({ prompt, modelKey });
      } else {
        console.warn(`[PromptScanWorker] Unknown model: ${modelKey}, skipping`);
      }
    }
  }

  const totalOps = tasks.length;
  if (totalOps === 0) {
    throw new Error("No valid models to scan.");
  }

  // ── 2. Create or reuse scan_run record ──────────────────────────────────────
  let runId = run_id;
  if (!runId) {
    const { data, error } = await supabase
      .from("prompt_scan_runs")
      .insert({
        project_id, brand_name, models,
        status: "running", total_prompts: totalOps, completed: 0,
      })
      .select("id").single();
    if (error) throw error;
    runId = data.id as string;
  } else {
    await supabase.from("prompt_scan_runs")
      .update({ status: "running", total_prompts: totalOps })
      .eq("id", runId);
  }

  await job.updateProgress(5);

  // ── 3. Run prompt x model tasks in parallel with controlled concurrency ─────
  let completed = 0;
  let brandMentionedCount = 0;
  const fanoutsDone = new Set<string>();

  // Throttled database progress updater to avoid write contention and race conditions
  let lastUpdate = 0;
  let updatePromise: Promise<void> = Promise.resolve();
  let updateTimeout: NodeJS.Timeout | null = null;

  const saveRunProgress = async (force = false) => {
    const runUpdate = async () => {
      const snapCompleted = completed;
      const snapBrand = brandMentionedCount;
      await supabase.from("prompt_scan_runs")
        .update({ completed: snapCompleted, brand_mentioned_count: snapBrand })
        .eq("id", runId);
    };

    if (force || completed === totalOps) {
      if (updateTimeout) clearTimeout(updateTimeout);
      updatePromise = updatePromise.then(runUpdate).catch(e => console.error("Error saving progress final:", e));
      return updatePromise;
    }

    const now = Date.now();
    if (now - lastUpdate > 1000) {
      lastUpdate = now;
      updatePromise = updatePromise.then(runUpdate).catch(e => console.error("Error saving progress:", e));
    } else if (!updateTimeout) {
      updateTimeout = setTimeout(() => {
        updateTimeout = null;
        lastUpdate = Date.now();
        updatePromise = updatePromise.then(runUpdate).catch(e => console.error("Error saving progress deferred:", e));
      }, 1000);
    }
  };

  const perplexityCache = new Map<string, { text: string; latencyMs: number }>();
  const perplexityLock = new Map<string, Promise<{ text: string; latencyMs: number }>>();

  const getPerplexityGrounding = async (promptId: string, promptText: string) => {
    if (perplexityCache.has(promptId)) {
      return perplexityCache.get(promptId)!;
    }
    if (perplexityLock.has(promptId)) {
      return perplexityLock.get(promptId)!;
    }

    const searchPromise = (async () => {
      console.log(`[PromptScanWorker] Querying Perplexity Sonar for live search grounding: "${promptText.slice(0, 50)}…"`);
      try {
        const searchSysPrompt = `You are a real-time search engine query synthesizer. Provide a detailed summary of live web search results, top sources, links, comparison of brands, and a list of competitor brands visible on the web for this query. Be objective and cite real websites.`;
        const res = await queryModel("perplexity", promptText, searchSysPrompt);
        perplexityCache.set(promptId, res);
        return res;
      } catch (err) {
        console.error(`[PromptScanWorker] Failed to query Perplexity Sonar grounding context for "${promptText}":`, err);
        const fallback = { text: "No live search context available due to lookup timeout or error.", latencyMs: 0 };
        perplexityCache.set(promptId, fallback);
        return fallback;
      }
    })();

    perplexityLock.set(promptId, searchPromise);
    return searchPromise;
  };

  const CONCURRENCY_LIMIT = 4;
  let taskIndex = 0;

  const runTask = async (task: typeof tasks[0]) => {
    const { prompt, modelKey } = task;
    let responseText = "";
    let latencyMs    = 0;
    let status       = "success";
    let errorMessage: string | null = null;

    try {
      let res;
      if (modelKey === "perplexity") {
        res = await getPerplexityGrounding(prompt.id, prompt.prompt);
      } else {
        const searchCtx = await getPerplexityGrounding(prompt.id, prompt.prompt);
        const enrichedSystemPrompt = `You are a search engine assistant (like ChatGPT Search, Gemini Search, or Perplexity Search) with access to real-time search results and web indices.
To answer the user's query, you must utilize the following real-time search engine results and website index records:

Real-time Search Engine Results (Context from live web search):
${searchCtx.text}

Website index records of the target brand (${brandNameGround}):
${groundingContext}

Instructions:
1. Provide a comprehensive, detailed response synthesizing the query.
2. Integrate citations, links, or mentions of the brand (${brandNameGround})${competitorInstruction} where relevant based on the search engine results context and index records.
3. Be objective. Cite specific tools, products, companies, and brand names where appropriate.
4. Maintain a natural, authoritative search engine synthesis tone.`;

        console.log(`[PromptScanWorker] Querying model: ${modelKey} for prompt "${prompt.prompt.slice(0, 50)}…"`);
        res = await queryModel(modelKey, prompt.prompt, enrichedSystemPrompt);
      }

      responseText = res.text;
      latencyMs    = res.latencyMs;
    } catch (e) {
      status       = "error";
      errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`[PromptScanWorker] Model query error [${modelKey}]: ${errorMessage}`);
    }

    const citations = parseCitations(responseText, brand_name, mergedCompetitors, brandDomainGround);
    if (citations.brandMentioned) {
      brandMentionedCount++;
    }

    // Save result
    await supabase.from("prompt_scan_results").insert({
      project_id,
      prompt_id:            prompt.id,
      prompt_text:          prompt.prompt,
      model:                modelKey,
      response_text:        responseText,
      brand_mentioned:      citations.brandMentioned,
      mention_position:     citations.mentionPosition,
      mention_context:      citations.mentionContext,
      mention_sentiment:    citations.mentionSentiment,
      mention_count:        citations.mentionCount,
      competitors_mentioned:citations.competitorsMentioned,
      status,
      error_message:        errorMessage,
      latency_ms:           latencyMs,
    });

    // Parse and save all cited links/domains in the response text as individual citations
    const extCitations = extractCitationsFromText(responseText);
    const citationRows: any[] = [];

    // Add general parsed citations
    extCitations.forEach((c, idx) => {
      citationRows.push({
        project_id,
        provider:    modelKey,
        query:       prompt.prompt,
        cited_title: c.title,
        position:    idx + 1,
        metadata: {
          url:       c.url,
          run_id:    runId,
          source:    "prompt_scan_worker",
        },
      });
    });

    // Also guarantee brand mention is logged if not explicitly caught in markdown links
    const brandClean = brand_name.toLowerCase().trim();
    const hasBrandRow = extCitations.some(c => 
      c.title.toLowerCase().includes(brandClean) || 
      c.url.toLowerCase().includes(brandClean) ||
      (brandDomainGround && c.url.toLowerCase().includes(brandDomainGround.toLowerCase()))
    );

    if (citations.brandMentioned && !hasBrandRow) {
      citationRows.push({
        project_id,
        provider:    modelKey,
        query:       prompt.prompt,
        cited_title: brand_name,
        position:    citations.mentionPosition ?? 1,
        metadata: {
          url:       brandDomainGround ? (brandDomainGround.startsWith("http") ? brandDomainGround : `https://${brandDomainGround}`) : "",
          context:   citations.mentionContext,
          sentiment: citations.mentionSentiment,
          run_id:    runId,
          source:    "prompt_scan_worker",
        },
      });
    }

    if (citationRows.length > 0) {
      const { error: citErr } = await supabase.from("aeo_citations").insert(citationRows);
      if (citErr) {
        console.warn(`[PromptScanWorker] Failed to insert citations: ${citErr.message}`);
      }
    }

    // Fanout generation — once per prompt, fire-and-forget in background
    if (!fanoutsDone.has(prompt.id)) {
      fanoutsDone.add(prompt.id);
      generateFanouts(project_id, runId!, prompt.prompt, brand_name).catch(e =>
        console.warn(`[PromptScanWorker] Fanout generation failed silently: ${e?.message}`),
      );
    }

    completed++;
    const pct = 5 + Math.round((completed / totalOps) * 80);
    await job.updateProgress(pct).catch(() => {});
    await saveRunProgress();

    // Spacing back-off (100ms) to reduce immediate API rate pressure
    await new Promise(r => setTimeout(r, 100));
  };


  const worker = async () => {
    while (taskIndex < tasks.length) {
      const curIndex = taskIndex++;
      const task = tasks[curIndex];
      await runTask(task);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, tasks.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  await saveRunProgress(true);

  // ── 4. Mark complete ─────────────────────────────────────────────────────────
  await supabase.from("prompt_scan_runs").update({
    status: "done",
    completed,
    brand_mentioned_count: brandMentionedCount,
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  await job.updateProgress(90);

  // ── 5. Persist gap analysis (after run is marked done) ───────────────────────
  const { gaps_upserted } = await persistGapsForRun(project_id, runId!, brand_name).catch(e => {
    console.warn(`[PromptScanWorker] Gap persistence failed silently: ${e?.message}`);
    return { gaps_upserted: 0 };
  });

  // Recompute overall visibility / GEO score immediately based on the scan results
  try {
    console.log(`[PromptScanWorker] Scan complete. Triggering ScoringWorker for project ${project_id}...`);
    await scoringQueue.add(
      "score",
      { project_id, brand_name },
      { jobId: `score-scan-${project_id}-${runId}-${Date.now()}` }
    );
  } catch (scoreErr) {
    console.error(`[PromptScanWorker] Failed to enqueue scoring job:`, scoreErr);
  }

  await job.updateProgress(100);

  const mentionRate = totalOps > 0 ? Math.round((brandMentionedCount / completed) * 100) : 0;
  const summary = {
    run_id: runId, prompts_scanned: prompts.length,
    total_queries: completed, brand_mentioned: brandMentionedCount,
    mention_rate_pct: mentionRate, gaps_upserted,
  };
  console.log(`[PromptScanWorker] Done:`, summary);
  return summary;
}

export function startPromptScanWorker() {
  const worker = new Worker<PromptScanJobData>(
    "prompt-scan",
    processPromptScanJob,
    { connection: redis as any, concurrency: 1 } // serial — AI calls are expensive
  );

  worker.on("completed", (job) => console.log(`[PromptScanWorker] ✅ Job ${job.id} done`));
  worker.on("failed", async (job, err) => {
    console.error(`[PromptScanWorker] ❌ Job ${job?.id} failed: ${err.message}`);
    if (job?.data?.run_id) {
      await supabase.from("prompt_scan_runs")
        .update({ status: "failed", error: err.message, finished_at: new Date().toISOString() })
        .eq("id", job.data.run_id);
    }
  });
  worker.on("error", (err) => console.error("[PromptScanWorker] Worker error:", err));

  console.log("🤖 PromptScanWorker started (concurrency: 1)");
  return worker;
}
