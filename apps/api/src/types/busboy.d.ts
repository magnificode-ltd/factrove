declare module "busboy" {
  import type { IncomingHttpHeaders } from "node:http";
  import type { Readable, Writable } from "node:stream";

  interface BusboyFileInfo {
    filename?: string;
    encoding: string;
    mimeType: string;
  }

  interface BusboyFieldInfo {
    nameTruncated: boolean;
    valueTruncated: boolean;
  }

  interface BusboyParser extends Writable {
    on(event: "file", listener: (name: string | undefined, stream: Readable, info: BusboyFileInfo) => void): this;
    on(event: "field", listener: (name: string | undefined, value: string, info: BusboyFieldInfo) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "filesLimit" | "fieldsLimit" | "partsLimit", listener: () => void): this;
  }

  interface BusboyOptions {
    headers?: IncomingHttpHeaders;
    defParamCharset?: string;
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
      fieldSize?: number;
      parts?: number;
    };
  }

  function Busboy(options: BusboyOptions): BusboyParser;
  export default Busboy;
}
