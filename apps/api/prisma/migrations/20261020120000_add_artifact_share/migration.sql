-- Public share capability. Null means the artifact is not shared.
-- Multiple null hashes are allowed. A present hash is unique.
ALTER TABLE "artifact" ADD COLUMN "share_token" TEXT;
ALTER TABLE "artifact" ADD COLUMN "share_token_hash" TEXT;

CREATE UNIQUE INDEX "artifact_share_token_hash_key" ON "artifact"("share_token_hash");
