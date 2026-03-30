-- Stripe subscription tracking
-- Adds customer ID and subscription status to track Pro tier payments.

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none'
  CHECK (subscription_status IN ('none', 'active', 'cancelled', 'past_due'));
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;
