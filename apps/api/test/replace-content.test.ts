import { describe, expect, it } from "vitest";
import { ArtifactRowMissing, ContentRestoreFailed, publishCurrentContent } from "../src/services/replace-content.js";

describe("publishCurrentContent", () => {
  it("writes the new bytes before it records metadata", async () => {
    const writes: Uint8Array[] = [];
    const order: string[] = [];
    await publishCurrentContent({
      previous: bytes("old"),
      next: bytes("new"),
      write: async (value) => {
        order.push("write");
        writes.push(value);
      },
      record: async () => {
        order.push("record");
      },
    });
    expect(order).toEqual(["write", "record"]);
    expect(text(writes[0])).toBe("new");
  });

  it("restores the previous bytes when recording the row fails", async () => {
    const writes: string[] = [];
    const failure = new Error("database unavailable");
    await expect(publishCurrentContent({
      previous: bytes("old"),
      next: bytes("new"),
      write: async (value) => {
        writes.push(text(value));
      },
      record: async () => {
        throw failure;
      },
    })).rejects.toBe(failure);
    expect(writes).toEqual(["new", "old"]);
  });

  it("leaves the new bytes in place when there is nothing to restore", async () => {
    const writes: string[] = [];
    await expect(publishCurrentContent({
      previous: null,
      next: bytes("new"),
      write: async (value) => {
        writes.push(text(value));
      },
      record: async () => {
        throw new ArtifactRowMissing();
      },
    })).rejects.toBeInstanceOf(ArtifactRowMissing);
    expect(writes).toEqual(["new"]);
  });

  it("reports a failed restore and keeps the original error", async () => {
    const failure = new Error("database unavailable");
    const restoreError = new Error("storage unavailable");
    let writes = 0;
    const error = await publishCurrentContent({
      previous: bytes("old"),
      next: bytes("new"),
      write: async () => {
        writes += 1;
        if (writes === 2) {
          throw restoreError;
        }
      },
      record: async () => {
        throw failure;
      },
    }).then(
      () => {
        throw new Error("replace should have failed");
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ContentRestoreFailed);
    expect(error).toMatchObject({ cause: failure, restoreError });
  });

  it("does not record metadata when the first write fails", async () => {
    let recorded = false;
    await expect(publishCurrentContent({
      previous: bytes("old"),
      next: bytes("new"),
      write: async () => {
        throw new Error("first write failed");
      },
      record: async () => {
        recorded = true;
      },
    })).rejects.toThrow("first write failed");
    expect(recorded).toBe(false);
  });
});

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function text(value: Uint8Array | undefined): string {
  return new TextDecoder().decode(value);
}
