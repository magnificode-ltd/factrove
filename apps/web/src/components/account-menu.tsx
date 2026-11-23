"use client";

import { DropdownMenu } from "radix-ui";
import { signOutAndReturnHome } from "@/components/sign-out-button";

const itemClass =
  "flex h-8 cursor-pointer items-center rounded-md px-2.5 text-sm text-ink no-underline outline-none data-highlighted:bg-lilac";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (!first) {
    return "?";
  }
  if (!second) {
    return first.slice(0, 2).toUpperCase();
  }
  return `${first[0] ?? ""}${second[0] ?? ""}`.toUpperCase();
}

export function AccountMenu({ name, organization }: { name: string; organization: string | null }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        type="button"
        aria-label={`Account menu for ${name}`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-lilac text-xs font-semibold tracking-wide text-ink hover:bg-[color-mix(in_srgb,var(--peri)_18%,white)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
      >
        {initials(name)}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-60 rounded-xl border border-border bg-white p-1 shadow-[0_12px_32px_-16px_color-mix(in_srgb,var(--ink)_35%,transparent)]"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{organization ?? "No organization"}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <a href="/account/members" className={itemClass}>
              Members
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a href="/account/api-keys" className={itemClass}>
              API keys
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={signOutAndReturnHome}>
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
