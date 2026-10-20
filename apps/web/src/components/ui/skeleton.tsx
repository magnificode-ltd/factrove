import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("ft-shimmer rounded-md bg-[var(--lilac)]", className)}
      {...props}
    />
  )
}

export { Skeleton }
