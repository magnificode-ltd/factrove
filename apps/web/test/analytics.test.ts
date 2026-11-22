import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyticsPageUrl,
  browserTrackingDisabled,
  capturePageview,
  posthogInitOptions,
  resetAnalyticsForTests,
  sanitizeAnalyticsPath,
  sanitizeAnalyticsUrl,
  sanitizePosthogCapture,
  startAnalytics,
  type AnalyticsClient,
} from "../src/analytics";
import { DEFAULT_POSTHOG_HOST } from "../src/public-config";

const ARTIFACT_ID = "123e4567-e89b-42d3-a456-426614174000";
const SHARE_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-ABC";
const PROJECT_KEY = "phc_testkey123";

afterEach(() => {
  resetAnalyticsForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("analytics privacy", () => {
  it("drops queries, hashes, artifact ids, share tokens, and file names from captured URLs", () => {
    const share = `/share/${ARTIFACT_ID}/${SHARE_TOKEN}`;
    expect(sanitizeAnalyticsPath(`${share}?password=secret&access=grant#token`)).toBe("/share/:id/:id");
    expect(sanitizeAnalyticsPath(`/artifacts/${ARTIFACT_ID}.html`)).toBe("/artifacts/:id");
    expect(sanitizeAnalyticsPath("/reset-password?token=header.payload.sig")).toBe("/reset-password");
    expect(sanitizeAnalyticsPath("/verify-email?token=header.payload.sig#inbox")).toBe("/verify-email");
    expect(sanitizeAnalyticsPath("/account/api-keys")).toBe("/account/api-keys");
    expect(sanitizeAnalyticsPath("/forgot-password")).toBe("/forgot-password");
    expect(sanitizeAnalyticsPath(`/login/user%40example.com`)).toBe("/login/:id");
    expect(sanitizeAnalyticsPath("/library/ftrv_secretkeyvalue")).toBe("/library/:id");
    expect(
      sanitizeAnalyticsUrl(
        `https://library.example.com${share}?password=hunter2&email=person@example.com#section`,
      ),
    ).toBe("https://library.example.com/share/:id/:id");
    expect(analyticsPageUrl(`/artifacts/${ARTIFACT_ID}?access=grant`, "https://library.example.com")).toEqual({
      path: "/artifacts/:id",
      url: "https://library.example.com/artifacts/:id",
    });
  });

  it("strips identifying fields and blocks identify before an event is sent", () => {
    const page = sanitizePosthogCapture({
      event: "$pageview",
      properties: {
        $current_url: `https://library.example.com/share/${ARTIFACT_ID}/${SHARE_TOKEN}?password=secret`,
        $pathname: `/share/${ARTIFACT_ID}/${SHARE_TOKEN}`,
        $referrer: "https://mail.example.com/reset-password?token=abc&email=person@example.com",
        title: "Quarterly plan",
        $title: "Quarterly plan",
        email: "person@example.com",
        name: "Ada Lovelace",
        filename: "plan.html",
        token: PROJECT_KEY,
        share_token: SHARE_TOKEN,
      },
      $set: { email: "person@example.com" },
    });
    expect(page?.properties).toEqual({
      $current_url: "https://library.example.com/share/:id/:id",
      $pathname: "/share/:id/:id",
      $referrer: "https://mail.example.com/reset-password",
      token: PROJECT_KEY,
    });
    expect(page).not.toHaveProperty("$set");
    expect(JSON.stringify(page)).not.toContain(ARTIFACT_ID);
    expect(JSON.stringify(page)).not.toContain(SHARE_TOKEN);
    expect(JSON.stringify(page)).not.toContain("person@example.com");
    expect(JSON.stringify(page)).not.toContain("Quarterly plan");
    expect(JSON.stringify(page)).not.toContain("Ada Lovelace");
    expect(JSON.stringify(page)).not.toContain("plan.html");
    expect(sanitizePosthogCapture({ event: "$identify", properties: { email: "person@example.com" } })).toBeNull();
    expect(sanitizePosthogCapture({ event: "$autocapture", properties: { $el_text: "Quarterly plan" } })).toBeNull();
  });

  it("initializes cookieless pageviews without autocapture, recording, or identify", () => {
    const options = posthogInitOptions("https://posthog.example.com");
    expect(options).toMatchObject({
      api_host: "https://posthog.example.com",
      persistence: "memory",
      cookieless_mode: "always",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      respect_dnt: true,
      person_profiles: "never",
      advanced_disable_flags: true,
    });
    expect(options.property_denylist).toEqual(expect.arrayContaining(["title", "$title"]));
    expect(options.property_denylist).not.toContain("token");
    expect(options.get_current_url(`https://library.example.com/artifacts/${ARTIFACT_ID}?access=grant`)).toBe(
      "https://library.example.com/artifacts/:id",
    );
    expect(browserTrackingDisabled({ navigator: { doNotTrack: "1" } })).toBe(true);
    expect(browserTrackingDisabled({ navigator: { globalPrivacyControl: true } })).toBe(true);
    expect(browserTrackingDisabled({ navigator: { doNotTrack: "0" } })).toBe(false);
  });
});

describe("analytics loading", () => {
  it("does not load posthog-js or send requests when the key is unset", async () => {
    const load = vi.fn();
    const fetchSpy = vi.fn();
    const xhr = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhr);
    await expect(startAnalytics(undefined, load)).resolves.toBeUndefined();
    await expect(startAnalytics({ key: "   ", host: DEFAULT_POSTHOG_HOST }, load)).resolves.toBeUndefined();
    await expect(startAnalytics({ key: "phx_personal_secret", host: "https://evil.example" }, load)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });

  it("does not load posthog-js when Do Not Track is set", async () => {
    const load = vi.fn();
    vi.stubGlobal("window", { navigator: { doNotTrack: "1" }, doNotTrack: "1" });
    await expect(startAnalytics({ key: PROJECT_KEY, host: DEFAULT_POSTHOG_HOST }, load)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it("loads posthog-js only after a public project key is set", async () => {
    const init = vi.fn();
    const capture = vi.fn();
    const client: AnalyticsClient = { init, capture };
    const load = vi.fn(async () => ({ default: client }));
    const started = await startAnalytics({ key: PROJECT_KEY, host: "https://posthog.example.com/" }, load);
    expect(load).toHaveBeenCalledOnce();
    expect(started).toBe(client);
    const options = init.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      api_host: "https://posthog.example.com",
      persistence: "memory",
      cookieless_mode: "always",
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      respect_dnt: true,
      person_profiles: "never",
      advanced_disable_flags: true,
    });
    expect(options?.property_denylist).not.toContain("token");
    expect(options?.get_current_url(`https://library.example.com/artifacts/${ARTIFACT_ID}?access=grant`)).toBe(
      "https://library.example.com/artifacts/:id",
    );
    expect(options?.before_send({ event: "$identify", properties: { email: "person@example.com" } })).toBeNull();
    capturePageview(client, `/share/${ARTIFACT_ID}/${SHARE_TOKEN}?password=secret`, "https://library.example.com");
    expect(capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "https://library.example.com/share/:id/:id",
      $pathname: "/share/:id/:id",
    });
    await startAnalytics({ key: PROJECT_KEY, host: "https://posthog.example.com" }, load);
    expect(load).toHaveBeenCalledOnce();
  });
});
