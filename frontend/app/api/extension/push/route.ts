// POST /api/extension/push — Frontend pushes profile, resume blob, and packs
// Stored to a temp file so the GET /api/extension/sync can read it.
// This bypasses Supabase entirely — direct frontend→extension bridge.

import { writeFile } from "fs/promises";
import { join } from "path";

const CACHE_FILE = join(process.cwd(), ".extension-cache.json");

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const cache = {
      profile: body.profile || {},
      resumeBlob: body.resumeBlob || null,
      packs: body.packs || [],
      updatedAt: Date.now(),
    };

    await writeFile(CACHE_FILE, JSON.stringify(cache), "utf-8");

    return Response.json({ success: true, cached: true });
  } catch (err) {
    console.error("Extension push error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
