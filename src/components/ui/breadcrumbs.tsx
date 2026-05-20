import { Icon } from "./icons";
import { cn } from "@/lib/cn";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav className={cn("inline-flex items-center gap-2 text-sm", className)} aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-2">
            {isLast ? (
              <span className="font-medium text-ink" aria-current="page">{item.label}</span>
            ) : (
              <a href={item.href} className="text-muted hover:text-ink transition-colors">
                {item.label}
              </a>
            )}
            {!isLast && <Icon name="chevronRight" size={16} className="text-muted" />}
          </span>
        );
      })}
    </nav>
  );
}
