import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  S3Client,
  PutObjectCommand,
} from "https://esm.sh/@aws-sdk/client-s3@3";
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3";

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
  let body: { filename: string; content_type: string; type: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { filename, content_type } = body;
  if (!filename || !content_type) {
    return new Response(JSON.stringify({ error: "filename and content_type are required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Generate unique storage keys
  const uuid = crypto.randomUUID();
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  const mediaStoragePath = `videos/${uuid}.${ext}`;
  const thumbnailStoragePath = `thumbs/${uuid}.webp`;

  // Build R2 S3 client
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
    },
  });

  const bucketName = Deno.env.get("R2_BUCKET_NAME")!;
  const expiresIn = 900; // 15 minutes

  // Generate presigned PUT URL for media
  const mediaUploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: bucketName,
      Key: mediaStoragePath,
      ContentType: content_type,
    }),
    { expiresIn }
  );

  // Generate presigned PUT URL for thumbnail
  const thumbnailUploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: bucketName,
      Key: thumbnailStoragePath,
      ContentType: "image/webp",
    }),
    { expiresIn }
  );

  return new Response(
    JSON.stringify({
      media_upload_url: mediaUploadUrl,
      media_storage_path: mediaStoragePath,
      thumbnail_upload_url: thumbnailUploadUrl,
      thumbnail_storage_path: thumbnailStoragePath,
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
});
