import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fsfmnolrzznxufbbadha.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testPrompts() {
  try {
    const { data: prompts, error } = await supabase
      .from("aeo_prompts")
      .select("*")
      .eq("project_id", "5bfaa079-3bdb-4cea-85fc-526f460f1976");

    if (error) {
      console.error("Error fetching prompts:", error);
    } else {
      console.log(`Prompts found in database for project 5bfaa079-3bdb-4cea-85fc-526f460f1976: ${prompts.length}`);
      console.log(prompts);
    }
  } catch (err) {
    console.error("Failed:", err);
  }
}

testPrompts();
