import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendColdEmail } from "@/lib/resend";
import { getServiceClient } from "@/lib/db";
import { EmailSendSchema, validateRequest } from "@/lib/validation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return new Response("Missing user ID", { status: 400 });
  }

  // Rate limit: 10 emails/min per user
  const rl = rateLimit(`email:${userId}`, 10, 60_000);
  if (!rl.success) return rateLimitResponse(rl.resetAt);

  const rawBody = await request.json();
  const validated = validateRequest(EmailSendSchema, rawBody);
  if (!validated.success) return validated.error;
  const { to_email, to_name, subject, body, company } = validated.data;

  try {
    await sendColdEmail({
      to: to_email,
      toName: to_name,
      subject,
      body,
      fromName: session.user.name || "JobAgent User",
    });

    const supabase = getServiceClient();
    const { error } = await supabase.from("recruiter_emails").insert({
      user_id: userId,
      recruiter_name: to_name || null,
      recruiter_email: to_email,
      company: company || null,
      subject,
      body,
      status: "sent",
    });

    if (error) {
      console.error("Failed to save email record:", error);
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("Email send error:", err);
    return new Response("Failed to send email", { status: 500 });
  }
}
