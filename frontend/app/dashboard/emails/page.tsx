"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/db";

interface RecruiterEmail {
  id: string;
  recruiter_name: string | null;
  recruiter_email: string;
  company: string | null;
  subject: string;
  body: string;
  sent_at: string;
  status: string;
}

interface EmailReply {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  body: string;
  received_at: string;
  read: boolean;
  linked_recruiter_email_id: string | null;
}

export default function EmailsPage() {
  const { data: session } = useSession();
  const [emails, setEmails] = useState<RecruiterEmail[]>([]);
  const [replies, setReplies] = useState<EmailReply[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<RecruiterEmail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEmails = useCallback(async () => {
    if (!session?.user) return;
    const userId = (session.user as { id?: string }).id;
    if (!userId) return;

    const supabase = getSupabase();

    const [emailRes, replyRes] = await Promise.all([
      supabase
        .from("recruiter_emails")
        .select("*")
        .eq("user_id", userId)
        .order("sent_at", { ascending: false }),
      supabase
        .from("email_replies")
        .select("*")
        .eq("user_id", userId)
        .order("received_at", { ascending: false }),
    ]);

    setEmails(emailRes.data || []);
    setReplies(replyRes.data || []);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const getRepliesForEmail = (emailId: string) =>
    replies.filter((r) => r.linked_recruiter_email_id === emailId);

  const unreadCount = replies.filter((r) => !r.read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Emails</h1>
        {unreadCount > 0 && (
          <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-medium text-accent">
            {unreadCount} unread
          </span>
        )}
      </div>

      {loading ? (
        <div className="glass-card p-12 text-center">
          <p className="text-muted animate-pulse">Loading emails...</p>
        </div>
      ) : emails.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-lg text-muted">No outreach emails yet.</p>
          <p className="mt-1 text-sm text-muted">
            Ask the Agent to email recruiters at your target companies.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[350px_1fr]">
          {/* Email List */}
          <div className="space-y-2 overflow-y-auto max-h-[70vh]">
            {emails.map((email) => {
              const replyCount = getRepliesForEmail(email.id).length;
              return (
                <button
                  key={email.id}
                  onClick={() => setSelectedEmail(email)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedEmail?.id === email.id
                      ? "border-accent bg-accent/5"
                      : "border-card-border bg-card hover:border-accent/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">
                      {email.recruiter_name || email.recruiter_email}
                    </p>
                    {replyCount > 0 && (
                      <span className="ml-2 rounded-full bg-accent/20 px-1.5 py-0.5 text-xs text-accent">
                        {replyCount}
                      </span>
                    )}
                  </div>
                  {email.company && (
                    <p className="text-xs text-muted mt-0.5">{email.company}</p>
                  )}
                  <p className="text-xs text-muted mt-1 truncate">
                    {email.subject}
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-muted">
                      {new Date(email.sent_at).toLocaleDateString()}
                    </span>
                    <span
                      className={`text-xs ${
                        email.status === "replied"
                          ? "text-accent"
                          : email.status === "bounced"
                            ? "text-danger"
                            : "text-muted"
                      }`}
                    >
                      {email.status}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Email Detail / Thread */}
          <div className="glass-card p-5 min-h-[300px]">
            {selectedEmail ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">{selectedEmail.subject}</h3>
                  <p className="text-xs text-muted mt-1">
                    To: {selectedEmail.recruiter_name || ""}{" "}
                    &lt;{selectedEmail.recruiter_email}&gt;
                    {selectedEmail.company && ` at ${selectedEmail.company}`}
                  </p>
                  <p className="text-xs text-muted">
                    Sent: {new Date(selectedEmail.sent_at).toLocaleString()}
                  </p>
                </div>

                <div className="rounded-lg bg-background/50 p-4">
                  <pre className="whitespace-pre-wrap font-mono text-sm text-foreground/90">
                    {selectedEmail.body}
                  </pre>
                </div>

                {/* Replies */}
                {getRepliesForEmail(selectedEmail.id).map((reply) => (
                  <div
                    key={reply.id}
                    className="rounded-lg border border-accent/20 bg-accent/5 p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-accent">
                        {reply.from_name || reply.from_email}
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(reply.received_at).toLocaleString()}
                      </p>
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-sm text-foreground/90">
                      {reply.body}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-muted text-sm">
                Select an email to view the thread
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
