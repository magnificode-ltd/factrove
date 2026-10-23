import type { OutboundEmail } from "./email-sender.js";

export const INVITE_EMAIL_SUBJECT = "You're invited to Factrove";

export type InviteRecipient = {
  email: string;
  name: string;
};

export function buildInviteEmail(input: {
  recipient: InviteRecipient;
  signInUrl: string;
}): OutboundEmail {
  const email = input.recipient.email.trim();
  const displayName = oneLine(input.recipient.name);
  const greeting = displayName.length > 0
    ? `${displayName}, you are invited to Factrove.`
    : "You are invited to Factrove.";
  const text = [
    greeting,
    "",
    `An account is ready for ${email}. Sign in at ${input.signInUrl}.`,
    "",
    "This message was sent because an account was created for this address.",
  ].join("\n");
  const html = [
    "<!DOCTYPE html>",
    "<html><body>",
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>An account is ready for ${escapeHtml(email)}. Sign in at <a href="${escapeHtml(input.signInUrl)}">${escapeHtml(input.signInUrl)}</a>.</p>`,
    "<p>This message was sent because an account was created for this address.</p>",
    "</body></html>",
  ].join("");
  return {
    to: email,
    subject: INVITE_EMAIL_SUBJECT,
    html,
    text,
  };
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
