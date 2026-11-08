import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LoadingArtifact from "../src/app/(browse)/artifacts/[id]/loading";
import { ViewerBar } from "../src/components/chrome";

function elementByText(html: string, text: string): string {
  const elements = html.match(/<([a-z0-9]+)\b[^>]*>[^<]*<\/\1>/g) ?? [];
  const found = elements.find((element) => element.includes(`>${text}<`));
  if (!found) {
    throw new Error(`Missing element containing ${text}`);
  }
  return found;
}

function classNames(element: string): string[] {
  const className = element.match(/\bclass="([^"]*)"/)?.[1];
  if (!className) {
    throw new Error(`Missing class on ${element}`);
  }
  return className.split(/\s+/).filter(Boolean).sort();
}

describe("artifact loading screen", () => {
  it("keeps the library link's place without offering the link", () => {
    const html = renderToStaticMarkup(<LoadingArtifact />);
    const linked = renderToStaticMarkup(<ViewerBar title="Artifact" />);
    const slot = elementByText(html, "Back to library");
    const link = elementByText(linked, "Back to library");
    const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];

    expect(html).toContain("Loading artifact…");
    expect(html).toContain('role="status"');
    expect(html).toContain(">Artifact</h1>");
    expect(html).toContain("h-8 w-56");
    expect(html).toContain("h-80 w-full rounded-2xl");
    expect(html.match(/Back to library/g)).toHaveLength(1);
    expect(anchors.some((anchor) => anchor.includes("Back to library"))).toBe(false);
    expect(slot.startsWith("<span")).toBe(true);
    expect(slot).toContain('aria-hidden="true"');
    expect(slot).toContain('tabindex="-1"');
    expect(slot).not.toContain("href");
    expect(link.startsWith("<a")).toBe(true);
    expect(link).toContain('href="/"');

    const slotClasses = classNames(slot);
    const linkClasses = classNames(link);
    expect(slotClasses).toContain("invisible");
    expect(slotClasses.filter((name) => name !== "invisible")).toEqual(linkClasses);
  });
});
