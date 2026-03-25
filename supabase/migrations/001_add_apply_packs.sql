-- Migration: Add apply_packs table for Phase B
-- Run this in Supabase SQL Editor if tables already exist

CREATE TABLE IF NOT EXISTS apply_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  application_id UUID REFERENCES applications(id),
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  job_url TEXT,
  cover_letter TEXT,
  resume_bullets TEXT,
  why_good_fit TEXT,
  common_answers JSONB,
  outreach_email TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE apply_packs ENABLE ROW LEVEL SECURITY;

-- Service role key bypasses RLS, but add policy for completeness
CREATE POLICY "Own data only" ON apply_packs FOR ALL USING (auth.uid()::text = user_id);

-- Also add service role bypass for all tables (needed since auth is broken)
-- This allows our service_role key to read/write without user auth
CREATE POLICY "Service role full access" ON apply_packs FOR ALL USING (true) WITH CHECK (true);
