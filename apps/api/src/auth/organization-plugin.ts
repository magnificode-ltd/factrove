import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

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
  "/organization/set-active",
  "/organization/get-full-organization",
  "/organization/get-organization",
] as const;

function closedOrganizationAction(): never {
  throw new APIError("FORBIDDEN", {
    message: ORGANIZATION_ACTION_UNAVAILABLE,
  });
}

/**
 * Organization routes are mounted. The actions this project does not ship are
 * rejected here. Signup still creates no membership. The first organization is
 * POST /api/v1/onboarding/organization, because the plugin create route takes a client slug.
 */
// Same statements as Better Auth's default owner, admin, and member roles.
// apiKey is added for every role: any member of the active organization can
// create, list, and delete that organization's keys.
const apiKeyActions = ["create", "read", "update", "delete"] as const;
const organizationAccess = createAccessControl({
  ...defaultStatements,
  apiKey: apiKeyActions,
});
const organizationRoles = {
  owner: organizationAccess.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
    apiKey: apiKeyActions,
  }),
  admin: organizationAccess.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
    apiKey: apiKeyActions,
  }),
  member: organizationAccess.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
    apiKey: apiKeyActions,
  }),
};

export function factroveOrganization() {
  return organization({
    allowUserToCreateOrganization: false,
    creatorRole: "owner",
    disableOrganizationDeletion: true,
    ac: organizationAccess,
    roles: organizationRoles,
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

export function rejectClosedOrganizationAction(path: string | undefined): void {
  const normalized = normalizeAuthPath(path);
  if (!normalized) {
    return;
  }
  if (CLOSED_ORGANIZATION_SUFFIXES.some((suffix) => matchesClosedPath(normalized, suffix))) {
    closedOrganizationAction();
  }
}

function matchesClosedPath(path: string, suffix: string): boolean {
  return path === suffix || path.endsWith(suffix);
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
