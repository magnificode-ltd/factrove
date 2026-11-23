export function redirect(path: string): never {
  throw new Error(`REDIRECT ${path}`);
}
