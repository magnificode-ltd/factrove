/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactroveApiError } from "@factrove/api-client";

const listOrganizationMembers = vi.fn();
const createOrganizationInvitation = vi.fn();
const resendOrganizationInvitation = vi.fn();
const revokeOrganizationInvitation = vi.fn();

vi.mock("@/api/client", () => ({
  createWebClient: () => ({
    listOrganizationMembers,
    createOrganizationInvitation,
    resendOrganizationInvitation,
    revokeOrganizationInvitation,
  }),
}));

import MembersPage from "../src/app/(browse)/account/members/page";

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  listOrganizationMembers.mockReset();
  createOrganizationInvitation.mockReset();
  resendOrganizationInvitation.mockReset();
  revokeOrganizationInvitation.mockReset();
});

const ownerPage = {
  caller: { id: "member-ada", role: "owner" as const },
  members: [
    { id: "member-ada", name: "Ada Owner", email: "ada@example.com", role: "owner" as const },
    { id: "member-bea", name: "Bea Member", email: "bea@example.com", role: "member" as const },
  ],
  invitations: [
    {
      id: "invite-1",
      email: "new@example.com",
      role: "member" as const,
      status: "pending" as const,
      expiresAt: "2026-12-01T12:00:00.000Z",
      lastSentAt: "2026-11-24T12:00:00.000Z",
      createdAt: "2026-11-24T12:00:00.000Z",
    },
  ],
  nextCursor: null,
};

describe("Members page", () => {
  it("lets an owner invite, resend, and revoke", async () => {
    listOrganizationMembers.mockResolvedValue(ownerPage);
    createOrganizationInvitation.mockResolvedValue({});
    const container = await render(<MembersPage />);
    await flush();
    expect(container.textContent).toContain("Ada Owner");
    expect(container.textContent).toContain("bea@example.com");
    expect(container.textContent).toContain("You");
    expect(container.textContent).toContain("new@example.com");
    expect(container.querySelector("form")).toBeTruthy();

    const email = container.querySelector<HTMLInputElement>("#invite-email");
    expect(email).toBeTruthy();
    if (email) {
      email.value = "next@example.com";
    }
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(createOrganizationInvitation).toHaveBeenCalledWith("next@example.com");

    resendOrganizationInvitation.mockResolvedValue({});
    const resend = [...container.querySelectorAll("button")].find((button) => button.textContent === "Resend");
    await act(async () => {
      resend?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(resendOrganizationInvitation).toHaveBeenCalledWith("invite-1");

    revokeOrganizationInvitation.mockResolvedValue(undefined);
    const revoke = [...container.querySelectorAll("button")].find((button) => button.textContent === "Revoke");
    await act(async () => {
      revoke?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(revokeOrganizationInvitation).toHaveBeenCalledWith("invite-1");
  });

  it("hides invitations and the invite form from a member", async () => {
    listOrganizationMembers.mockResolvedValue({
      ...ownerPage,
      caller: { id: "member-bea", role: "member" },
      invitations: [],
    });
    const container = await render(<MembersPage />);
    await flush();
    expect(container.textContent).toContain("Bea Member");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Pending invitations");
    expect(container.textContent).not.toContain("Send invitation");
  });

  it("sends a signed-in user with no organization to onboarding", async () => {
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    listOrganizationMembers.mockRejectedValue(new FactroveApiError("Create an organization to continue.", {
      status: 403,
      code: "ORGANIZATION_SETUP_REQUIRED",
    }));
    await render(<MembersPage />);
    await flush();
    expect(assigned).toHaveBeenCalledWith("/onboarding");
    assigned.mockRestore();
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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
