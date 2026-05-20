"use client";

import { useState } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { ToastProvider } from "@/components/ui/toast";
import { LayoutSection } from "./_sections/layout-section";
import { ButtonsSection } from "./_sections/buttons-section";
import { FormSection } from "./_sections/form-section";
import { NavigationSection } from "./_sections/navigation-section";
import { DataDisplaySection } from "./_sections/data-display-section";
import { FeedbackSection } from "./_sections/feedback-section";
import { ChartsSection } from "./_sections/charts-section";
import { cn } from "@/lib/cn";

const sections = [
  { id: "layout", label: "Layout", Component: LayoutSection },
  { id: "buttons", label: "Buttons", Component: ButtonsSection },
  { id: "form", label: "Form", Component: FormSection },
  { id: "navigation", label: "Navigation", Component: NavigationSection },
  { id: "data-display", label: "Data display", Component: DataDisplaySection },
  { id: "feedback", label: "Feedback", Component: FeedbackSection },
  { id: "charts", label: "Charts", Component: ChartsSection },
] as const;

export default function PlaygroundPage() {
  const [active, setActive] = useState<typeof sections[number]["id"]>("layout");
  const Active = sections.find((s) => s.id === active)!.Component;

  return (
    <ToastProvider>
      <RadixTooltip.Provider>
        <div className="min-h-screen p-6">
          <div className="mx-auto max-w-[1500px] rounded-2xl bg-surface shadow-bento overflow-hidden">
            <div className="grid grid-cols-[240px_1fr]">
              <aside className="border-r border-border p-4">
                <div className="px-3 py-4 font-display text-xl font-bold">Playground</div>
                <nav className="flex flex-col gap-1 mt-2">
                  {sections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setActive(s.id)}
                      className={cn(
                        "text-left px-4 py-2.5 text-sm font-medium rounded-md transition-colors",
                        active === s.id
                          ? "bg-ink text-white rounded-full"
                          : "text-ink-2 hover:bg-surface-muted hover:text-ink"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </nav>
              </aside>
              <main className="p-8 overflow-auto max-h-screen">
                <Active />
              </main>
            </div>
          </div>
        </div>
      </RadixTooltip.Provider>
    </ToastProvider>
  );
}
