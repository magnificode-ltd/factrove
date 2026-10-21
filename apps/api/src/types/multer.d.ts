declare module "multer" {
  interface Options {
    defParamCharset?: string;
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
      fieldSize?: number;
      parts?: number;
    };
  }

  interface Multer {
    single(field: string): (request: unknown, response: unknown, callback: (error?: unknown) => void) => void;
  }

  function multer(options?: Options): Multer;
  export default multer;
}
