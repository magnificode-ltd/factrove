import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  resolveBaseDatabaseUrl,
  type IsolatedDatabase,
} from "./isolated-database.js";

describe("test database connection", () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("prefers an environment-supplied URL and does not require an env file", () => {
    directory = mkdtempSync(join(tmpdir(), "factrove-env-"));
    const supplied = "postgres://env-user:env-pass@127.0.0.1:5432/from_env";
    expect(
      resolveBaseDatabaseUrl({
        env: { DATABASE_URL: supplied },
        envFilePath: join(directory, "missing.env"),
      }),
    ).toBe(supplied);
  });

  it("uses an env file only when the environment does not supply a URL", () => {
    directory = mkdtempSync(join(tmpdir(), "factrove-env-"));
    const envFilePath = join(directory, ".env");
    writeFileSync(envFilePath, 'DATABASE_URL="postgres://file-user:file-pass@127.0.0.1:5432/from_file"\n');
    expect(resolveBaseDatabaseUrl({ env: { DATABASE_URL: "  " }, envFilePath })).toBe(
      "postgres://file-user:file-pass@127.0.0.1:5432/from_file",
    );
  });

  it("reports a missing URL when neither the environment nor an env file provides one", () => {
    directory = mkdtempSync(join(tmpdir(), "factrove-env-"));
    expect(() =>
      resolveBaseDatabaseUrl({
        env: {},
        envFilePath: join(directory, "missing.env"),
      }),
    ).toThrow(/DATABASE_URL is required/);
  });
});

describe("isolated test databases", () => {
  const created: IsolatedDatabase[] = [];

  afterEach(async () => {
    const pending = created.splice(0);
    for (const database of pending) {
      await dropIsolatedDatabase(database);
    }
  });

  it("drops only the database created by that run", async () => {
    const [first, second] = await Promise.all([createIsolatedDatabase(), createIsolatedDatabase()]);
    created.push(first, second);
    expect(first.databaseName).not.toBe(second.databaseName);
    expect(first.databaseName).not.toBe("factrove_test");
    expect(second.databaseName).not.toBe("factrove_test");

    const marker = new Client({ connectionString: first.databaseUrl });
    await marker.connect();
    try {
      await marker.query("CREATE TABLE isolation_marker (id integer)");
    } finally {
      await marker.end();
    }

    await dropIsolatedDatabase(second);
    created.splice(created.indexOf(second), 1);

    const survivor = new Client({ connectionString: first.databaseUrl });
    await survivor.connect();
    try {
      const table = await survivor.query("SELECT to_regclass('public.isolation_marker')::text AS name");
      expect(table.rows[0]?.name).toBe("isolation_marker");
    } finally {
      await survivor.end();
    }

    const admin = new Client({ connectionString: first.adminUrl });
    await admin.connect();
    try {
      const dropped = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [second.databaseName]);
      const kept = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [first.databaseName]);
      expect(dropped.rowCount).toBe(0);
      expect(kept.rowCount).toBe(1);
    } finally {
      await admin.end();
    }
  });
});
