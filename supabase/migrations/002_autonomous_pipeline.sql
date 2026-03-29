-- Migration: Autonomous pipeline - application queue, contact scraping, email follow-ups
-- Run this in Supabase SQL Editor

-- ============================================================
-- 1. Application Queue (tracks auto-fill lifecycle per job)
-- ============================================================
CREATE TABLE IF NOT EXISTS application_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  application_id UUID REFERENCES applications(id),
  apply_pack_id UUID REFERENCES apply_packs(id),
  job_url TEXT NOT NULL,
  job_title TEXT,
  company TEXT,
  match_score INT DEFAULT 0,
  status TEXT DEFAULT 'pending_fill',
  -- status flow: pending_fill → filled → pending_review → approved → submitted → failed
  form_snapshot JSONB,              -- captured form state after fill
  fields_filled INT DEFAULT 0,
  fields_total INT DEFAULT 0,
  fields_needing_human JSONB,       -- [{field_name, reason}]
  resume_uploaded BOOLEAN DEFAULT FALSE,
  auto_fill_attempted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE application_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own data only" ON application_queue FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Service role full access" ON application_queue FOR ALL USING (true) WITH CHECK (true);

-- Index for quick status-based queries
CREATE INDEX idx_application_queue_status ON application_queue(user_id, status);
CREATE INDEX idx_application_queue_created ON application_queue(created_at DESC);

-- ============================================================
-- 2. Company Contacts (scraped recruiter/engineer contacts)
-- ============================================================
CREATE TABLE IF NOT EXISTS company_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company TEXT NOT NULL,
  company_domain TEXT,
  person_name TEXT,
  title TEXT,
  email TEXT,
  linkedin_url TEXT,
  source TEXT DEFAULT 'website_scrape',
  -- source: website_scrape, hunter_api, github, manual, email_pattern
  confidence REAL DEFAULT 0,        -- 0.0 to 1.0
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  application_id UUID REFERENCES applications(id),
  UNIQUE(user_id, company, email)
);

ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own data only" ON company_contacts FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Service role full access" ON company_contacts FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_company_contacts_company ON company_contacts(user_id, company);

-- ============================================================
-- 3. Email Follow-ups (scheduled follow-up emails)
-- ============================================================
CREATE TABLE IF NOT EXISTS email_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  original_email_id UUID REFERENCES recruiter_emails(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  followup_number INT DEFAULT 1,    -- 1st, 2nd, 3rd follow-up
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'scheduled',
  -- status: scheduled, sent, cancelled, replied
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own data only" ON email_followups FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Service role full access" ON email_followups FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_email_followups_scheduled ON email_followups(scheduled_at, status);

-- ============================================================
-- 4. Pipeline Runs (daily cap enforcement + audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  trigger TEXT DEFAULT 'cron',      -- cron, manual, agent
  jobs_found INT DEFAULT 0,
  jobs_matched INT DEFAULT 0,
  packs_generated INT DEFAULT 0,
  applications_queued INT DEFAULT 0,
  emails_sent INT DEFAULT 0,
  run_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own data only" ON pipeline_runs FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Service role full access" ON pipeline_runs FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_pipeline_runs_date ON pipeline_runs(user_id, run_date);

-- ============================================================
-- 5. Alter recruiter_emails - add enrichment columns
-- ============================================================
ALTER TABLE recruiter_emails ADD COLUMN IF NOT EXISTS recipient_title TEXT;
ALTER TABLE recruiter_emails ADD COLUMN IF NOT EXISTS recipient_context TEXT;
ALTER TABLE recruiter_emails ADD COLUMN IF NOT EXISTS has_attachment BOOLEAN DEFAULT FALSE;
ALTER TABLE recruiter_emails ADD COLUMN IF NOT EXISTS project_links JSONB;
ALTER TABLE recruiter_emails ADD COLUMN IF NOT EXISTS thread_id TEXT;
ALTER TABLE recruiter_emails ADD COLUMN IF NOT EXISTS opened BOOLEAN DEFAULT FALSE;
ALTER TABLE recruiter_emails ADD COLUMN IF NOT EXISTS replied BOOLEAN DEFAULT FALSE;
ALTER TABLE recruiter_emails ADD COLUMN IF NOT EXISTS followup_count INT DEFAULT 0;
