import "reflect-metadata";
import type { PrismaClient } from "@prisma/client";
import { Logger } from "@nestjs/common";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/create-auth.js";
import { InviteMailer } from "../src/mail/invite-mailer.js";
import type { ApiConfig } from "../src/services/api-config.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";

describe("invite failure process", () => {
  it("does not exit when the failure logger and console.error throw", async () => {
    const unhandled: unknown[] = [];
    const crashes: string[] = [];
    process.on("unhandledRejection", (reason) => {
      unhandled.push(reason);
    });
    process.on("uncaughtException", (error) => {
      crashes.push(error instanceof Error ? error.message : String(error));
    });

    let fallbacks = 0;
    const originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      const text = args.map((part) => String(part)).join(" ");
      if (text.includes("Invite email failed") || text.includes("Logger failed")) {
        fallbacks += 1;
        throw new Error("console exploded");
      }
      originalConsoleError(...args);
    };
    const originalLoggerError = Logger.prototype.error;
    Logger.prototype.error = () => {
      throw new Error("logger exploded");
    };

    try {
      const mailer = new InviteMailer({
        async send() {
          throw new Error("provider down");
        },
      }, workerConfig());
      await mailer.sendInvite({
        email: "magnificode+factrove@mail.grokbot.com",
        name: "Ada Lovelace",
      });
      await flush();

      const auth = createAuth({
        prisma: {} as PrismaClient,
        database: memoryAdapter({
          user: [],
          session: [],
          account: [],
          verification: [],
          apikey: [],
        }),
        baseURL: "http://localhost:3001",
        secret: TEST_AUTH_SECRET,
        trustedOrigins: ["http://localhost:3000"],
        cookieDomain: null,
        webOrigin: "http://localhost:3000",
        onUserCreated: async () => {
          throw new Error("hook exploded");
        },
        sendPasswordResetEmail: async () => {},
        sendVerificationEmail: async () => {},
      });
      const response = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada+factrove@mail.grokbot.com",
          password: "local-invite-check-1",
        }),
      }));
      expect(response.status).toBe(200);
      await flush();

      expect(unhandled).toEqual([]);
      expect(crashes).toEqual([]);
      expect(fallbacks).toBeGreaterThanOrEqual(2);
      expect(process.exitCode ?? 0).toBe(0);
      console.log("invite-failure-process-ok");
    } finally {
      Logger.prototype.error = originalLoggerError;
      console.error = originalConsoleError;
    }
  });
});

function workerConfig(): ApiConfig {
  return {
    host: "127.0.0.1",
    port: 3001,
    webOrigin: "http://localhost:3000",
    apiPublicOrigin: "http://localhost:3001",
    publicBaseUrl: "http://localhost:3000",
    authSecret: TEST_AUTH_SECRET,
    authCookieDomain: null,
    trustedProxies: [],
    shareTokenKey: null,
    emailTransport: "log",
    emailFromAddress: "support@factrove.app",
    emailFromName: "Factrove",
    emailLogoUrl: null,
    brevoApiKey: null,
    smtp: null,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
