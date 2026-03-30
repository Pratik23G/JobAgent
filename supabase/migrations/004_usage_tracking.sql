-- Usage tracking and rate limiting per user per day.
-- Supports free/pro tiers with different limits.

CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 day'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, action_type, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_date ON usage_tracking (user_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_reset ON usage_tracking (reset_at);

-- User tiers: free or pro
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS user_tier TEXT NOT NULL DEFAULT 'free'
  CHECK (user_tier IN ('free', 'pro'));

-- Cleanup old usage records (older than 30 days)
-- This will be handled by the existing cron/cleanup route.
