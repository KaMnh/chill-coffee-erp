"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Stepper } from "@/components/ui/stepper";
import { Pagination } from "@/components/ui/pagination";

export function NavigationSection() {
  const [page, setPage] = useState(1);
  const [step] = useState(1);
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Navigation</h2>
      <SubSection title="Tabs">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">Overview content</TabsContent>
          <TabsContent value="details">Details content</TabsContent>
          <TabsContent value="settings">Settings content</TabsContent>
        </Tabs>
      </SubSection>
      <SubSection title="Breadcrumbs">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "#" },
            { label: "Settings", href: "#" },
            { label: "Account" },
          ]}
        />
      </SubSection>
      <SubSection title="Stepper">
        <Stepper
          steps={[
            { label: "Account" },
            { label: "Details" },
            { label: "Review" },
            { label: "Payment" },
          ]}
          current={step}
        />
      </SubSection>
      <SubSection title="Pagination">
        <Pagination total={5} current={page} onChange={setPage} />
      </SubSection>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">{title}</h3>
      <div className="bg-surface rounded-lg shadow-raised p-6">{children}</div>
    </div>
  );
}
