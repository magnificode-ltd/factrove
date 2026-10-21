-- The current HTML object and its size live on the same row.
-- Existing objects stay at `{id}.html`. New writes use `{id}/{contentId}.html`.
ALTER TABLE "artifact" ADD COLUMN "object_key" TEXT;
UPDATE "artifact" SET "object_key" = "id"::text || '.html' WHERE "object_key" IS NULL;
ALTER TABLE "artifact" ALTER COLUMN "object_key" SET NOT NULL;
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_object_key_not_blank" CHECK (length(btrim("object_key")) > 0);

-- A replace commits only when this value is still the one it read.
ALTER TABLE "artifact" ADD COLUMN "content_revision" INTEGER NOT NULL DEFAULT 0;
