import { Module } from "@nestjs/common";
import { BLOB_STORE } from "./blob-store.js";
import { S3BlobStore } from "./providers/s3.provider.js";

@Module({
  providers: [
    {
      provide: BLOB_STORE,
      useFactory: () => new S3BlobStore(),
    },
  ],
  exports: [BLOB_STORE],
})
export class StorageModule {}
