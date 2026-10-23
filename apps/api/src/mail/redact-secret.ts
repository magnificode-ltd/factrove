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
  // Compare the raw id and the trimmed id. A secret with surrounding spaces
  // would not match the trimmed id, and the log would keep the password.
  if (containsConfiguredSecret(value, secrets) || containsConfiguredSecret(trimmed, secrets)) {
    return null;
  }
  return SAFE_MESSAGE_ID.test(trimmed) ? trimmed : null;
}

function containsConfiguredSecret(value: string, secrets: ReadonlyArray<string | null | undefined>): boolean {
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length === 0) {
      continue;
    }
    if (value.includes(secret)) {
      return true;
    }
    const trimmedSecret = secret.trim();
    if (trimmedSecret.length > 0 && trimmedSecret !== secret && value.includes(trimmedSecret)) {
      return true;
    }
  }
  return false;
}
