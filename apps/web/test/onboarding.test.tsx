/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactroveApiError } from "@factrove/api-client";

const createOrganization = vi.fn();
const redirect = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT ${path}`);
}));
const api = vi.hoisted(() => ({
  getContext: vi.fn(),
  listArtifacts: vi.fn(),
  getArtifact: vi.fn()
}));

vi.mock("@/api/client", () => ({
  createWebClient: () => ({ createOrganization })
}));

vi.mock("@/api/server-client", () => ({
  createRequestClient: async () => api
}));

vi.mock("next/navigation", () => ({ redirect }));

import { CreateOrganizationForm } from "../src/components/create-organization-form";
import OnboardingPage from "../src/app/(browse)/onboarding/page";
import HomePage from "../src/app/(browse)/page";
import ArtifactPage from "../src/app/(browse)/artifacts/[id]/page";

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  createOrganization.mockReset();
  redirect.mockClear();
  api.getContext.mockReset();
  api.listArtifacts.mockReset();
  api.getArtifact.mockReset();
});

describe("create organization page", () => {
  it("asks a signed-in user with no organization for a name", async () => {
    api.getContext.mockRejectedValue(new FactroveApiError("Create an organization to continue.", {
      status: 403,
      code: "ORGANIZATION_SETUP_REQUIRED"
    }));
    const html = renderToStaticMarkup(await OnboardingPage());
    expect(html).toContain("Name your organization");
    expect(html).toContain("Organization name");
    expect(html).toContain("Create organization");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in and a member home", async () => {
    api.getContext.mockRejectedValue(new FactroveApiError("Sign in to continue.", { status: 401, code: "UNAUTHENTICATED" }));
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT /login?next=/onboarding");

    api.getContext.mockResolvedValue({
      user: { id: "user-1", name: "Ada" },
      organization: { id: "org-1", name: "Ada Lab" }
    });
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT /");
  });

  it("posts the typed name and returns to the library", async () => {
    createOrganization.mockResolvedValue({ organization: { id: "org-1", name: "Ada Lab" } });
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const container = await render(<CreateOrganizationForm />);
    const input = container.querySelector<HTMLInputElement>('input[name="name"]');
    if (!input) throw new Error("name field missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Ada Lab");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(createOrganization).toHaveBeenCalledWith("Ada Lab");
    expect(assigned).toHaveBeenCalledWith("/");
    assigned.mockRestore();
  });

  it("shows the library to a member and the name page to a user with no organization", async () => {
    api.getContext.mockRejectedValue(new FactroveApiError("Create an organization to continue.", {
      status: 403,
      code: "ORGANIZATION_SETUP_REQUIRED"
    }));
    api.listArtifacts.mockRejectedValue(new FactroveApiError("Create an organization to continue.", {
      status: 403,
      code: "ORGANIZATION_SETUP_REQUIRED"
    }));
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /onboarding");

    api.getContext.mockResolvedValue({
      user: { id: "user-1", name: "Ada" },
      organization: { id: "org-1", name: "Ada Lab" }
    });
    api.listArtifacts.mockResolvedValue({ items: [] });
    const html = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("My artifacts");
    expect(html).toContain("Ada Lab");

    api.getContext.mockRejectedValue(new FactroveApiError("Create an organization to continue.", {
      status: 403,
      code: "ORGANIZATION_SETUP_REQUIRED"
    }));
    api.getArtifact.mockRejectedValue(new FactroveApiError("Create an organization to continue.", {
      status: 403,
      code: "ORGANIZATION_SETUP_REQUIRED"
    }));
    await expect(ArtifactPage({ params: Promise.resolve({ id: "artifact-1" }) })).rejects.toThrow("REDIRECT /onboarding");
  });
});

async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}
