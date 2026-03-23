import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  S3Client,
  DeleteObjectCommand,
} from "https://esm.sh/@aws-sdk/client-s3@3";

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

  // Check permissions: user owns the media OR has delete_media permission
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("roles(delete_media)")
    .eq("id", user.id)
    .single();

  const hasDeletePermission = !profileError && profile?.roles?.delete_media;

  // Parse request body
  let body: { media_id: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { media_id } = body;

  if (!media_id) {
    return new Response(JSON.stringify({ error: "media_id is required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Fetch the media record
  const { data: media, error: fetchError } = await supabase
    .from("media")
    .select("storage_path, thumbnail_path, uploaded_by")
    .eq("id", media_id)
    .single();

  if (fetchError || !media) {
    return new Response(JSON.stringify({ error: "Media not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Authorize: must own the media or have delete_media permission
  if (media.uploaded_by !== user.id && !hasDeletePermission) {
    return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Delete R2 objects (best-effort)
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
    },
  });

  const bucketName = Deno.env.get("R2_BUCKET_NAME")!;

  const deleteOps: Promise<unknown>[] = [];
  if (media.storage_path) {
    deleteOps.push(
      r2.send(new DeleteObjectCommand({ Bucket: bucketName, Key: media.storage_path }))
    );
  }
  if (media.thumbnail_path) {
    deleteOps.push(
      r2.send(new DeleteObjectCommand({ Bucket: bucketName, Key: media.thumbnail_path }))
    );
  }

  await Promise.allSettled(deleteOps);

  // Delete the database record (cascades to media_tags, watch_progress)
  const { error: deleteError } = await supabase
    .from("media")
    .delete()
    .eq("id", media_id);

  if (deleteError) {
    return new Response(JSON.stringify({ error: "Failed to delete media record", details: deleteError.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
});
