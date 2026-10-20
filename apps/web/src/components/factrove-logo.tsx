import { cn } from "cn"

export function FactroveLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn("size-9 shrink-0", className)}
    >
      <rect width="48" height="48" rx="14" fill="#858BEE" />
      <path
        d="M15 14.5h12.2c.6 0 1.2.24 1.63.67l5 5c.43.43.67 1.02.67 1.63V33.5a2.5 2.5 0 0 1-2.5 2.5H15a2.5 2.5 0 0 1-2.5-2.5v-16.5A2.5 2.5 0 0 1 15 14.5Z"
        fill="#F5F6FC"
      />
      <path d="M27.2 14.8V20a1.6 1.6 0 0 0 1.6 1.6h5.2" stroke="#1B2037" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M18.2 26.2h11.2M18.2 30.4h7" stroke="#858BEE" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
