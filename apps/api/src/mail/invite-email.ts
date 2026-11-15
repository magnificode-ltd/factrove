import type { OutboundEmail } from "./email-sender.js";
import { renderInviteEmail } from "./invite-email-template.js";

export { INVITE_EMAIL_SUBJECT } from "./invite-email-template.js";

export type InviteRecipient = {
  email: string;
  name: string;
};

export function buildInviteEmail(input: {
  recipient: InviteRecipient;
  signInUrl: string;
  supportEmail: string;
  siteUrl: string;
  logoUrl?: string | null;
}): OutboundEmail {
  const email = input.recipient.email.trim();
  const rendered = renderInviteEmail({
    recipientEmail: email,
    recipientName: input.recipient.name,
    signInUrl: input.signInUrl,
    supportEmail: input.supportEmail,
    siteUrl: input.siteUrl,
    logoUrl: input.logoUrl ?? null,
  });
  return {
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };
}
