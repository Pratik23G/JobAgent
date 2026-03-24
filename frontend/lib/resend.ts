import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

interface EmailParams {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  fromName: string;
}

export async function sendColdEmail({
  to,
  toName,
  subject,
  body,
  fromName,
}: EmailParams) {
  return await getResend().emails.send({
    from: `${fromName} <outreach@yourdomain.com>`,
    to: [to],
    subject,
    html: `<p>${body.replace(/\n/g, "<br>")}</p>`,
  });
}
