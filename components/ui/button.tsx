import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-cardinal-600 text-white hover:bg-cardinal-700 active:bg-cardinal-800",
  secondary:
    "border border-line bg-card text-ink hover:bg-surface active:bg-line-soft",
  ghost: "text-cardinal-600 hover:bg-cardinal-50",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-tile px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  children,
  variant = "primary",
  className,
  type = "button",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(base, variantStyles[variant], className)}
    >
      {children}
    </button>
  );
}

/** Same visual treatment, but navigates. */
export function ButtonLink({
  children,
  href,
  variant = "primary",
  className,
}: {
  children: React.ReactNode;
  href: string;
  variant?: Variant;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(base, variantStyles[variant], className)}>
      {children}
    </Link>
  );
}
