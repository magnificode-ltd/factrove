import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";

export function AuthField({
  id,
  label,
  className,
  ...props
}: ComponentProps<"input"> & { id: string; label: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={cn("h-11 bg-white px-3 text-base md:text-base", className)} {...props} />
    </div>
  );
}
