// Branded invite message. Self-hosters edit this file, then rebuild the API.
// The shell (colors, wordmark, button, footer) lives in branded-email.ts.
// Links are the sign-in URL, the support address, and https://factrove.app.
// This module does not add query parameters.

import { escapeHtml, FACTROVE_SITE_URL, oneLine, renderBrandedEmail } from "./branded-email.js";

export { escapeHtml, FACTROVE_SITE_URL };

export const INVITE_EMAIL_SUBJECT = "Welcome to Factrove";

const REASON = "You received this email because an account was created for this address.";

export type InviteEmailTemplateInput = {
  recipientEmail: string;
  recipientName: string;
  signInUrl: string;
  supportEmail: string;
  logoUrl: string | null;
};

export function renderInviteEmail(input: InviteEmailTemplateInput): { subject: string; html: string; text: string } {
  const email = input.recipientEmail.trim();
  const name = oneLine(input.recipientName);
  const signInUrl = input.signInUrl.trim();
  const supportEmail = input.supportEmail.trim();
  const logoUrl = input.logoUrl?.trim() ?? "";
  const greeting = name.length > 0 ? `Hi ${name},` : "Hi,";
  const accountReady = `Your Factrove account for ${email} is ready.`;
  const text = [
    "Welcome to Factrove",
    "",
    greeting,
    accountReady,
    "",
    "Sign in to Factrove:",
    signInUrl,
    "",
    REASON,
    `Contact ${supportEmail} if you need help.`,
    `Factrove: ${FACTROVE_SITE_URL}`,
  ].join("\n");
  const welcome = `${escapeHtml(greeting)}<br>${escapeHtml(accountReady)}`;
  return {
    subject: INVITE_EMAIL_SUBJECT,
    html: renderBrandedEmail({
      subject: INVITE_EMAIL_SUBJECT,
      title: "Welcome to Factrove",
      preheaderHtml: welcome,
      bodyHtml: welcome,
      actionLabel: "Sign in to Factrove",
      actionUrl: signInUrl,
      supportEmail,
      logoUrl,
      reason: REASON,
    }),
    text,
  };
}
