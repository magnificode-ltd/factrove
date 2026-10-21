// Decides which object stays live after a replace tries to commit.
// The new bytes are already in `newKey`. The row becomes live only when it points at that key.
// A later version can keep `previousKey` instead of deleting it. This still deletes it.

export type ContentPublishDecision = {
  outcome: "published" | "conflict" | "missing";
  deleteKey: string | null;
};

export function decideContentPublish(input: {
  newKey: string;
  previousKey: string;
  visibleKey: string | null;
}): ContentPublishDecision {
  if (input.visibleKey === input.newKey) {
    return {
      outcome: "published",
      deleteKey: input.previousKey === input.newKey ? null : input.previousKey,
    };
  }
  return {
    outcome: input.visibleKey === null ? "missing" : "conflict",
    deleteKey: input.newKey,
  };
}
