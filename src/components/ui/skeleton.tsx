import { cn } from "@/lib/cn";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: "xs" | "sm" | "md" | "lg" | "full";
  className?: string;
}

const roundedClass = {
  xs: "rounded-xs",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
} as const;

export function Skeleton({ width, height = "1rem", rounded = "sm", className }: SkeletonProps) {
  return (
    <div
      style={{ width, height }}
      className={cn("bg-surface-muted shimmer", roundedClass[rounded], className)}
      aria-hidden="true"
    />
  );
}
