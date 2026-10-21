ALTER TABLE "artifact" ADD CONSTRAINT "artifact_share_columns_paired_check"
  CHECK (("share_token" IS NULL) = ("share_token_hash" IS NULL)) NOT VALID;

ALTER TABLE "artifact" VALIDATE CONSTRAINT "artifact_share_columns_paired_check";
