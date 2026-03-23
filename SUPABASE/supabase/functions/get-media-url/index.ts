import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  S3Client,
  GetObjectCommand,
} from "https://esm.sh/@aws-sdk/client-s3@3";
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
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

  // Check view_media permission
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("roles(view_media)")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.roles?.view_media) {
    return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Get media_id from query string
  const url = new URL(req.url);
  const mediaId = url.searchParams.get("media_id");
  if (!mediaId) {
    return new Response(JSON.stringify({ error: "media_id query parameter is required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Look up storage_path for the given media_id
  const { data: media, error: mediaError } = await supabase
    .from("media")
    .select("storage_path")
    .eq("id", mediaId)
    .single();

  if (mediaError || !media) {
    return new Response(JSON.stringify({ error: "Media not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Images have no video file — return null url so the client can skip the player
  if (!media.storage_path) {
    return new Response(
      JSON.stringify({ url: null, expires_in: 0 }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Build R2 S3 client
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
    },
  });

  const expiresIn = 3600; // 1 hour

  const signedUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: Deno.env.get("R2_BUCKET_NAME")!,
      Key: media.storage_path,
    }),
    { expiresIn }
  );

  return new Response(
    JSON.stringify({ url: signedUrl, expires_in: expiresIn }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
});
