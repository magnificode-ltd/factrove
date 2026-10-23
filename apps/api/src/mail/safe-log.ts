// The last step of a detached invite. A throw here becomes an unhandled rejection.
const LOGGER_FAILED = "Logger failed.";

export function logWithoutThrowing(write: (message: string) => void, message: string): void {
  try {
    write(message);
  } catch {
    try {
      // The logger error is not printed. Its text can hold a secret, and reading
      // it can throw.
      console.error(`${message}\n${LOGGER_FAILED}`);
    } catch {
      // console.error failed. Swallow it so the process stays up.
    }
  }
}
