import { redirect } from "next/navigation";
import { FactroveApiError } from "@factrove/api-client";
import { createRequestClient } from "@/api/server-client";
import { AuthScreen } from "@/components/auth-screen";
import { CreateOrganizationForm } from "@/components/create-organization-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  try {
    const context = await (await createRequestClient()).getContext();
    if (context.organization) {
      redirect("/");
    }
  } catch (error) {
    if (error instanceof FactroveApiError && error.status === 401) {
      redirect("/login?next=/onboarding");
    }
    throw error;
  }

  return (
    <AuthScreen
      title="Name your organization"
      lede="Every account belongs to an organization. This is the one you will use."
      footer="You can sign out if you want to use a different account."
    >
      <CreateOrganizationForm />
    </AuthScreen>
  );
}
