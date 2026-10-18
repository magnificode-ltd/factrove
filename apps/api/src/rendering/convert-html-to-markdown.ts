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

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_QUEUE = 2;

let activeConversions = 0;
const conversionWaiters: Array<() => void> = [];

export function convertHtmlToMarkdown(html: string): Promise<string> {
  if (Buffer.byteLength(html) > MAX_MARKDOWN_INPUT_BYTES) {
    return Promise.reject(new HtmlConversionError("HTML exceeds the Markdown conversion limit.", { limit: "input" }));
  }
  return withMarkdownConversionSlot(() => convertHtmlInWorker(html));
}

export function withMarkdownConversionSlot<T>(job: () => Promise<T>): Promise<T> {
  return acquireMarkdownConversionSlot().then(() =>
    Promise.resolve()
      .then(job)
      .finally(releaseMarkdownConversionSlot),
  );
}

function acquireMarkdownConversionSlot(): Promise<void> {
  const limits = readPoolLimits();
  if (activeConversions < limits.concurrency) {
    activeConversions += 1;
    return Promise.resolve();
  }
  if (conversionWaiters.length >= limits.queue) {
    return Promise.reject(new HtmlConversionError("Markdown conversion is busy. Try again.", { limit: "busy" }));
  }
  return new Promise((resolve) => {
    conversionWaiters.push(resolve);
  });
}

function releaseMarkdownConversionSlot(): void {
  const next = conversionWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeConversions -= 1;
}

function readPoolLimits(): { concurrency: number; queue: number } {
  return {
    concurrency: readBoundedInt("MARKDOWN_CONVERSION_CONCURRENCY", DEFAULT_CONCURRENCY, 1, 4),
    queue: readBoundedInt("MARKDOWN_CONVERSION_QUEUE", DEFAULT_QUEUE, 0, 8),
  };
}

function readBoundedInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function convertHtmlInWorker(html: string): Promise<string> {
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
