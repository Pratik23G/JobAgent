-- Resume storage
CREATE TABLE resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  raw_text TEXT,
  parsed_json JSONB,
  file_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job applications
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  job_title TEXT,
  company TEXT,
  job_url TEXT,
  status TEXT DEFAULT 'applied',
  cover_letter TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- Recruiter cold email outreach
CREATE TABLE recruiter_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  recruiter_name TEXT,
  recruiter_email TEXT,
  company TEXT,
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

-- Inbound email replies
CREATE TABLE email_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  from_email TEXT,
  from_name TEXT,
  subject TEXT,
  body TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  linked_application_id UUID REFERENCES applications(id),
  linked_recruiter_email_id UUID REFERENCES recruiter_emails(id),
  read BOOLEAN DEFAULT FALSE
);

-- Agent activity log
CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  command TEXT,
  action TEXT,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent sessions (stateful conversation tracking)
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  messages JSONB DEFAULT '[]',
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Apply packs (generated per job: cover letter, tailored resume points, Q&A answers)
CREATE TABLE apply_packs (
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

-- Gmail OAuth tokens (per-user, keyed by session_id)
CREATE TABLE gmail_tokens (
  session_id TEXT PRIMARY KEY,
  gmail_email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email scan results (persisted so they survive page navigation)
CREATE TABLE email_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  sender TEXT,
  sender_email TEXT,
  raw_subject TEXT,
  company TEXT,
  role TEXT,
  classification TEXT NOT NULL,
  confidence INT DEFAULT 0,
  summary TEXT,
  action TEXT,
  received_at TIMESTAMPTZ,
  linked_application_id UUID REFERENCES applications(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, sender_email, raw_subject)
);

-- Scan metadata (tracks when last scan happened per session)
CREATE TABLE scan_metadata (
  session_id TEXT PRIMARY KEY,
  last_scanned_at TIMESTAMPTZ DEFAULT NOW(),
  emails_scanned INT DEFAULT 0,
  job_related INT DEFAULT 0,
  statuses_updated INT DEFAULT 0
);

-- Enable Row Level Security
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE apply_packs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Own data only" ON resumes FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON applications FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON recruiter_emails FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON email_replies FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON agent_logs FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON agent_sessions FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON apply_packs FOR ALL USING (auth.uid()::text = user_id);
