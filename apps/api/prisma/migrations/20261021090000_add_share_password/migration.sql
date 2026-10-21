-- Optional password for a public share, stored as an Argon2id PHC string.
-- A password exists only while the share does. Stop sharing clears both.
ALTER TABLE "artifact" ADD COLUMN "share_password_hash" TEXT;

ALTER TABLE "artifact" ADD CONSTRAINT "artifact_share_password_requires_share_check"
  CHECK ("share_password_hash" IS NULL OR "share_token_hash" IS NOT NULL);
