import { getUserUsage } from "@/lib/usage";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const userId = `anon_${sessionId}`;
  const data = await getUserUsage(userId);

  return Response.json(data);
}
