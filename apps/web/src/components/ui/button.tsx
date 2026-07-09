import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

const VARIANTS = {
  primary: "bg-accent text-white hover:bg-accent-strong border border-transparent",
  secondary:
    "bg-raised text-primary border border-strong hover:bg-hover hover:border-strong",
  ghost: "bg-transparent text-secondary hover:text-primary hover:bg-hover border border-transparent",
  danger: "bg-critical text-white hover:brightness-110 border border-transparent",
  success: "bg-success text-white hover:brightness-110 border border-transparent",
} as const;

const SIZES = {
  sm: "h-7 px-2.5 text-[11px] gap-1.5",
  md: "h-9 px-3.5 text-[12.5px] gap-2",
  lg: "h-10 px-5 text-[13px] gap-2",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-sm font-medium uppercase tracking-wide",
        "transition-colors duration-100 disabled:opacity-40 disabled:pointer-events-none",
        "whitespace-nowrap select-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
