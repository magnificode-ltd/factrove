import type { OutboundEmail } from "./email-sender.js";
import { escapeHtml, oneLine, renderBrandedEmail } from "./branded-email.js";
import { PASSWORD_RESET_EXPIRES_LABEL } from "./password-reset-link.js";

export const PASSWORD_RESET_EMAIL_SUBJECT = "Reset your Factrove password";
export const PASSWORD_RESET_EMAIL_PURPOSE = "Password reset email";

const REASON = "You received this email because a password reset was requested for this address.";

export function buildPasswordResetEmail(input: {
  recipient: { email: string; name: string };
  resetUrl: string;
  supportEmail: string;
  logoUrl?: string | null;
}): OutboundEmail {
  const email = input.recipient.email.trim();
  const name = oneLine(input.recipient.name);
  const resetUrl = input.resetUrl.trim();
  const supportEmail = input.supportEmail.trim();
  const logoUrl = input.logoUrl?.trim() ?? "";
  const greeting = name.length > 0 ? `Hi ${name},` : "Hi,";
  const request = `We received a request to reset the password for ${email}. This link expires in ${PASSWORD_RESET_EXPIRES_LABEL}.`;
  const ignore = "If you did not ask for a reset, you can ignore this email.";
  const text = [
    PASSWORD_RESET_EMAIL_SUBJECT,
    "",
    greeting,
    request,
    "",
    "Reset your password:",
    resetUrl,
    "",
    ignore,
    REASON,
    `Contact ${supportEmail} if you need help.`,
    "Factrove: https://factrove.app",
  ].join("\n");
  const bodyHtml = `${escapeHtml(greeting)}<br>${escapeHtml(request)}<br>${escapeHtml(ignore)}`;
  return {
    to: email,
    subject: PASSWORD_RESET_EMAIL_SUBJECT,
    purpose: PASSWORD_RESET_EMAIL_PURPOSE,
    html: renderBrandedEmail({
      subject: PASSWORD_RESET_EMAIL_SUBJECT,
      title: PASSWORD_RESET_EMAIL_SUBJECT,
      preheaderHtml: `${escapeHtml(greeting)}<br>${escapeHtml(request)}`,
      bodyHtml,
      actionLabel: "Reset your password",
      actionUrl: resetUrl,
      supportEmail,
      logoUrl,
      reason: REASON,
    }),
    text,
  };
}
