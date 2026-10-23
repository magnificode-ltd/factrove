// The last step of a detached invite. A throw here becomes an unhandled rejection.
export function logWithoutThrowing(write: (message: string) => void, message: string): void {
  try {
    try {
      write(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "logger failed";
      console.error(`${message}\nLogger failed: ${detail}`);
    }
  } catch {
    // console.error failed. Swallow it so the process stays up.
  }
}
