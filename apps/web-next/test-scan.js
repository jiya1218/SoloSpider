import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fsfmnolrzznxufbbadha.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testScan() {
  console.log("Supabase URL:", supabaseUrl);

  try {
    // 1. Fetch latest prompt scan run
    const { data: runs, error: rError } = await supabase
      .from("prompt_scan_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (rError) {
      console.error("❌ Prompt Scan Runs Error:", rError);
    } else {
      console.log("✅ Latest Prompt Scan Runs:");
      console.log(runs);
    }

    // 2. Fetch results count
    const { count, error: cError } = await supabase
      .from("prompt_scan_results")
      .select("*", { count: 'exact', head: true });

    if (cError) {
      console.error("❌ Prompt Scan Results Count Error:", cError);
    } else {
      console.log(`✅ Total Prompt Scan Results in DB: ${count}`);
    }

    // 3. Fetch latest 5 results
    const { data: results, error: resError } = await supabase
      .from("prompt_scan_results")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(5);

    if (resError) {
      console.error("❌ Prompt Scan Results Fetch Error:", resError);
    } else {
      console.log("✅ Latest 5 Prompt Scan Results:");
      console.log(results);
    }

  } catch (err) {
    console.error("Diagnostic failed:", err);
  }
}

testScan();
