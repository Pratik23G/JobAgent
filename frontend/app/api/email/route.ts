import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendColdEmail } from "@/lib/resend";
import { getServiceClient } from "@/lib/db";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return new Response("Missing user ID", { status: 400 });
  }

  const { to_email, to_name, subject, body, company } = await request.json();

  if (!to_email || !subject || !body) {
    return new Response("Missing required fields: to_email, subject, body", {
      status: 400,
    });
  }

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
