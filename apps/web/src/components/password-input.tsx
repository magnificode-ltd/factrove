"use client";

import { forwardRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "type">>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn("h-11 bg-white pr-12 pl-3 font-mono text-base tracking-wide md:text-base", className)}
          {...props}
        />
        <button
          type="button"
          className="absolute inset-y-1 right-1 grid w-10 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-lilac hover:text-ink"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={props.id}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    );
  }
);
