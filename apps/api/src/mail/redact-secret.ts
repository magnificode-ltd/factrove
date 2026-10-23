export function redactSecrets(message: string, secrets: ReadonlyArray<string | null | undefined>): string {
  const values = secrets.filter((secret): secret is string => typeof secret === "string" && secret.length > 0);
  values.sort((left, right) => right.length - left.length);
  let redacted = message;
  for (const secret of values) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

// A provider id we are willing to print. Angle brackets are the usual SMTP form.
const SAFE_MESSAGE_ID = /^(?:[A-Za-z0-9][A-Za-z0-9@._+-]{0,199}|<[A-Za-z0-9][A-Za-z0-9@._+-]{0,198}>)$/;

export function safeMessageId(
  value: string,
  secrets: ReadonlyArray<string | null | undefined>,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return null;
  }
  // Drop the whole id when it contains a secret. Redacting in place can leave a prefix.
  if (redactSecrets(trimmed, secrets) !== trimmed) {
    return null;
  }
  return SAFE_MESSAGE_ID.test(trimmed) ? trimmed : null;
}
