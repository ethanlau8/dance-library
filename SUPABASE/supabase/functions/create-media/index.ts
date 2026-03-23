import { createClient } from "npm:@supabase/supabase-js@2";

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

  // Check upload_media permission
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("roles(upload_media)")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.roles?.upload_media) {
    return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: {
    title: string;
    description?: string;
    media_type: string;
    storage_path: string;
    thumbnail_path?: string;
    duration?: number;
    recorded_at?: string | null;
    tag_ids?: string[];
    original_filename?: string;
    file_size_bytes?: number;
    mime_type?: string;
    resolution?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { title, description, media_type, storage_path, thumbnail_path, duration, recorded_at, tag_ids, original_filename, file_size_bytes, mime_type, resolution } = body;

  if (!title || !media_type) {
    return new Response(JSON.stringify({ error: "title and media_type are required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Insert media row
  const { data: media, error: mediaError } = await supabase
    .from("media")
    .insert({
      title,
      description: description ?? null,
      media_type,
      storage_path,
      thumbnail_path: thumbnail_path ?? null,
      duration: duration ?? null,
      recorded_at: recorded_at ?? null,
      original_filename: original_filename ?? null,
      file_size_bytes: file_size_bytes ?? null,
      mime_type: mime_type ?? null,
      resolution: resolution ?? null,
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  if (mediaError || !media) {
    return new Response(JSON.stringify({ error: "Failed to create media record", details: mediaError?.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Insert media_tags for each tag_id (video-level, no timestamps)
  if (tag_ids && tag_ids.length > 0) {
    const mediaTagRows = tag_ids.map((tag_id) => ({
      media_id: media.id,
      tag_id,
      created_by: user.id,
    }));

    const { error: tagsError } = await supabase.from("media_tags").insert(mediaTagRows);
    if (tagsError) {
      return new Response(JSON.stringify({ error: "Media created but failed to apply tags", details: tagsError.message }), {
        status: 207,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(
    JSON.stringify({ media_id: media.id }),
    {
      status: 201,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
});
