import { normalizeOrganizationName } from "@factrove/contracts";

// Same display-name rule as the organization backfill. The trimmed user name
// wins. An empty name uses the email local part. A result the create endpoint
// would reject becomes "Organization".
export function backfillOrganizationDisplayName(name: string, email: string): string {
  const trimmedName = name.trim();
  const base = trimmedName.length > 0 ? trimmedName : emailLocalPart(email).trim();
  if (base.length === 0) {
    return "Organization";
  }
  return normalizeOrganizationName(`${base}'s organization`) ?? "Organization";
}

function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}
