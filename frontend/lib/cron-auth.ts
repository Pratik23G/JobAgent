// Shared cron authentication — validates secret for all cron routes.
// Supports both ?secret= query param and Vercel's Authorization: Bearer header.

export function validateCronSecret(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return new Response("Server misconfiguration: CRON_SECRET not set", { status: 500 });
  }

  // Check query param
  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get("secret");

  // Check Authorization header (Vercel Cron sends Bearer token)
  const authHeader = request.headers.get("Authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (querySecret === cronSecret || bearerToken === cronSecret) {
    return null; // Authorized
  }

  return new Response("Unauthorized", { status: 401 });
}
