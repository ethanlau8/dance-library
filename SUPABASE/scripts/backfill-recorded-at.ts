#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-sys --node-modules-dir=none
//
// Backfill recorded_at and its provenance from the video files themselves.
//
//   deno run -A --node-modules-dir=none backfill-recorded-at.ts            # dry run
//   deno run -A --node-modules-dir=none backfill-recorded-at.ts --apply    # writes
//
// Deliberately a Deno script rather than a notebook. The previous backfill was
// a notebook, and its saved report — 359 rows whose ids match nothing in the
// current library — is now unreadable as a record of what it did. This reads
// the same shared parser the edge function runs, so the backfill and live
// uploads cannot reach different conclusions about the same file.
//
// Every run writes a report and, when applying, an undo script.

import { readMoovMetadata } from "../supabase/functions/_shared/mp4Date.ts";
import type { ByteReader } from "../supabase/functions/_shared/mp4Date.ts";
import { fromVenueDatetimeLocal } from "../supabase/functions/_shared/venueTime.ts";
import { classifyDrift } from "../supabase/functions/_shared/driftSignature.ts";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.726.1";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.726.1";

const APPLY = Deno.args.includes("--apply");
// Quarantined rows are withheld by default: their gap fits no known defect,
// so a human should look first. Pass this once that review has happened.
const INCLUDE_QUARANTINE = Deno.args.includes("--include-quarantine");
const CONCURRENCY = 12;

type Action =
  | "already_correct"
  | "fill_null"
  | "correct_drift"
  | "QUARANTINE"
  | "no_date_in_file"
  | "skip_manual"
  | "skip_no_object"
  | "error";

interface Row {
  id: string;
  title: string;
  original_filename: string | null;
  storage_path: string | null;
  file_size_bytes: number | null;
  recorded_at: string | null;
  recorded_at_source: string | null;
  recorded_at_offset_minutes: number | null;
  recorded_at_precision: string | null;
  duration: number | null;
}

interface Result extends Row {
  action: Action;
  extracted?: string | null;
  newSource?: string;
  newOffset?: number | null;
  newPrecision?: string;
  deltaHours?: number | null;
  saves?: number | null;
  newDuration?: number | null;
  note?: string;
}

// ─── config ─────────────────────────────────────────────────────────────────

const envText = await Deno.readTextFile(new URL("../../.env", import.meta.url));
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t.slice(i + 1).split("#")[0].trim();
}
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

// ─── load ───────────────────────────────────────────────────────────────────

const SELECT =
  "id,title,original_filename,storage_path,file_size_bytes,recorded_at," +
  "recorded_at_source,recorded_at_offset_minutes,recorded_at_precision,duration";

const rows: Row[] = [];
for (let offset = 0; ; offset += 1000) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/media?select=${SELECT}&limit=1000&offset=${offset}`,
    { headers: H },
  );
  const page = await res.json();
  rows.push(...page);
  if (page.length < 1000) break;
}
console.log(`Loaded ${rows.length} media records.`);

// ─── examine ────────────────────────────────────────────────────────────────

async function examine(row: Row): Promise<Result> {
  if (!row.storage_path) return { ...row, action: "skip_no_object" };
  // A human's correction outranks the container. Same rule the edge function
  // enforces; repeated here so the backfill cannot bypass it.
  if (row.recorded_at_source === "manual") return { ...row, action: "skip_manual" };

  try {
    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: row.storage_path }),
      { expiresIn: 3600 },
    );
    const read: ByteReader = async (start, endInclusive) => {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${endInclusive}` } });
      if (!res.ok && res.status !== 206) throw new Error(`range ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    };

    const size = row.file_size_bytes ?? 0;
    if (!size) return { ...row, action: "error", note: "unknown file size" };

    const { date, duration } = await readMoovMetadata(read, size, {
      wallClockToInstant: fromVenueDatetimeLocal,
      filename: row.original_filename ?? undefined,
    });

    const newDuration = duration != null && row.duration == null ? duration : null;
    if (!date.instant) {
      return { ...row, action: "no_date_in_file", newSource: date.source, newPrecision: date.precision, newDuration };
    }

    const base = {
      ...row,
      extracted: date.instant,
      newSource: date.source,
      newOffset: date.offsetMinutes,
      newPrecision: date.precision,
      newDuration,
    };

    if (row.recorded_at === null) return { ...base, action: "fill_null", deltaHours: null };

    const stored = new Date(row.recorded_at);
    const actual = new Date(date.instant);
    const deltaHours = (stored.getTime() - actual.getTime()) / 3_600_000;
    if (Math.abs(deltaHours) < 0.0003) return { ...base, action: "already_correct", deltaHours };

    const verdict = classifyDrift(stored, actual);
    return verdict.isDrift
      ? { ...base, action: "correct_drift", deltaHours, saves: verdict.saves }
      : { ...base, action: "QUARANTINE", deltaHours };
  } catch (e) {
    return { ...row, action: "error", note: String(e).slice(0, 80) };
  }
}

const started = Date.now();
const results: Result[] = [];
for (let i = 0; i < rows.length; i += CONCURRENCY) {
  results.push(...await Promise.all(rows.slice(i, i + CONCURRENCY).map(examine)));
  if (i % 100 === 0) console.log(`  examined ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}`);
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

// ─── report ─────────────────────────────────────────────────────────────────

const counts: Record<string, number> = {};
for (const r of results) counts[r.action] = (counts[r.action] ?? 0) + 1;

console.log(`\n${"=".repeat(70)}`);
console.log(`${APPLY ? "APPLY" : "DRY RUN"}${INCLUDE_QUARANTINE ? " (+quarantine)" : ""} — ${results.length} records in ${elapsed}s`);
console.log("=".repeat(70));
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}`);
}
console.log(`\n  real UTC offsets recovered: ${results.filter((r) => r.newOffset != null).length}`);
console.log(`  durations to fill:          ${results.filter((r) => r.newDuration != null).length}`);

