import { createClient } from "npm:@supabase/supabase-js@2";
import {
  S3Client,
  DeleteObjectCommand,
} from "npm:@aws-sdk/client-s3@3.726.1";

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
    new_storage_path: string;
    new_thumbnail_path: string;
    duration?: number;
    recorded_at?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { media_id, new_storage_path, new_thumbnail_path, duration, recorded_at } = body;

  if (!media_id || !new_storage_path || !new_thumbnail_path) {
    return new Response(JSON.stringify({ error: "media_id, new_storage_path, and new_thumbnail_path are required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Read current storage_path and thumbnail_path
  const { data: existing, error: fetchError } = await supabase
    .from("media")
    .select("storage_path, thumbnail_path")
    .eq("id", media_id)
    .single();

  if (fetchError || !existing) {
    return new Response(JSON.stringify({ error: "Media not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const oldStoragePath = existing.storage_path;
  const oldThumbnailPath = existing.thumbnail_path;

  // Update media row with new paths
  const { error: updateError } = await supabase
    .from("media")
    .update({
      storage_path: new_storage_path,
      thumbnail_path: new_thumbnail_path,
      duration: duration ?? null,
      recorded_at: recorded_at ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", media_id);

  if (updateError) {
    return new Response(JSON.stringify({ error: "Failed to update media record", details: updateError.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Delete old files from R2
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
    },
  });

  const bucketName = Deno.env.get("R2_BUCKET_NAME")!;

  const deleteOps: Promise<unknown>[] = [
    r2.send(new DeleteObjectCommand({ Bucket: bucketName, Key: oldStoragePath })),
  ];
  if (oldThumbnailPath) {
    deleteOps.push(
      r2.send(new DeleteObjectCommand({ Bucket: bucketName, Key: oldThumbnailPath }))
    );
  }

  // Best-effort deletions — don't fail the request if R2 cleanup fails
  await Promise.allSettled(deleteOps);

  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
});
