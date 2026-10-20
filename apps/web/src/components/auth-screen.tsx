import type { ReactNode } from "react";
import { AppBar } from "@/components/chrome";
import { Wordmark } from "@/components/wordmark";
import { Card, CardContent } from "@/components/ui/card";

export function AuthScreen({
  title,
  lede,
  children,
  footer
}: {
  title: string;
  lede: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="ft-canvas min-h-dvh">
      <div className="ft-hero">
        <AppBar clear />
        <main className="ft-enter mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.9fr)] lg:py-20">
          <section className="max-w-xl">
            <Wordmark large />
            <h1 className="ft-title mt-6 text-5xl text-balance">{title}</h1>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">{lede}</p>
          </section>
          <Card className="bg-white shadow-[0_28px_70px_-36px_rgba(27,32,55,0.45)]">
            <CardContent className="grid gap-6">{children}</CardContent>
            <div className="px-(--card-spacing) pb-(--card-spacing) text-sm text-muted-foreground">{footer}</div>
          </Card>
        </main>
      </div>
    </div>
  );
}
