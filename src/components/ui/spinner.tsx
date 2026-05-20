import { cn } from "@/lib/cn";

export type SpinnerSize = 16 | 24 | 32;

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

export function Spinner({ size = 24, className }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("animate-spin", className)}
      role="status"
      aria-label="Đang tải"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
