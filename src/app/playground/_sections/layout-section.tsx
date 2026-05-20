import { AppShell } from "@/components/layout/app-shell";
import { Sidebar, SidebarSection, SidebarLogo } from "@/components/layout/sidebar";
import { NavItem } from "@/components/layout/nav-item";
import { TopBar, SearchBar } from "@/components/layout/top-bar";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar } from "@/components/ui/avatar";

export function LayoutSection() {
  return (
    <div className="space-y-8">
      <SectionTitle title="Layout primitives" />
      <div className="rounded-lg border border-border overflow-hidden">
        <AppShell
          sidebar={
            <Sidebar>
              <SidebarLogo>Chill</SidebarLogo>
              <SidebarSection label="Main">
                <NavItem icon="search" label="Dashboard" active />
                <NavItem icon="filter" label="Chốt két" />
                <NavItem icon="bell" label="Ca & lương" />
              </SidebarSection>
              <SidebarSection label="Tools">
                <NavItem icon="info" label="Cài đặt" />
              </SidebarSection>
            </Sidebar>
          }
          topBar={
            <TopBar
              search={<SearchBar />}
              actions={
                <>
                  <IconButton icon="bell" size={40} variant="ghost" aria-label="Notifications" />
                  <Avatar initials="OW" size="md" />
                </>
              }
            />
          }
        >
          <div className="text-ink-2">Content area</div>
        </AppShell>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="font-display text-3xl font-bold text-ink mb-2">{title}</h2>;
}
