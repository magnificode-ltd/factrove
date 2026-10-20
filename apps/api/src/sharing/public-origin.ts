// Browser origins that may frame artifact HTML and call the API.
// Share links and later embeds use publicBaseUrl. The owner app may still be webOrigin.
export function browserOrigins(webOrigin: string, publicBaseUrl: string): readonly string[] {
  if (webOrigin === publicBaseUrl) {
    return [publicBaseUrl];
  }
  return [publicBaseUrl, webOrigin];
}
