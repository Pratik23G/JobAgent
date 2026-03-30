import { getStripe } from "@/lib/stripe";
import { getServiceClient } from "@/lib/db";
import { auditLog } from "@/lib/audit-log";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Missing signature or webhook secret", { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const supabase = getServiceClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (userId) {
        await supabase
          .from("resumes")
          .update({
            user_tier: "pro",
            stripe_customer_id: customerId,
            subscription_status: "active",
            subscription_id: subscriptionId,
          })
          .eq("user_id", userId);

        await auditLog({
          eventType: "application.status_changed",
          actorId: userId,
          resourceType: "subscription",
          resourceId: subscriptionId,
          outcome: "success",
          metadata: { action: "upgraded_to_pro", customerId },
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as unknown as Record<string, unknown>;
      const status = subscription.status as string;
      const subscriptionId = subscription.id as string;

      const tier = status === "active" ? "pro" : "free";
      const subStatus = status === "active" ? "active" : status === "past_due" ? "past_due" : "cancelled";
      const periodEnd = subscription.current_period_end as number | undefined;

      await supabase
        .from("resumes")
        .update({
          user_tier: tier,
          subscription_status: subStatus,
          subscription_ends_at: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
        })
        .eq("subscription_id", subscriptionId);
      break;
    }

    case "customer.subscription.deleted": {
      const deletedSub = event.data.object as unknown as Record<string, unknown>;
      await supabase
        .from("resumes")
        .update({
          user_tier: "free",
          subscription_status: "cancelled",
        })
        .eq("subscription_id", deletedSub.id as string);
      break;
    }
  }

  return Response.json({ received: true });
}
