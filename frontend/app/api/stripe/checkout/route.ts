import { getStripe, STRIPE_PRO_PRICE_ID } from "@/lib/stripe";
import { getServiceClient } from "@/lib/db";

export async function POST(request: Request) {
  const { sessionId } = await request.json();

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  if (!STRIPE_PRO_PRICE_ID) {
    return Response.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const userId = `anon_${sessionId}`;
  const supabase = getServiceClient();

  // Check if user already has a Stripe customer ID
  const { data: resume } = await supabase
    .from("resumes")
    .select("stripe_customer_id, user_tier")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (resume?.user_tier === "pro") {
    return Response.json({ error: "Already a Pro subscriber" }, { status: 400 });
  }

  // Create or reuse Stripe customer
  let customerId = resume?.stripe_customer_id;
  if (!customerId) {
    const customer = await getStripe().customers.create({
      metadata: { userId, sessionId },
    });
    customerId = customer.id;

    // Save customer ID
    if (resume) {
      await supabase
        .from("resumes")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", userId);
    }
  }

  // Create checkout session
  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price: STRIPE_PRO_PRICE_ID,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${process.env.NEXTAUTH_URL || "https://job-agent-umber.vercel.app"}/dashboard?upgraded=true`,
    cancel_url: `${process.env.NEXTAUTH_URL || "https://job-agent-umber.vercel.app"}/dashboard?cancelled=true`,
    metadata: { userId, sessionId },
  });

  return Response.json({ url: session.url });
}
