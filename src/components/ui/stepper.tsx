import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export interface Step {
  label: string;
}

interface StepperProps {
  steps: Step[];
  current: number; // 0-indexed
  className?: string;
}

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn("flex items-start justify-between gap-2", className)}>
      {steps.map((step, i) => {
        const isCompleted = i < current;
        const isCurrent = i === current;
        const isLast = i === steps.length - 1;
        return (
          <li key={i} className="flex-1 flex flex-col items-center">
            <div className="flex items-center w-full">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium font-display",
                  isCompleted || isCurrent
                    ? "bg-ink text-white"
                    : "border border-border text-muted"
                )}
              >
                {isCompleted ? <Icon name="check" size={16} /> : i + 1}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2",
                    isCompleted ? "bg-ink" : "bg-border"
                  )}
                />
              )}
            </div>
            <div
              className={cn(
                "mt-2 text-xs text-center",
                isCurrent ? "text-ink font-medium" : "text-muted"
              )}
            >
              {step.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
