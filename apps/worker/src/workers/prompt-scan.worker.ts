import { Worker, Job } from "bullmq";
import { redis } from "../config.js";
import { supabase } from "../lib/supabase.js";
import { queryModel, MODEL_MAP } from "../lib/openrouter.js";
import { parseCitations } from "../lib/citation-parser.js";
import { generateFanouts } from "../lib/fanout-generator.js";
import { persistGapsForRun } from "../lib/gap-detector.js";
import type { PromptScanJobData } from "../queues.js";

async function processPromptScanJob(job: Job<PromptScanJobData>): Promise<object> {
  const {
    project_id, brand_name,
    models = ["chatgpt", "gemini", "perplexity", "claude"],
    competitors = [],
    prompt_ids = null,
    run_id,
  } = job.data;

  // Merge default competitors to guarantee they are always tracked in scans
  const defaultCompetitors = ["sitefire.ai", "higoodie.com", "scrunch.com"];
  const mergedCompetitors = Array.from(new Set([
    ...competitors.map((c: string) => c.toLowerCase().trim()),
    ...defaultCompetitors
  ])).filter(Boolean);

  console.log(`[PromptScanWorker] Job ${job.id} — project=${project_id} models=${models.join(",")} competitors=${mergedCompetitors.join(",")}`);

  // ── 1. Load prompts ─────────────────────────────────────────────────────────
  let query = supabase
    .from("aeo_prompts")
    .select("id, prompt, topic")
    .eq("project_id", project_id)
    .eq("is_active", true);

  if (prompt_ids && prompt_ids.length > 0) query = query.in("id", prompt_ids);

  const { data: prompts, error: promptsErr } = await query.limit(20);
  if (promptsErr) throw promptsErr;
  if (!prompts || prompts.length === 0) {
    throw new Error("No active prompts found. Add prompts in the Prompt Lab tab first.");
  }

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

  const CONCURRENCY_LIMIT = 4;
  let taskIndex = 0;

  const runTask = async (task: typeof tasks[0]) => {
    const { prompt, modelKey } = task;
    let responseText = "";
    let latencyMs    = 0;
    let status       = "success";
    let errorMessage: string | null = null;

    try {
      console.log(`[PromptScanWorker] Querying model: ${modelKey} for prompt "${prompt.prompt.slice(0, 50)}…"`);
      const res = await queryModel(modelKey, prompt.prompt);
      responseText = res.text;
      latencyMs    = res.latencyMs;
    } catch (e) {
      status       = "error";
      errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`[PromptScanWorker] Model query error [${modelKey}]: ${errorMessage}`);
    }

    const citations = parseCitations(responseText, brand_name, mergedCompetitors);
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

    // Back-fill aeo_citations for backward compatibility
    if (citations.brandMentioned) {
      await supabase.from("aeo_citations").insert({
        project_id,
        provider:    modelKey,
        query:       prompt.prompt,
        cited_title: brand_name,
        position:    citations.mentionPosition,
        metadata: {
          context:   citations.mentionContext,
          sentiment: citations.mentionSentiment,
          run_id:    runId,
          source:    "prompt_scan_worker",
        },
      });
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
