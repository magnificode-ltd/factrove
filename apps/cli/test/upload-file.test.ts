import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_HTML_BYTES, readUploadFile } from "../src/upload-file.service.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("upload file validation", () => {
  it("reads a regular HTML file and keeps its basename", async () => {
    const directory = await makeTemp();
    const nested = join(directory, "reports");
    await mkdir(nested);
    const source = join(nested, "my report.HTML");
    const contents = Uint8Array.from([0x3c, 0x70, 0x3e, 0xff, 0x3c, 0x2f, 0x70, 0x3e]);
    await writeFile(source, contents);

    const upload = await readUploadFile(source);

    expect(upload.filename).toBe("my report.HTML");
    expect(upload.bytes).toEqual(contents);
  });

  it("follows a symlink and uses the link basename", async () => {
    const directory = await makeTemp();
    const target = join(directory, "target.html");
    const link = join(directory, "linked.htm");
    await writeFile(target, "<p>linked</p>");
    await symlink(target, link);

    const upload = await readUploadFile(link);

    expect(upload.filename).toBe("linked.htm");
    expect(Buffer.from(upload.bytes).toString("utf8")).toBe("<p>linked</p>");
  });

  it("accepts a file at the 10 MiB limit and rejects a larger one before reading it all into an upload", async () => {
    const directory = await makeTemp();
    const exact = join(directory, "exact.html");
    const oversize = join(directory, "oversize.html");
    await writeFile(exact, Buffer.alloc(MAX_HTML_BYTES, 0x61));
    await writeFile(oversize, Buffer.alloc(MAX_HTML_BYTES + 1, 0x61));

    await expect(readUploadFile(exact)).resolves.toMatchObject({ filename: "exact.html" });
    await expect(readUploadFile(oversize)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "The file exceeds the 10 MiB limit.",
    });
  });

  it("reports missing files, directories, empty files, and unsupported extensions", async () => {
    const directory = await makeTemp();
    const empty = join(directory, "empty.html");
    const text = join(directory, "notes.txt");
    await writeFile(empty, "");
    await writeFile(text, "<p>nope</p>");

    await expect(readUploadFile(join(directory, "missing.html"))).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
    await expect(readUploadFile(directory)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: `Path is a directory: ${directory}`,
    });
    await expect(readUploadFile(empty)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "The HTML file is empty.",
    });
    await expect(readUploadFile(text)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Only .html and .htm files are supported.",
    });
  });
});

async function makeTemp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "factrove-cli-"));
  directories.push(directory);
  return directory;
}
