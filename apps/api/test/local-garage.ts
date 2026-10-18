import { prepareLocalGarageEnv } from "../../../scripts/local-runtime.mjs";
import { readS3StorageConfig, type S3StorageConfig } from "../src/storage/providers/s3.provider.js";

export function useLocalGarage(): S3StorageConfig {
  const endpoint = prepareLocalGarageEnv(process.env, {
    garagePort: process.env.FACTROVE_GARAGE_PORT,
  });
  const config = readS3StorageConfig();
  if (config.endpoint !== endpoint) {
    throw new Error("The effective S3 endpoint must be an http loopback origin.");
  }
  return config;
}
