type CookieJar = {
  get: (name: string) => { name: string; value: string } | undefined;
  delete: (name: string) => void;
  toString: () => string;
};

export async function cookies(): Promise<CookieJar> {
  const jar = (globalThis as { __factroveGateJar?: CookieJar }).__factroveGateJar;
  if (!jar) {
    throw new Error("cookies() test jar is not set");
  }
  return jar;
}
