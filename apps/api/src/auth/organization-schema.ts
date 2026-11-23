/**
 * Columns this product adds to Better Auth's invitation model.
 * Schema generation and the runtime plugin share this object so
 * `auth generate` keeps the columns.
 */
export const organizationSchema = {
  invitation: {
    additionalFields: {
      // SHA-256 hex of the invite secret. The invitation id is not that secret.
      tokenHash: {
        type: "string" as const,
        required: false,
        unique: true,
        input: false,
        returned: false,
      },
      lastSentAt: {
        type: "date" as const,
        required: false,
        input: false,
      },
    },
  },
};
