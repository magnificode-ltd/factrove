import type { OutboundEmail } from "./email-sender.js";
import { escapeHtml, oneLine, renderBrandedEmail } from "./branded-email.js";
import { EMAIL_VERIFICATION_EXPIRES_LABEL } from "./password-reset-link.js";

export const VERIFICATION_EMAIL_SUBJECT = "Confirm your Factrove email";
export const VERIFICATION_EMAIL_PURPOSE = "Verification email";

const REASON = "You received this email because an account was created for this address.";

export function buildVerificationEmail(input: {
  recipient: { email: string; name: string };
  verifyUrl: string;
  supportEmail: string;
  logoUrl?: string | null;
}): OutboundEmail {
  const email = input.recipient.email.trim();
  const name = oneLine(input.recipient.name);
  const verifyUrl = input.verifyUrl.trim();
  const supportEmail = input.supportEmail.trim();
  const logoUrl = input.logoUrl?.trim() ?? "";
  const greeting = name.length > 0 ? `Hi ${name},` : "Hi,";
  const ready = `Your Factrove account for ${email} is ready.`;
  const confirm = `Confirm this address when you can. The link expires in ${EMAIL_VERIFICATION_EXPIRES_LABEL}. You can keep using Factrove either way.`;
  const text = [
    VERIFICATION_EMAIL_SUBJECT,
    "",
    greeting,
    ready,
    confirm,
    "",
    "Confirm your email:",
    verifyUrl,
    "",
    REASON,
    `Contact ${supportEmail} if you need help.`,
    "Factrove: https://factrove.app",
  ].join("\n");
  const bodyHtml = `${escapeHtml(greeting)}<br>${escapeHtml(ready)}<br>${escapeHtml(confirm)}`;
  return {
    to: email,
    subject: VERIFICATION_EMAIL_SUBJECT,
    purpose: VERIFICATION_EMAIL_PURPOSE,
    html: renderBrandedEmail({
      subject: VERIFICATION_EMAIL_SUBJECT,
      title: VERIFICATION_EMAIL_SUBJECT,
      preheaderHtml: `${escapeHtml(greeting)}<br>${escapeHtml(ready)}`,
      bodyHtml,
      actionLabel: "Confirm email",
      actionUrl: verifyUrl,
      supportEmail,
      logoUrl,
      reason: REASON,
    }),
    text,
  };
}
