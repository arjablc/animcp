import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lime-300 disabled:pointer-events-none disabled:opacity-40", className)} {...props} />;
}
