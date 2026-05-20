import { cn } from "@/lib/cn";

interface AppShellProps {
  sidebar: React.ReactNode;
  topBar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function AppShell({ sidebar, topBar, children, className }: AppShellProps) {
  return (
    <div className={cn("min-h-screen p-4 md:p-6", className)}>
      {/* Main bento card chứa toàn bộ UI */}
      <div className="mx-auto max-w-[1500px] rounded-2xl bg-surface shadow-bento overflow-hidden">
        <div className="grid grid-cols-[240px_1fr] min-h-[calc(100vh-3rem)]">
          {/* Sidebar */}
          <aside className="border-r border-border">{sidebar}</aside>
          {/* Right column: topbar + content */}
          <div className="flex flex-col">
            <div className="border-b border-border">{topBar}</div>
            <main className="flex-1 p-6 overflow-auto">{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
