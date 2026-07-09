import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
} from "react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-secondary">
        {label}
        {required && <span className="text-critical">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-tertiary">{hint}</span>}
    </label>
  );
}

const controlClass =
  "w-full rounded-sm border border-strong bg-inset px-3 py-2 text-[13px] text-primary " +
  "placeholder:text-tertiary focus:border-accent transition-colors outline-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(controlClass, className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(controlClass, "appearance-none", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlClass, "min-h-20 resize-y", className)} {...props} />
));
Textarea.displayName = "Textarea";
