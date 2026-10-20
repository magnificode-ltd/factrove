import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { assignClientIp, CLIENT_IP_HEADER, resolveClientIp } from "../src/auth/client-ip.js";

describe("client IP", () => {
  it("uses the socket address and drops a spoofed forwarding header", () => {
    const request = fakeRequest("::ffff:127.0.0.1", {
      "x-forwarded-for": "203.0.113.9",
      [CLIENT_IP_HEADER]: "198.51.100.4",
    });
    assignClientIp(request, []);
    expect(request.headers[CLIENT_IP_HEADER]).toBe("127.0.0.1");
    expect(resolveClientIp("192.0.2.10", "203.0.113.5, 10.0.0.4", ["10.0.0.0/8"])).toBe("192.0.2.10");
  });

  it("uses the right-most untrusted hop when the peer is a trusted proxy", () => {
    expect(resolveClientIp("10.0.0.8", "203.0.113.8, 10.0.0.4", ["10.0.0.0/8"])).toBe("203.0.113.8");
    expect(resolveClientIp("10.1.2.3", "198.51.100.7, 172.16.0.2", ["10.0.0.0/8", "172.16.0.0/12"])).toBe("198.51.100.7");
    expect(resolveClientIp("::ffff:10.0.0.8", "203.0.113.4, not-an-ip", ["10.0.0.0/8"])).toBe("10.0.0.8");
    expect(resolveClientIp("10.0.0.8", "10.0.0.2, 10.0.0.4", ["10.0.0.0/8"])).toBe("10.0.0.8");
    expect(resolveClientIp("10.0.0.8", undefined, ["10.0.0.0/8"])).toBe("10.0.0.8");
  });
});

function fakeRequest(remoteAddress: string, headers: Record<string, string>): IncomingMessage {
  return {
    headers: { ...headers },
    socket: { remoteAddress },
  } as IncomingMessage;
}
