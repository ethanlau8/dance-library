export interface Env {
  BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    // Strip leading slash to get the R2 object key (e.g. "thumbs/abc123.jpg")
    const key = url.pathname.slice(1);

    if (!key) {
      return new Response("Not found", { status: 404 });
    }

    const object = await env.BUCKET.get(key);

    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000");

    // Ensure Content-Type is set if not present in R2 metadata
    if (!headers.has("Content-Type")) {
      if (key.endsWith(".jpg") || key.endsWith(".jpeg")) {
        headers.set("Content-Type", "image/jpeg");
      } else if (key.endsWith(".png")) {
        headers.set("Content-Type", "image/png");
      } else if (key.endsWith(".webp")) {
        headers.set("Content-Type", "image/webp");
      } else {
        headers.set("Content-Type", "application/octet-stream");
      }
    }

    return new Response(object.body, { headers });
  },
};
