import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.726.1";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.726.1";
import { readMoovMetadata, MOOV_FETCH_LIMIT } from "../_shared/mp4Date.ts";
import type { ByteReader } from "../_shared/mp4Date.ts";
import { fromVenueDatetimeLocal } from "../_shared/venueTime.ts";

// Authoritative recording-date extraction.
//
// The browser cannot do this job. 318 of 404 library files place `moov` at the
// end of the file, so reading it means reaching hundreds of megabytes in — over
// cellular, from a phone, for a file the server already has. Here it costs
// three to five range requests and about 88KB.
//
// The parsing itself is shared verbatim with the browser (../_shared/mp4Date.ts)
// so the two cannot disagree; this function only supplies bytes and policy.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization token" }, 401);
    }
    const token = authHeader.slice(7);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired token" }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("roles(upload_media)")
      .eq("id", user.id)
      .single();
    // deno-lint-ignore no-explicit-any
    if (profileError || !(profile?.roles as any)?.upload_media) {
      return json({ error: "Insufficient permissions" }, 403);
    }

    let body: { media_id?: string; force?: boolean };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const { media_id, force } = body;
    if (!media_id) return json({ error: "media_id is required" }, 400);

    const { data: media, error: fetchError } = await supabase
      .from("media")
      .select("storage_path, file_size_bytes, original_filename, duration, recorded_at_source")
      .eq("id", media_id)
      .single();
    if (fetchError || !media) return json({ error: "Media not found" }, 404);

    // A human's correction outranks anything a container says. The backfill
    // relies on this too, so the rule lives here rather than in each caller.
    if (media.recorded_at_source === "manual" && !force) {
      return json({ skipped: "manual", recorded_at_source: "manual" }, 200);
    }
    if (!media.storage_path) {
      return json({ skipped: "no_storage_path" }, 200);
    }

    // Presign once, then range-fetch against that URL. Streaming an SDK
    // GetObject body through Deno's node-compat layer is the kind of thing that
    // produced the 502s in commit 3e44377; a plain fetch has no such surface.
    const r2 = new S3Client({
      region: "auto",
      endpoint: `https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
      },
    });
    const signedUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: Deno.env.get("R2_BUCKET_NAME")!,
        Key: media.storage_path,
      }),
      { expiresIn: 300 },
    );

    let fileSize = media.file_size_bytes as number | null;
    if (!fileSize) {
      const head = await fetch(signedUrl, { method: "HEAD" });
      if (!head.ok) return json({ error: "Object not readable", status: head.status }, 502);
      fileSize = Number(head.headers.get("content-length") ?? 0);
    }
    if (!fileSize) return json({ error: "Unknown object size" }, 502);

    let requests = 0;
    let bytesRead = 0;
    const read: ByteReader = async (start, endInclusive) => {
      requests++;
      const res = await fetch(signedUrl, { headers: { Range: `bytes=${start}-${endInclusive}` } });
      if (!res.ok && res.status !== 206) {
        throw new Error(`Range request failed: ${res.status}`);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      bytesRead += buf.length;
      return buf;
    };

    const { date, duration } = await readMoovMetadata(read, fileSize, {
      wallClockToInstant: fromVenueDatetimeLocal,
      filename: media.original_filename ?? undefined,
    });

    const updates: Record<string, unknown> = {
      recorded_at_source: date.source,
      recorded_at_precision: date.precision,
      recorded_at_offset_minutes: date.offsetMinutes,
      updated_at: new Date().toISOString(),
    };
    // Only write recorded_at when we actually found one — a failed read must not
    // erase an existing value.
    if (date.instant) updates.recorded_at = date.instant;
    // Duration is a free by-product of the same read, but never overwrite a
    // known value with a guess.
    if (duration != null && media.duration == null) updates.duration = duration;

    const { error: updateError } = await supabase
      .from("media")
      .update(updates)
      .eq("id", media_id);
    if (updateError) {
      return json({ error: "Failed to update media", details: updateError.message }, 500);
    }

    return json(
      {
        media_id,
        recorded_at: date.instant,
        recorded_at_source: date.source,
        recorded_at_offset_minutes: date.offsetMinutes,
        recorded_at_precision: date.precision,
        duration: updates.duration ?? media.duration,
        stats: { requests, bytes_read: bytesRead, moov_fetch_limit: MOOV_FETCH_LIMIT },
      },
      200,
    );
  } catch (err) {
    console.error("extract-recorded-at error:", err);
    return json({ error: "Unexpected error", details: String(err) }, 500);
  }
});
