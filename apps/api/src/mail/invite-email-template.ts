// Branded invite message. Self-hosters edit this file, then rebuild the API.
// Colors and the wordmark follow the Factrove mark: peri #858bee, ink #1b2037,
// cloud #f5f6fc, and Inter with a system-ui fallback. "fac" and "rove" are peri.
// The "t" is ink. An empty logo URL uses that text mark. A set logo URL is an
// image, and its alt text is the wordmark when the image does not load.
// Links are the sign-in URL, the support address, and https://factrove.app.
// This module does not add query parameters.

export const INVITE_EMAIL_SUBJECT = "Welcome to Factrove";

export const FACTROVE_SITE_URL = "https://factrove.app";

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const WRAP = "word-break:break-word; overflow-wrap:anywhere;";
const LINK_DARK = "#858bee";

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
    "You received this email because an account was created for this address.",
    `Contact ${supportEmail} if you need help.`,
    `Factrove: ${FACTROVE_SITE_URL}`,
  ].join("\n");
  return {
    subject: INVITE_EMAIL_SUBJECT,
    html: renderHtml({
      greeting,
      accountReady,
      signInUrl,
      supportEmail,
      logoUrl,
    }),
    text,
  };
}

function renderHtml(input: {
  greeting: string;
  accountReady: string;
  signInUrl: string;
  supportEmail: string;
  logoUrl: string;
}): string {
  const greeting = escapeHtml(input.greeting);
  const accountReady = escapeHtml(input.accountReady);
  const welcome = `${greeting}<br>${accountReady}`;
  const signInUrl = escapeHtml(input.signInUrl);
  const supportEmail = escapeHtml(input.supportEmail);
  const siteUrl = escapeHtml(FACTROVE_SITE_URL);
  return [
    "<!DOCTYPE html>",
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(INVITE_EMAIL_SUBJECT)}</title>`,
    "<style>",
    `:root { color-scheme: light dark; supported-color-schemes: light dark; }`,
    `body, table, td, a { font-family: ${FONT}; }`,
    ".welcome, .fallback, .footer, .welcome a, .fallback a, .footer a { word-break: break-word !important; overflow-wrap: anywhere !important; }",
    "@media only screen and (max-width: 620px) {",
    "  .container { width: 100% !important; }",
    "  .pad { padding-left: 20px !important; padding-right: 20px !important; }",
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  .email-bg { background-color: #12141f !important; }",
    "  .card { background-color: #1c2238 !important; border-color: #2c3354 !important; }",
    "  .ink { color: #f5f6fc !important; }",
    "  .muted { color: #c5c8de !important; }",
    "  .wordmark { color: #858bee !important; }",
    "  .wordmark-t { color: #f5f6fc !important; }",
    "  .btn { background-color: #858bee !important; }",
    "  .btn a { color: #1b2037 !important; }",
    `  .link { color: ${LINK_DARK} !important; }`,
    "}",
    "</style>",
    "</head>",
    '<body class="email-bg" style="margin:0; padding:0; background-color:#f5f6fc; color:#1b2037;">',
    `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${welcome}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#f5f6fc" style="background-color:#f5f6fc;">',
    "<tr>",
    '<td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container card" bgcolor="#ffffff" style="width:600px; max-width:600px; background-color:#ffffff; border:1px solid #e2e4f3; border-radius:14px;">',
    "<tr>",
    `<td class="pad" style="padding:32px 40px 8px 40px;">${renderMark(input.logoUrl)}</td>`,
    "</tr>",
    "<tr>",
    `<td class="pad ink" style="padding:16px 40px 0 40px; font-family:${FONT}; font-size:28px; line-height:1.15; font-weight:800; letter-spacing:-0.045em; color:#1b2037;">Welcome to Factrove</td>`,
    "</tr>",
    "<tr>",
    `<td class="pad muted welcome" style="padding:16px 40px 0 40px; font-family:${FONT}; font-size:16px; line-height:1.55; color:#4a4f6a; ${WRAP}">${welcome}</td>`,
    "</tr>",
    "<tr>",
    '<td class="pad" align="left" style="padding:28px 40px 8px 40px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">',
    "<tr>",
    '<td class="btn" bgcolor="#5e64d6" style="border-radius:14px; background-color:#5e64d6;">',
    `<a href="${signInUrl}" style="display:inline-block; padding:14px 28px; font-family:${FONT}; font-size:16px; line-height:1.2; font-weight:700; color:#ffffff; text-decoration:none;">Sign in to Factrove</a>`,
    "</td>",
    "</tr>",
    "</table>",
    "</td>",
    "</tr>",
    "<tr>",
    `<td class="pad muted fallback" style="padding:8px 40px 28px 40px; font-family:${FONT}; font-size:14px; line-height:1.55; color:#4a4f6a; ${WRAP}">Or open this link:<br><a class="link" href="${signInUrl}" style="color:#5e64d6; ${WRAP}">${signInUrl}</a></td>`,
    "</tr>",
    "<tr>",
    `<td class="pad muted footer" style="padding:0 40px 32px 40px; font-family:${FONT}; font-size:13px; line-height:1.55; color:#4a4f6a; ${WRAP}">You received this email because an account was created for this address.<br>Contact <a class="link" href="mailto:${supportEmail}" style="color:#5e64d6; ${WRAP}">${supportEmail}</a> if you need help.<br><a class="link" href="${siteUrl}" style="color:#5e64d6; ${WRAP}">Factrove</a></td>`,
    "</tr>",
    "</table>",
    "</td>",
    "</tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("");
}

function renderMark(logoUrl: string): string {
  if (logoUrl.length > 0) {
    const src = escapeHtml(logoUrl);
    return `<img src="${src}" alt="Factrove" width="160" style="display:block; width:160px; max-width:160px; height:auto; border:0; outline:none; text-decoration:none;">`;
  }
  return [
    `<span class="wordmark" style="font-family:${FONT}; font-weight:800; font-size:22px; letter-spacing:-0.04em; color:#858bee; line-height:1; text-decoration:none;">`,
    'fac<b class="wordmark-t" style="color:#1b2037; font-weight:800;">t</b>rove',
    "</span>",
  ].join("");
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
