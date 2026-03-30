export const metadata = {
  title: "Terms of Service — JobAgent",
  description: "Terms of Service for JobAgent AI job application automation platform",
};

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: March 30, 2026</p>

        <div className="space-y-10 text-sm leading-relaxed">
          {/* ── 1. Acceptance ────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using JobAgent (&quot;the Service&quot;), available at{" "}
              <a href="https://job-agent-umber.vercel.app" className="text-blue-400 hover:underline">
                https://job-agent-umber.vercel.app
              </a>
              , you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not
              agree to these Terms, you must not use the Service.
            </p>
            <p className="mt-2">
              We reserve the right to modify these Terms at any time. Continued use of the Service
              after changes constitutes acceptance of the updated Terms. We will update the
              &quot;Last updated&quot; date above when changes are made.
            </p>
          </section>

          {/* ── 2. Description ───────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Description of Service</h2>
            <p>
              JobAgent is an AI-powered job hunting platform that helps users search for jobs,
              generate application materials, track application statuses, and automate outreach to
              recruiters. Key features include:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Multi-source job search across Adzuna, JSearch, Hacker News, and other platforms</li>
              <li>AI-generated cover letters, cold emails, and application materials</li>
              <li>Resume parsing and job-to-resume match scoring</li>
              <li>Application tracking with status updates</li>
              <li>Optional Gmail integration for automatic status detection</li>
              <li>Automated follow-up email scheduling</li>
              <li>Browser extension for ATS form auto-fill</li>
            </ul>
            <p className="mt-2">
              The Service is currently provided free of charge. We reserve the right to introduce
              paid features or subscription plans in the future, with reasonable advance notice.
            </p>
          </section>

          {/* ── 3. Accounts ──────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. User Accounts and Google OAuth</h2>
            <p>
              You may use JobAgent anonymously with a session-based identity, or sign in with your
              Google account via Google OAuth 2.0. When you sign in with Google, we receive your
              name and email address from your Google account.
            </p>
            <p className="mt-2">You are responsible for:</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>Maintaining the security of your Google account credentials</li>
              <li>All activity that occurs under your account or session</li>
              <li>Notifying us immediately of any unauthorized use of your account</li>
            </ul>
            <p className="mt-2">
              We do not store your Google password. Authentication is handled entirely by
              Google&apos;s OAuth infrastructure.
            </p>
          </section>

          {/* ── 4. Gmail ─────────────────────────────────────────── */}
          <section className="border border-blue-500/30 rounded-lg p-5 bg-blue-500/5">
            <h2 className="text-lg font-semibold text-white mb-3">4. Gmail Data Access and Limited Use</h2>
            <p>
              You may optionally connect your Gmail account to enable automatic detection of
              job-related emails. This connection is entirely voluntary and can be revoked at any
              time.
            </p>

            <h3 className="font-medium text-gray-300 mt-4 mb-2">What we access</h3>
            <p>
              We request <strong className="text-white">read-only access</strong> (
              <code className="bg-gray-800 px-1 rounded text-xs">gmail.readonly</code> scope) to
              your Gmail inbox. We cannot send, delete, or modify your emails.
            </p>

            <h3 className="font-medium text-gray-300 mt-4 mb-2">How we use Gmail data</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Emails are scanned to identify job-related messages (interview invites, rejections, confirmations, offers)</li>
              <li>Email classifications are used to automatically update your application statuses</li>
              <li>Non-job-related emails are classified as &quot;irrelevant&quot; and immediately discarded</li>
            </ul>

            <h3 className="font-medium text-gray-300 mt-4 mb-2">Limited Use compliance</h3>
            <p>
              Our use of Gmail data adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>Gmail data is used <strong className="text-white">only</strong> to provide job tracking features</li>
              <li>Gmail data is <strong className="text-white">never</strong> used for advertising</li>
              <li>Gmail data is <strong className="text-white">never</strong> sold or transferred to third parties</li>
              <li>Gmail data is processed <strong className="text-white">automatically</strong> — no humans read your emails</li>
            </ul>

            <h3 className="font-medium text-gray-300 mt-4 mb-2">Revoking access</h3>
            <p>
              You can disconnect Gmail at any time from the Emails page in your dashboard, or by
              visiting your{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Google Account permissions
              </a>{" "}
              and removing JobAgent. Upon disconnection, your Gmail OAuth tokens are deleted from
              our database.
            </p>
          </section>

          {/* ── 5. AI Content ────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. AI-Generated Content Disclaimer</h2>
            <p>
              JobAgent uses artificial intelligence models (Anthropic Claude, OpenAI GPT-4o mini,
              Google Gemini) to generate content including but not limited to:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Cover letters</li>
              <li>Cold outreach emails to recruiters</li>
              <li>Follow-up emails</li>
              <li>Resume bullet points and &quot;why I&apos;m a good fit&quot; paragraphs</li>
              <li>Answers to common application questions</li>
              <li>Job match scores and justifications</li>
            </ul>

            <div className="mt-4 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <p className="text-yellow-200 font-medium mb-2">Important:</p>
              <ul className="list-disc pl-5 space-y-1 text-yellow-100/80">
                <li>
                  <strong>You are solely responsible</strong> for reviewing all AI-generated content
                  before sending it to recruiters, hiring managers, or any other recipient.
                </li>
                <li>
                  AI-generated content may contain <strong>inaccuracies, exaggerations, or
                  fabricated details</strong>. Always verify that the content accurately represents
                  your qualifications and experience.
                </li>
                <li>
                  JobAgent does not guarantee that AI-generated materials will result in interviews,
                  job offers, or any specific outcome.
                </li>
                <li>
                  You accept full responsibility for any content you choose to send using the
                  Service.
                </li>
              </ul>
            </div>
          </section>

          {/* ── 6. Acceptable Use ────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Acceptable Use Policy</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Send unsolicited bulk emails or spam to recruiters or any other recipients</li>
              <li>Scrape, crawl, or harvest data from the Service for unauthorized purposes</li>
              <li>Misrepresent your identity, qualifications, or experience in applications</li>
              <li>Interfere with or disrupt the Service&apos;s infrastructure or other users&apos; access</li>
              <li>Attempt to bypass rate limits, authentication, or other security measures</li>
              <li>Use the Service for any unlawful purpose or in violation of any applicable law</li>
              <li>Upload malicious files, malware, or content designed to exploit the system</li>
              <li>Create multiple accounts to circumvent usage limits</li>
              <li>Automate access to the Service beyond the features we provide (e.g., scripting against our API)</li>
            </ul>
            <p className="mt-2">
              We reserve the right to suspend or terminate access for users who violate this policy,
              with or without notice.
            </p>
          </section>

          {/* ── 7. Third-Party ────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Third-Party Services</h2>
            <p>
              The Service integrates with third-party services to provide its features. These
              services have their own terms and privacy policies:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>
                <strong className="text-gray-300">Google</strong> — OAuth authentication and Gmail
                API ({" "}
                <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  Terms
                </a>
                )
              </li>
              <li>
                <strong className="text-gray-300">Supabase</strong> — Database and authentication
                infrastructure
              </li>
              <li>
                <strong className="text-gray-300">Anthropic</strong> — Claude AI for agent
                orchestration
              </li>
              <li>
                <strong className="text-gray-300">OpenAI</strong> — GPT-4o mini for job scoring
                and classification
              </li>
              <li>
                <strong className="text-gray-300">Google Gemini</strong> — AI for email drafting
                and cover letters
              </li>
              <li>
                <strong className="text-gray-300">Adzuna</strong> — Job listing search API
              </li>
              <li>
                <strong className="text-gray-300">JSearch (RapidAPI)</strong> — Job aggregation
                from LinkedIn, Indeed, Glassdoor
              </li>
              <li>
                <strong className="text-gray-300">Resend</strong> — Email delivery service
              </li>
            </ul>
            <p className="mt-2">
              We are not responsible for the availability, accuracy, or policies of third-party
              services. Job listings are sourced from external providers and may contain outdated or
              inaccurate information.
            </p>
          </section>

          {/* ── 8. IP ─────────────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Intellectual Property</h2>
            <p>
              The Service, including its design, code, and branding, is the intellectual property of
              JobAgent&apos;s developer. You may not copy, modify, distribute, or reverse-engineer
              any part of the Service without prior written permission.
            </p>
            <p className="mt-2">
              <strong className="text-white">Your content:</strong> You retain ownership of all
              content you provide to the Service, including your resume, personal information, and
              chat messages. By using the Service, you grant us a limited license to process this
              content solely to provide the Service&apos;s features.
            </p>
            <p className="mt-2">
              <strong className="text-white">AI-generated content:</strong> Cover letters, emails,
              and other materials generated by the Service are provided for your personal use. You
              may use, modify, and distribute AI-generated content freely, but you accept
              responsibility for its accuracy and appropriateness.
            </p>
          </section>

          {/* ── 9. Disclaimers ────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">
              9. Disclaimers and Limitation of Liability
            </h2>

            <div className="p-4 rounded-lg bg-gray-900 border border-gray-700">
              <p className="font-medium text-white mb-2">THE SERVICE IS PROVIDED &quot;AS IS&quot;</p>
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, JOBAGENT IS PROVIDED &quot;AS IS&quot; AND
                &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED,
                STATUTORY, OR OTHERWISE, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
                MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>
            </div>

            <p className="mt-4">We specifically do not warrant that:</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>The Service will be uninterrupted, error-free, or available at all times</li>
              <li>Job listings are accurate, current, or complete</li>
              <li>AI-generated content is accurate, appropriate, or free from errors</li>
              <li>Use of the Service will result in job interviews, offers, or employment</li>
              <li>Email delivery or recruiter outreach will be successful</li>
              <li>Match scores accurately predict job fit or hiring outcomes</li>
            </ul>

            <p className="mt-4">
              <strong className="text-white">Limitation of liability:</strong> To the maximum
              extent permitted by law, JobAgent and its developer shall not be liable for any
              indirect, incidental, special, consequential, or punitive damages, including but not
              limited to loss of profits, data, employment opportunities, or goodwill, arising out
              of or related to your use of the Service, regardless of the cause of action or theory
              of liability.
            </p>

            <p className="mt-2">
              Our total aggregate liability for all claims arising from or related to the Service
              shall not exceed the amount you paid for the Service in the twelve (12) months
              preceding the claim, or $100 USD, whichever is greater.
            </p>
          </section>

          {/* ── 10. Data Retention ────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Data Retention and Account Deletion</h2>
            <p>
              We retain your data in accordance with our{" "}
              <a href="/privacy" className="text-blue-400 hover:underline">
                Privacy Policy
              </a>
              . In summary:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Chat sessions are deleted after 30 days of inactivity</li>
              <li>Agent logs are deleted after 90 days</li>
              <li>Audit logs are retained for 1 year, then deleted</li>
              <li>Resume data and applications are retained until you request deletion</li>
              <li>Gmail tokens are deleted when you disconnect Gmail</li>
            </ul>
            <p className="mt-3">
              <strong className="text-white">Account deletion:</strong> You may request complete
              deletion of your account and all associated data by emailing{" "}
              <a href="mailto:pgc67990@gmail.com" className="text-blue-400 hover:underline">
                pgc67990@gmail.com
              </a>
              . We will process deletion requests within 30 days and confirm completion via email.
              Deleted data cannot be recovered.
            </p>
          </section>

          {/* ── 11. Indemnification ───────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless JobAgent and its developer from any
              claims, liabilities, damages, losses, and expenses (including reasonable
              attorney&apos;s fees) arising out of or related to:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Your use or misuse of the Service</li>
              <li>Content you submit, send, or publish through the Service</li>
              <li>Your violation of these Terms</li>
              <li>Your violation of any applicable law or third-party rights</li>
            </ul>
          </section>

          {/* ── 12. Termination ───────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">12. Termination</h2>
            <p>
              We may suspend or terminate your access to the Service at any time, with or without
              cause, and with or without notice. Reasons for termination may include but are not
              limited to violation of these Terms, abuse of the Service, or extended inactivity.
            </p>
            <p className="mt-2">
              You may stop using the Service at any time. To delete your data, follow the
              instructions in Section 10.
            </p>
            <p className="mt-2">
              Upon termination, your right to use the Service ceases immediately. Sections 5
              (AI-Generated Content), 8 (Intellectual Property), 9 (Disclaimers), and 11
              (Indemnification) survive termination.
            </p>
          </section>

          {/* ── 13. Governing Law ─────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">13. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the
              United States, without regard to conflict of law principles. Any disputes arising
              under these Terms shall be resolved through good-faith negotiation, and if necessary,
              binding arbitration.
            </p>
          </section>

          {/* ── 14. Changes ──────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">14. Changes to These Terms</h2>
            <p>
              We may revise these Terms at any time by posting the updated version on this page. The
              &quot;Last updated&quot; date at the top will reflect the most recent revision.
              Material changes will be communicated via a notice on the Service. Your continued use
              of the Service after any changes indicates your acceptance of the revised Terms.
            </p>
          </section>

          {/* ── 15. Contact ──────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">15. Contact Us</h2>
            <p>
              If you have questions about these Terms, please contact us:
            </p>
            <div className="mt-3 p-4 rounded-lg bg-gray-900 border border-gray-800">
              <p className="text-white font-medium">JobAgent</p>
              <p>
                Email:{" "}
                <a href="mailto:pgc67990@gmail.com" className="text-blue-400 hover:underline">
                  pgc67990@gmail.com
                </a>
              </p>
              <p>
                Website:{" "}
                <a
                  href="https://job-agent-umber.vercel.app"
                  className="text-blue-400 hover:underline"
                >
                  https://job-agent-umber.vercel.app
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
