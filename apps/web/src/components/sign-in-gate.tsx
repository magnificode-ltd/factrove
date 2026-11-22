import type { CSSProperties } from "react";
import { authPageHref } from "@/auth/return-path";
import { DocsLink } from "@/components/docs-link";
import { SourceCodeLink } from "@/components/source-code-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Wordmark } from "@/components/wordmark";

const valueStatement = "Factrove is a self-hostable home for artifacts created by people and agents.";

const sourceLinkClass =
  "shrink-0 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

const textLinkClass =
  "font-semibold text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

const cardSpacing = { "--card-spacing": "2rem" } as CSSProperties;

export function SignInGate({ message, returnTo }: { message: string; returnTo: string }) {
  return (
    <div className="ft-canvas min-h-dvh">
      <div className="ft-hero flex min-h-dvh flex-col">
        <header className="flex items-center justify-end gap-4 px-4 py-3 sm:px-6">
          <DocsLink className={sourceLinkClass} />
          <SourceCodeLink className={sourceLinkClass} />
        </header>
        <main className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 sm:py-12">
          <Card
            data-testid="sign-in-gate"
            className="ft-vault-card w-full max-w-md overflow-visible bg-white"
            style={cardSpacing}
          >
            <CardContent className="flex flex-col items-center text-center">
              <Wordmark />
              <h1 className="ft-title mt-8 text-3xl text-balance sm:text-4xl">{message}</h1>
              <p className="mt-3 max-w-sm text-base leading-relaxed text-balance text-muted-foreground">{valueStatement}</p>
              <Button asChild className="mt-8 h-12 w-full text-base">
                <a href={authPageHref("login", returnTo)}>Sign in</a>
              </Button>
              <p className="mt-5 text-sm text-muted-foreground">
                New here?{" "}
                <a className={textLinkClass} href={authPageHref("signup", returnTo)}>
                  Create an account
                </a>
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
