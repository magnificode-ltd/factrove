import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { cliEnvFilePath, loadCliEnv } from "../src/load-env.js";

describe("CLI env file", () => {
  it("points at apps/cli/.env beside the package", () => {
    expect(cliEnvFilePath().endsWith(`${sep}apps${sep}cli${sep}.env`)).toBe(true);
  });

  it("leaves the environment unchanged when the file is missing", () => {
    const env = { FACTROVE_API_URL: "http://127.0.0.1:3999" };
    loadCliEnv(env, join(tmpdir(), "factrove-cli-env-missing", ".env"));
    expect(env).toEqual({ FACTROVE_API_URL: "http://127.0.0.1:3999" });
  });

  it("fills blank FACTROVE_* names and ignores other keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-cli-env-"));
    const filePath = join(directory, ".env");
    await writeFile(
      filePath,
      [
        "FACTROVE_API_URL=http://127.0.0.1:4010",
        "FACTROVE_API_KEY=ftrv_from_file",
        "FACTROVE_PROFILE=dev",
        "FACTROVE_API_URL_BLANK=",
        "DATABASE_URL=postgresql://factrove:factrove@127.0.0.1:5432/factrove",
        "AWS_SECRET_ACCESS_KEY=secret",
        "S3_BUCKET=bucket",
        "NEXT_PUBLIC_API_URL=http://localhost:3001",
        "BETTER_AUTH_SECRET=local-only-factrove-auth-secret-change-me",
        "",
      ].join("\n"),
    );
    const env: NodeJS.ProcessEnv = {
      FACTROVE_API_URL: "   ",
      FACTROVE_CONFIG_DIR: "/tmp/already-set",
      PATH: "/usr/bin",
    };

    loadCliEnv(env, filePath);

    expect(env.FACTROVE_API_URL).toBe("http://127.0.0.1:4010");
    expect(env.FACTROVE_API_KEY).toBe("ftrv_from_file");
    expect(env.FACTROVE_PROFILE).toBe("dev");
    expect(env.FACTROVE_CONFIG_DIR).toBe("/tmp/already-set");
    expect(env.FACTROVE_API_URL_BLANK).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.S3_BUCKET).toBeUndefined();
    expect(env.NEXT_PUBLIC_API_URL).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("reports a file that cannot be read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-cli-env-dir-"));
    const filePath = join(directory, "not-a-file");
    await mkdir(filePath);
    expect(() => loadCliEnv({}, filePath)).toThrow();
  });
});
