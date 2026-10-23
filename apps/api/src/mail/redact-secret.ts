export function redactSecrets(message: string, secrets: ReadonlyArray<string | null | undefined>): string {
  const values = secrets.filter((secret): secret is string => typeof secret === "string" && secret.length > 0);
  values.sort((left, right) => right.length - left.length);
  let redacted = message;
  for (const secret of values) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}
