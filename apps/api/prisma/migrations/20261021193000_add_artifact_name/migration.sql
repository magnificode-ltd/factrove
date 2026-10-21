-- Human-readable library name. Existing rows stay null.
ALTER TABLE "artifact" ADD COLUMN "name" VARCHAR(120);
