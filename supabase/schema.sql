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

-- Enable Row Level Security
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Own data only" ON resumes FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON applications FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON recruiter_emails FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON email_replies FOR ALL USING (auth.uid()::text = user_id);
CREATE POLICY "Own data only" ON agent_logs FOR ALL USING (auth.uid()::text = user_id);
