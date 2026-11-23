import type { OutboundEmail } from "./email-sender.js";
import { escapeHtml, oneLine, renderBrandedEmail } from "./branded-email.js";

export const ORGANIZATION_INVITE_PURPOSE = "Organization invitation";

const REASON = "You received this email because an owner invited this address to a Factrove organization.";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function organizationInviteSubject(organizationName: string): string {
  const name = oneLine(organizationName);
  if (name.length === 0) {
    return "Join an organization on Factrove";
  }
  return `Join ${name} on Factrove`;
}

export function formatInvitationExpiry(expiresAt: Date): string {
  const day = expiresAt.getUTCDate();
  const month = MONTHS[expiresAt.getUTCMonth()] ?? "January";
  const year = expiresAt.getUTCFullYear();
  const hours = String(expiresAt.getUTCHours()).padStart(2, "0");
  const minutes = String(expiresAt.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

export function buildOrganizationInviteEmail(input: {
  email: string;
  organizationName: string;
  inviterName: string;
  expiresAt: Date;
  acceptUrl: string;
  supportEmail: string;
  siteUrl: string;
  logoUrl?: string | null;
}): OutboundEmail {
  const email = input.email.trim();
  const organizationName = oneLine(input.organizationName);
  const inviterName = oneLine(input.inviterName);
  const acceptUrl = input.acceptUrl.trim();
  const supportEmail = input.supportEmail.trim();
  const siteUrl = input.siteUrl.trim();
  const logoUrl = input.logoUrl?.trim() ?? "";
  const subject = organizationInviteSubject(organizationName);
  const expiry = formatInvitationExpiry(input.expiresAt);
  const organizationLabel = organizationName.length > 0 ? organizationName : "an organization";
  const invited = inviterName.length > 0
    ? `${inviterName} invited ${email} to ${organizationLabel} on Factrove.`
    : `An owner invited ${email} to ${organizationLabel} on Factrove.`;
  const expires = `This invitation expires ${expiry}.`;
  const text = [
    subject,
    "",
    invited,
    expires,
    "",
    "View the invitation:",
    acceptUrl,
    "",
    REASON,
    `Contact ${supportEmail} if you need help.`,
    `Factrove: ${siteUrl}`,
  ].join("\n");
  const bodyHtml = `${escapeHtml(invited)}<br>${escapeHtml(expires)}`;
  return {
    to: email,
    subject,
    purpose: ORGANIZATION_INVITE_PURPOSE,
    html: renderBrandedEmail({
      subject,
      title: subject,
      preheaderHtml: escapeHtml(invited),
      bodyHtml,
      actionLabel: "View invitation",
      actionUrl: acceptUrl,
      supportEmail,
      siteUrl,
      logoUrl,
      reason: REASON,
    }),
    text,
  };
}
