import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";

export const ORGANIZATION_ACTION_UNAVAILABLE = "This organization action is not available.";

const CLOSED_ORGANIZATION_SUFFIXES = [
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/leave",
] as const;

function closedOrganizationAction(): never {
  throw new APIError("FORBIDDEN", {
    message: ORGANIZATION_ACTION_UNAVAILABLE,
  });
}

/**
 * Organization routes are mounted. The actions this project does not ship are
 * rejected here. Signup still creates no membership. The first organization is
 * a later endpoint, because the plugin create route takes a client slug.
 */
export function factroveOrganization() {
  return organization({
    allowUserToCreateOrganization: false,
    creatorRole: "owner",
    disableOrganizationDeletion: true,
    organizationHooks: {
      beforeCreateOrganization: async () => {
        closedOrganizationAction();
      },
      beforeUpdateOrganization: async () => {
        closedOrganizationAction();
      },
      beforeDeleteOrganization: async () => {
        closedOrganizationAction();
      },
      beforeCreateInvitation: async () => {
        closedOrganizationAction();
      },
      beforeAcceptInvitation: async () => {
        closedOrganizationAction();
      },
      beforeRejectInvitation: async () => {
        closedOrganizationAction();
      },
      beforeCancelInvitation: async () => {
        closedOrganizationAction();
      },
      beforeRemoveMember: async () => {
        closedOrganizationAction();
      },
      beforeUpdateMemberRole: async () => {
        closedOrganizationAction();
      },
    },
  });
}

export function rejectClosedOrganizationAction(path: string | undefined, body: unknown): void {
  const normalized = normalizeAuthPath(path);
  if (!normalized) {
    return;
  }
  if (CLOSED_ORGANIZATION_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(suffix))) {
    closedOrganizationAction();
  }
  if (normalized === "/organization/set-active" || normalized.endsWith("/organization/set-active")) {
    if (clearsActiveOrganization(body)) {
      closedOrganizationAction();
    }
  }
}

function clearsActiveOrganization(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const record = body as { organizationId?: unknown; organizationSlug?: unknown };
  return record.organizationId === null || record.organizationSlug === null;
}

function normalizeAuthPath(path: string | undefined): string | null {
  if (!path) {
    return null;
  }
  const withoutQuery = path.split("?")[0] ?? "";
  if (withoutQuery.length === 0) {
    return null;
  }
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}
