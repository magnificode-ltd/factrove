import { CliError } from "./cli-error.js";

export function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

/** Reads one line from a TTY without echoing it. Bytes after the line ending are dropped. */
export async function promptSecret(prompt: string, cancelMessage: string): Promise<string> {
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    const chunks: number[] = [];
    const input = process.stdin;
    const onData = (buffer: Buffer): void => {
      for (const byte of buffer) {
        if (byte === 0x03 || byte === 0x04) {
          cleanup();
          process.stderr.write("\n");
          reject(new CliError("INVALID_INPUT", cancelMessage));
          return;
        }
        if (byte === 0x0d || byte === 0x0a) {
          cleanup();
          process.stderr.write("\n");
          resolve(Buffer.from(chunks).toString("utf8"));
          return;
        }
        if (byte === 0x7f || byte === 0x08) {
          // Drop a whole UTF-8 character: its continuation bytes, then its lead byte.
          while (chunks.length > 0 && ((chunks[chunks.length - 1] ?? 0) & 0xc0) === 0x80) {
            chunks.pop();
          }
          chunks.pop();
          continue;
        }
        chunks.push(byte);
      }
    };
    const cleanup = (): void => {
      input.off("data", onData);
      if (input.isTTY) {
        input.setRawMode(false);
      }
      input.pause();
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}
