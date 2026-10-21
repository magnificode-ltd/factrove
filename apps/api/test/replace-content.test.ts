import { describe, expect, it } from "vitest";
import { decideContentPublish } from "../src/services/replace-content.js";

describe("decideContentPublish", () => {
  it("keeps the new key and drops the previous key when the row points at the new object", () => {
    expect(decideContentPublish({
      newKey: "id/new.html",
      previousKey: "id/old.html",
      visibleKey: "id/new.html",
    })).toEqual({ outcome: "published", deleteKey: "id/old.html" });
  });

  it("does not delete the only key when the previous and new keys are the same", () => {
    expect(decideContentPublish({
      newKey: "id/same.html",
      previousKey: "id/same.html",
      visibleKey: "id/same.html",
    })).toEqual({ outcome: "published", deleteKey: null });
  });

  it("drops the unpublished object when another replace is current", () => {
    expect(decideContentPublish({
      newKey: "id/ours.html",
      previousKey: "id/old.html",
      visibleKey: "id/theirs.html",
    })).toEqual({ outcome: "conflict", deleteKey: "id/ours.html" });
  });

  it("drops the unpublished object when the row is gone", () => {
    expect(decideContentPublish({
      newKey: "id/ours.html",
      previousKey: "id/old.html",
      visibleKey: null,
    })).toEqual({ outcome: "missing", deleteKey: "id/ours.html" });
  });
});