const quarantined = results.filter((r) => r.action === "QUARANTINE");
if (quarantined.length) {
  console.log(`\n  QUARANTINED (${quarantined.length}) — ${INCLUDE_QUARANTINE ? "WILL BE WRITTEN from the file" : "not written, review by hand"}:`);
  for (const r of quarantined.sort((a, b) => Math.abs(b.deltaHours!) - Math.abs(a.deltaHours!))) {
    console.log(
      `    ${String(r.original_filename).slice(0, 30).padEnd(30)} db=${String(r.recorded_at).slice(0, 19)} file=${r.extracted!.slice(0, 19)} ${r.deltaHours! > 0 ? "+" : ""}${r.deltaHours!.toFixed(2)}h`,
    );
  }
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const dir = new URL("../../TESTING/snapshots/", import.meta.url);
const csvCols = [
  "id", "original_filename", "action", "recorded_at", "extracted",
  "newSource", "newOffset", "newPrecision", "deltaHours", "saves", "newDuration", "note",
];
const csv = [
  csvCols.join(","),
  ...results.map((r) =>
    csvCols.map((c) => JSON.stringify((r as unknown as Record<string, unknown>)[c] ?? "")).join(",")
  ),
].join("\n");
const reportPath = new URL(`backfill_${APPLY ? "applied" : "dryrun"}_${stamp}.csv`, dir);
await Deno.writeTextFile(reportPath, csv);
console.log(`\n  report -> ${reportPath.pathname.split("/").pop()}`);

// ─── apply ──────────────────────────────────────────────────────────────────

const WRITABLE_ACTIONS: Action[] = [
  "fill_null", "correct_drift", "already_correct", "no_date_in_file",
  ...(INCLUDE_QUARANTINE ? ["QUARANTINE" as Action] : []),
];
const writable = results.filter((r) => WRITABLE_ACTIONS.includes(r.action));

if (!APPLY) {
  console.log(`\n  ${writable.length} records would be written. Re-run with --apply.`);
  Deno.exit(0);
}

// Undo first, so it exists before anything changes.
const undo = [
  `-- Undo for backfill applied ${new Date().toISOString()}`,
  `-- Restores recorded_at and provenance for every row this run touched.`,
  ...writable.map((r) =>
    `UPDATE media SET recorded_at = ${r.recorded_at === null ? "NULL" : `'${r.recorded_at}'`}, ` +
    `recorded_at_source = ${r.recorded_at_source === null ? "NULL" : `'${r.recorded_at_source}'`}, ` +
    `recorded_at_offset_minutes = ${r.recorded_at_offset_minutes ?? "NULL"}, ` +
    `recorded_at_precision = ${r.recorded_at_precision === null ? "NULL" : `'${r.recorded_at_precision}'`} ` +
    `WHERE id = '${r.id}';`
  ),
].join("\n");
const undoPath = new URL(`backfill_undo_${stamp}.sql`, dir);
await Deno.writeTextFile(undoPath, undo);
console.log(`  undo   -> ${undoPath.pathname.split("/").pop()} (${writable.length} statements)`);

let written = 0;
const failures: string[] = [];
for (const r of writable) {
  const patch: Record<string, unknown> = {
    recorded_at_source: r.newSource,
    recorded_at_precision: r.newPrecision,
    recorded_at_offset_minutes: r.newOffset ?? null,
  };
  // Only move the date when we mean to. A row that is already correct, or one
  // whose file carries no date, keeps whatever it has.
  if (r.action === "fill_null" || r.action === "correct_drift" || r.action === "QUARANTINE") {
    patch.recorded_at = r.extracted;
  }
  if (r.newDuration != null) patch.duration = r.newDuration;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/media?id=eq.${r.id}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (res.ok) written++;
  else failures.push(`${r.original_filename}: ${res.status} ${await res.text()}`);
}

console.log(`\n  written: ${written}/${writable.length}`);
if (failures.length) {
  console.log(`  failures (${failures.length}):`);
  for (const f of failures.slice(0, 10)) console.log(`    ${f}`);
}
