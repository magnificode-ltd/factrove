// Publishes the bytes readers see for an artifact.
// The object stays at the derived key `{artifactId}.html`. A later change can
// keep `previous` as a version before `write` replaces it. This does not.

export class ArtifactRowMissing extends Error {
  constructor() {
    super("Artifact row was removed during content replace");
    this.name = "ArtifactRowMissing";
  }
}

export class ContentRestoreFailed extends Error {
  readonly cause: unknown;
  readonly restoreError: unknown;

  constructor(cause: unknown, restoreError: unknown) {
    super("Could not restore artifact content");
    this.name = "ContentRestoreFailed";
    this.cause = cause;
    this.restoreError = restoreError;
  }
}

export async function publishCurrentContent(input: {
  previous: Uint8Array | null;
  next: Uint8Array;
  write: (bytes: Uint8Array) => Promise<void>;
  record: () => Promise<void>;
}): Promise<void> {
  await input.write(input.next);
  try {
    await input.record();
  } catch (error) {
    if (input.previous === null) {
      throw error;
    }
    try {
      await input.write(input.previous);
    } catch (restoreError) {
      throw new ContentRestoreFailed(error, restoreError);
    }
    throw error;
  }
}
