import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/server/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const PublishWPSchema = z.object({
  contentId: z.string().uuid(),
  integrationId: z.string().uuid(),
  publishStatus: z.enum(["draft", "publish"]).optional().default("draft"),
  categories: z.array(z.number()).optional(),
  authorId: z.number().optional(),
  canonicalUrl: z.string().optional(),
});

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    {
      auth: { persistSession: false },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const parsed = PublishWPSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { contentId, integrationId, publishStatus, categories, authorId } = parsed.data;
    const supabase = getSupabaseAdmin();

    // 1. Fetch integration details
    const { data: integration, error: intErr } = await supabase
      .from("workspace_integrations")
      .select("*")
      .eq("id", integrationId)
      .single();

    if (intErr || !integration) {
      return NextResponse.json({ error: "WordPress integration details not found" }, { status: 404 });
    }

    // 2. Fetch blog content details
    const { data: content, error: contentErr } = await supabase
      .from("content_items")
      .select("*")
      .eq("id", contentId)
      .single();

    if (contentErr || !content) {
      return NextResponse.json({ error: "Blog content item not found" }, { status: 404 });
    }

    const credentials = integration.credentials as any;
    const cleanUrl = credentials.siteUrl.replace(/\/$/, "");
    const authString = Buffer.from(`${credentials.username}:${credentials.appPassword}`).toString("base64");

    // 3. Post to WordPress REST API
    const wpPayload = {
      title: content.generated_title || content.h1,
      content: content.generated_content || "",
      status: publishStatus,
      categories: categories || undefined,
      author: authorId || undefined,
    };

    console.log(`[PublishToWP] Sending request to WordPress: ${cleanUrl}/wp-json/wp/v2/posts`);

    const wpResponse = await fetch(`${cleanUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authString}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(wpPayload),
    });

    const wpData = await wpResponse.json();

    if (!wpResponse.ok) {
      console.error("[PublishToWP] WordPress REST API error:", wpData);
      throw new Error(wpData?.message || `WordPress returned status ${wpResponse.status}`);
    }

    // 4. Update status in database
    const { error: updateErr } = await supabase
      .from("content_items")
      .update({
        status: "published",
      })
      .eq("id", contentId);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true, wpPostId: wpData.id, link: wpData.link });
  } catch (error: any) {
    console.error("[PublishToWP] Error publishing to WordPress:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
