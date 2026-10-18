import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import {
  HtmlConversionError,
  MARKDOWN_CONVERSION_TIMEOUT_MS,
  MARKDOWN_WORKER_OLD_GENERATION_MB,
  MAX_MARKDOWN_INPUT_BYTES,
  type HtmlConversionLimit,
} from "./html-to-markdown.js";

type WorkerResponse =
  | { ok: true; markdown: string }
  | { ok: false; message: string; limit?: HtmlConversionLimit };

export function convertHtmlToMarkdown(html: string): Promise<string> {
  if (Buffer.byteLength(html) > MAX_MARKDOWN_INPUT_BYTES) {
    return Promise.reject(new HtmlConversionError("HTML exceeds the Markdown conversion limit.", { limit: "input" }));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const target = workerTarget();
    const worker = new Worker(target.filename, {
      workerData: { html },
      resourceLimits: {
        maxOldGenerationSizeMb: MARKDOWN_WORKER_OLD_GENERATION_MB,
        maxYoungGenerationSizeMb: 48,
      },
      execArgv: target.execArgv,
    });

    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      settle();
    };

    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(new HtmlConversionError("HTML took too long to convert to Markdown.", { limit: "time" }));
      });
    }, MARKDOWN_CONVERSION_TIMEOUT_MS);

    worker.once("message", (message: WorkerResponse) => {
      finish(() => {
        if (message.ok) {
          resolve(message.markdown);
          return;
        }
        if (message.limit) {
          reject(new HtmlConversionError(message.message, { limit: message.limit }));
          return;
        }
        reject(new Error(message.message));
      });
    });

    worker.once("error", (error) => {
      finish(() => {
        if (isMemoryError(error)) {
          reject(new HtmlConversionError("HTML used too much memory to convert to Markdown.", { limit: "memory", cause: error }));
          return;
        }
        reject(error);
      });
    });

    worker.once("exit", (code) => {
      setImmediate(() => {
        finish(() => {
          if (code === 0) {
            reject(new Error("Markdown conversion ended without a result."));
            return;
          }
          reject(new HtmlConversionError("HTML used too much memory to convert to Markdown.", { limit: "memory" }));
        });
      });
    });
  });
}

function workerTarget(): { filename: URL; execArgv?: string[] } {
  if (import.meta.url.endsWith(".ts")) {
    return {
      filename: new URL("./html-to-markdown.worker.ts", import.meta.url),
      execArgv: ["--import", fileURLToPath(new URL("./register-worker-typescript.mjs", import.meta.url))],
    };
  }
  return {
    filename: new URL("./html-to-markdown.worker.js", import.meta.url),
  };
}

function isMemoryError(error: Error): boolean {
  const code = "code" in error ? error.code : undefined;
  return code === "ERR_WORKER_OUT_OF_MEMORY" || /out of memory/i.test(error.message);
}
