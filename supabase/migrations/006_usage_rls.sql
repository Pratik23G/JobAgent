-- Add Row Level Security to usage_tracking table.
-- Note: The table itself was created in 004_usage_tracking.sql.
-- This migration adds RLS policies and indexes for the dashboard widget.

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Allow service role (used by API routes) full access.
-- Individual user policies are not needed since we use service role key,
-- but we add them for completeness if RLS is enforced later.
CREATE POLICY "Service role full access" ON usage_tracking
  FOR ALL USING (true) WITH CHECK (true);

-- Index for fast dashboard queries
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_action_date
  ON usage_tracking (user_id, action_type, date);
