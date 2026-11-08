import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { artifactReturnPath, authPageHref } from "../src/auth/return-path";
import { SignInGate } from "../src/components/sign-in-gate";
import { ViewerScreen } from "../src/viewer/viewer-screen";

const artifactId = "123e4567-e89b-42d3-a456-426614174000";
const returnTo = artifactReturnPath(artifactId);
const message = "Sign in to continue.";
const valueStatement = "Factrove is a self-hostable home for artifacts created by people and agents.";

function heading(html: string): string {
  return html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
}

describe("SignInGate", () => {
  it("centers a branded card with the readme value line and both auth paths", () => {
    const html = renderToStaticMarkup(<SignInGate message={message} returnTo={returnTo} />);
    const title = heading(html);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(title).toContain(message);
    expect(html).toContain(valueStatement);
    expect(html).toContain(`href="${authPageHref("login", returnTo)}"`);
    expect(html).toContain(`href="${authPageHref("signup", returnTo)}"`);
    expect(html).toContain("Create an account");
    expect(html).toContain("Back to library");
    expect(html).toContain('href="/"');
    expect(html).toContain("Source code");
    expect(html).toContain("fac<b>t</b>rove");
    expect(html.match(/class="wm /g)).toHaveLength(1);
    expect(html).toContain("focus-visible:outline-peri-d");
    expect(html).toContain('data-variant="default"');
    expect(html).toContain("h-12");
    expect(html).toContain("w-full");
    expect(html).toContain("ft-hero");
    expect(html).toContain("ft-vault-card");
    expect(html).toContain('data-testid="sign-in-gate"');
    expect(html).toContain("<main");
    expect(html).not.toContain('role="alert"');
    expect(title).not.toContain(valueStatement);
  });
});

describe("signed-out viewer", () => {
  it("uses the shared gate and leaves other viewer notices unchanged", () => {
    const signedOut = renderToStaticMarkup(<ViewerScreen state={{ status: "signed-out", message, returnTo }} />);
    expect(signedOut).toContain('data-testid="sign-in-gate"');
    expect(heading(signedOut)).toContain(message);
    expect(signedOut).toContain(`href="${authPageHref("login", returnTo)}"`);
    expect(signedOut).toContain(`href="${authPageHref("signup", returnTo)}"`);
    expect(signedOut).not.toContain("<iframe");

    const missing = renderToStaticMarkup(<ViewerScreen state={{ status: "missing", message: "Artifact not found" }} />);
    expect(missing).not.toContain('data-testid="sign-in-gate"');
    expect(missing).toContain("Artifact not found");
    expect(missing).toContain("Back to library");
    expect(missing).toContain('role="status"');
  });
});
