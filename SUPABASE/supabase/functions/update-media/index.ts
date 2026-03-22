import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Extract and verify JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing authorization token" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.slice(7);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Verify the JWT and get the user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Check edit_metadata permission
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("roles(edit_metadata)")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.roles?.edit_metadata) {
    return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: {
    media_id: string;
    metadata?: {
      title?: string;
      description?: string | null;
      recorded_at?: string | null;
    };
    tags?: {
      added: string[];
      removed: string[];
    };
    timestamps?: {
      added: Array<{ tag_id: string; start_time: number; end_time: number | null }>;
      modified: Array<{ id: string; tag_id: string; start_time: number; end_time: number | null }>;
      removed: string[];
    };
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { media_id, metadata, tags, timestamps } = body;

  if (!media_id) {
    return new Response(JSON.stringify({ error: "media_id is required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // 1. Update media metadata
  if (metadata) {
    const updates: Record<string, unknown> = {};
    if (metadata.title !== undefined) updates.title = metadata.title;
    if (metadata.description !== undefined) updates.description = metadata.description;
    if (metadata.recorded_at !== undefined) updates.recorded_at = metadata.recorded_at;
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase.from("media").update(updates).eq("id", media_id);
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to update media", details: error.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }
  }

  // 2. Remove video-level tags
  if (tags?.removed?.length) {
    const { error } = await supabase
      .from("media_tags")
      .delete()
      .eq("media_id", media_id)
      .in("tag_id", tags.removed)
      .is("start_time", null);
    if (error) {
      return new Response(JSON.stringify({ error: "Failed to remove tags", details: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  // 3. Add video-level tags
  if (tags?.added?.length) {
    const rows = tags.added.map((tag_id) => ({
      media_id,
      tag_id,
      created_by: user.id,
    }));
    const { error } = await supabase.from("media_tags").insert(rows);
    if (error) {
      return new Response(JSON.stringify({ error: "Failed to add tags", details: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  // 4. Remove timestamps
  if (timestamps?.removed?.length) {
    const { error } = await supabase
      .from("media_tags")
      .delete()
      .in("id", timestamps.removed);
    if (error) {
      return new Response(JSON.stringify({ error: "Failed to remove timestamps", details: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  // 5. Add new timestamps
  if (timestamps?.added?.length) {
    const rows = timestamps.added.map((ts) => ({
      media_id,
      tag_id: ts.tag_id,
      start_time: ts.start_time,
      end_time: ts.end_time,
      created_by: user.id,
    }));
    const { error } = await supabase.from("media_tags").insert(rows);
    if (error) {
      return new Response(JSON.stringify({ error: "Failed to add timestamps", details: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  // 6. Update modified timestamps
  if (timestamps?.modified?.length) {
    for (const ts of timestamps.modified) {
      const { error } = await supabase
        .from("media_tags")
        .update({
          tag_id: ts.tag_id,
          start_time: ts.start_time,
          end_time: ts.end_time,
        })
        .eq("id", ts.id);
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to update timestamp", details: error.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }
  }

  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
});
