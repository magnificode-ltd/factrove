import { parentPort, workerData } from "node:worker_threads";
import { HtmlConversionError, htmlToMarkdown, type HtmlConversionLimit } from "./html-to-markdown.js";

type WorkerRequest = {
  html: string;
};

type WorkerResponse =
  | { ok: true; markdown: string }
  | { ok: false; message: string; limit?: HtmlConversionLimit };

const request = workerData as WorkerRequest;

try {
  const markdown = htmlToMarkdown(request.html);
  parentPort?.postMessage({ ok: true, markdown } satisfies WorkerResponse);
} catch (error) {
  if (error instanceof HtmlConversionError) {
    parentPort?.postMessage({
      ok: false,
      message: error.message,
      limit: error.limit,
    } satisfies WorkerResponse);
  } else {
    parentPort?.postMessage({
      ok: false,
      message: "HTML could not be converted to Markdown.",
    } satisfies WorkerResponse);
  }
}
