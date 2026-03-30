import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY not set — payments will not work");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-03-25.dahlia",
    });
  }
  return _stripe;
}

export const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || "";

export const PRO_FEATURES = {
  name: "JobAgent Pro",
  price: "$9.99/month",
  features: [
    "Unlimited job searches",
    "50 cover letters/day",
    "Unlimited Gmail scans",
    "Priority AI responses",
    "200 AI messages/day",
    "100 emails/day",
  ],
};
