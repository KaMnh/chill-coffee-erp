import { cn } from "@/lib/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

interface AvatarProps {
  src?: string;
  alt?: string;
  initials?: string;
  size?: AvatarSize;
  className?: string;
}

const sizeClass: Record<AvatarSize, string> = {
  xs: "w-6 h-6 text-xs",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

const pastels = ["bg-peach text-peach-ink", "bg-blue text-blue-ink", "bg-mint text-mint-ink", "bg-lilac text-lilac-ink"];

function pastelFromInitials(initials: string): string {
  const idx = initials.charCodeAt(0) % pastels.length;
  return pastels[idx];
}

export function Avatar({ src, alt, initials, size = "md", className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        className={cn("rounded-full object-cover", sizeClass[size], className)}
      />
    );
  }
  const text = (initials ?? "?").slice(0, 2).toUpperCase();
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-medium",
        sizeClass[size],
        pastelFromInitials(text),
        className
      )}
    >
      {text}
    </div>
  );
}

interface AvatarGroupProps {
  children: React.ReactNode;
  className?: string;
}

export function AvatarGroup({ children, className }: AvatarGroupProps) {
  return (
    <div className={cn("flex items-center [&>*]:ring-2 [&>*]:ring-surface [&>*+*]:-ml-2", className)}>
      {children}
    </div>
  );
}
