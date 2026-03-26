// POST /api/auth/migrate — Migrate anonymous session data to authenticated user
// Call this once after the user's first successful OAuth login.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getServiceClient } from "@/lib/db";

export async function POST(request: Request) {
  // Must be authenticated
  const session = await getServerSession(authOptions);
  const realUserId = (session?.user as { id?: string })?.id;

  if (!realUserId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await request.json();
  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const anonId = `anon_${sessionId}`;
  const supabase = getServiceClient();

  // Tables to migrate
  const tables = [
    "resumes",
    "applications",
    "recruiter_emails",
    "agent_logs",
    "agent_sessions",
    "apply_packs",
  ] as const;

  const results: Record<string, { migrated: number; error?: string }> = {};

  for (const table of tables) {
    try {
      // Check how many rows exist for this anon user
      const { count } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", anonId);

      if (!count || count === 0) {
        results[table] = { migrated: 0 };
        continue;
      }

      // Update all rows from anon ID to real user ID
      const { error } = await supabase
        .from(table)
        .update({ user_id: realUserId })
        .eq("user_id", anonId);

      if (error) {
        results[table] = { migrated: 0, error: error.message };
      } else {
        results[table] = { migrated: count };
      }
    } catch (err) {
      results[table] = { migrated: 0, error: String(err) };
    }
  }

  const totalMigrated = Object.values(results).reduce((sum, r) => sum + r.migrated, 0);

  return Response.json({
    success: true,
    userId: realUserId,
    migratedFrom: anonId,
    totalMigrated,
    details: results,
  });
}
