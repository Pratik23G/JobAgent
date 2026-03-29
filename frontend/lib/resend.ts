import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

interface Attachment {
  filename: string;
  content: string; // base64 encoded
  content_type?: string;
}

interface EmailParams {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  fromName: string;
  replyTo?: string;
  attachments?: Attachment[];
}

export async function sendColdEmail({
  to,
  toName,
  subject,
  body,
  fromName,
  replyTo,
  attachments,
}: EmailParams) {
  const fromDomain = process.env.EMAIL_FROM_DOMAIN || "yourdomain.com";

  return await getResend().emails.send({
    from: `${fromName} <outreach@${fromDomain}>`,
    to: [to],
    subject,
    replyTo: replyTo || undefined,
    html: `<p>${body.replace(/\n/g, "<br>")}</p>`,
    attachments: attachments?.map(a => ({
      filename: a.filename,
      content: Buffer.from(a.content, "base64"),
      content_type: a.content_type || "application/pdf",
    })),
  });
}
