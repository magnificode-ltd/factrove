// Shared Factrove email shell. Colors and the wordmark follow the mark:
// peri #858bee, ink #1b2037, cloud #f5f6fc, and Inter with a system-ui fallback.
// "fac" and "rove" are peri. The "t" is ink. An empty logo URL uses that text
// mark. A set logo URL is an image, and its alt text is the wordmark when the
// image does not load. Callers own the wording, the action URL, and the
// footer link. The footer text stays "Factrove". The href is the instance origin.

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const WRAP = "word-break:break-word; overflow-wrap:anywhere;";
const LINK_DARK = "#858bee";

export type BrandedEmailInput = {
  subject: string;
  title: string;
  // Already escaped. May contain <br> between escaped lines.
  preheaderHtml: string;
  bodyHtml: string;
  actionLabel: string;
  actionUrl: string;
  supportEmail: string;
  // Instance origin. The footer link text stays "Factrove".
  siteUrl: string;
  logoUrl: string;
  reason: string;
};

export function renderBrandedEmail(input: BrandedEmailInput): string {
  const subject = escapeHtml(input.subject);
  const title = escapeHtml(input.title);
  const actionUrl = escapeHtml(input.actionUrl);
  const actionLabel = escapeHtml(input.actionLabel);
  const supportEmail = escapeHtml(input.supportEmail);
  const reason = escapeHtml(input.reason);
  const siteUrl = escapeHtml(input.siteUrl.trim());
  return [
    "<!DOCTYPE html>",
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${subject}</title>`,
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
    `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${input.preheaderHtml}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#f5f6fc" style="background-color:#f5f6fc;">',
    "<tr>",
    '<td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container card" bgcolor="#ffffff" style="width:600px; max-width:600px; background-color:#ffffff; border:1px solid #e2e4f3; border-radius:14px;">',
    "<tr>",
    `<td class="pad" style="padding:32px 40px 8px 40px;">${renderMark(input.logoUrl)}</td>`,
    "</tr>",
    "<tr>",
    `<td class="pad ink" style="padding:16px 40px 0 40px; font-family:${FONT}; font-size:28px; line-height:1.15; font-weight:800; letter-spacing:-0.045em; color:#1b2037;">${title}</td>`,
    "</tr>",
    "<tr>",
    `<td class="pad muted welcome" style="padding:16px 40px 0 40px; font-family:${FONT}; font-size:16px; line-height:1.55; color:#4a4f6a; ${WRAP}">${input.bodyHtml}</td>`,
    "</tr>",
    "<tr>",
    '<td class="pad" align="left" style="padding:28px 40px 8px 40px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">',
    "<tr>",
    '<td class="btn" bgcolor="#5e64d6" style="border-radius:14px; background-color:#5e64d6;">',
    `<a href="${actionUrl}" style="display:inline-block; padding:14px 28px; font-family:${FONT}; font-size:16px; line-height:1.2; font-weight:700; color:#ffffff; text-decoration:none;">${actionLabel}</a>`,
    "</td>",
    "</tr>",
    "</table>",
    "</td>",
    "</tr>",
    "<tr>",
    `<td class="pad muted fallback" style="padding:8px 40px 28px 40px; font-family:${FONT}; font-size:14px; line-height:1.55; color:#4a4f6a; ${WRAP}">Or open this link:<br><a class="link" href="${actionUrl}" style="color:#5e64d6; ${WRAP}">${actionUrl}</a></td>`,
    "</tr>",
    "<tr>",
    `<td class="pad muted footer" style="padding:0 40px 32px 40px; font-family:${FONT}; font-size:13px; line-height:1.55; color:#4a4f6a; ${WRAP}">${reason}<br>Contact <a class="link" href="mailto:${supportEmail}" style="color:#5e64d6; ${WRAP}">${supportEmail}</a> if you need help.<br><a class="link" href="${siteUrl}" style="color:#5e64d6; ${WRAP}">Factrove</a></td>`,
    "</tr>",
    "</table>",
    "</td>",
    "</tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("");
}

export function renderMark(logoUrl: string): string {
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

export function oneLine(value: string): string {
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
