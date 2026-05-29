"use client";

import { useMemo } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { solarToLunar } from "@/lib/lunar";

interface LunarCalendarWidgetProps {
  start: string; // YYYY-MM-DD
  end: string;
}

interface DayCell {
  iso: string;
  solarDay: number;
  lunarDay: number;
  lunarMonth: number;
  inRange: boolean;
  isToday: boolean;
  holiday?: string;
  isFirstOfMonth: boolean;
  isFullMoon: boolean;
}

function fromLocalISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildGrid(start: string, end: string): DayCell[][] {
  const startD = fromLocalISO(start);
  const endD = fromLocalISO(end);

  // Find the Monday of the week containing `start`.
  const startDow = startD.getDay(); // 0..6
  const offsetToMon = startDow === 0 ? -6 : 1 - startDow;
  const gridStart = new Date(startD);
  gridStart.setDate(startD.getDate() + offsetToMon);

  // Find the Sunday of the week containing `end`.
  const endDow = endD.getDay();
  const offsetToSun = endDow === 0 ? 0 : 7 - endDow;
  const gridEnd = new Date(endD);
  gridEnd.setDate(endD.getDate() + offsetToSun);

  const todayISO = toLocalISO(new Date());
  const startISO = start;
  const endISO = end;

  const grid: DayCell[][] = [];
  let week: DayCell[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const iso = toLocalISO(cursor);
    const lunar = solarToLunar(cursor);
    week.push({
      iso,
      solarDay: cursor.getDate(),
      lunarDay: lunar.day,
      lunarMonth: lunar.month,
      inRange: iso >= startISO && iso <= endISO,
      isToday: iso === todayISO,
      holiday: lunar.holiday,
      isFirstOfMonth: lunar.isFirstOfMonth,
      isFullMoon: lunar.isFullMoon,
    });
    if (week.length === 7) {
      grid.push(week);
      week = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (week.length) grid.push(week);
  return grid;
}

const DOW_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export function LunarCalendarWidget({ start, end }: LunarCalendarWidgetProps) {
  const grid = useMemo(() => buildGrid(start, end), [start, end]);

  return (
    <Reveal>
    <Card>
      <CardHeader>
        <CardTitle>Lịch âm dương của kỳ</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-7 gap-1 text-center">
          {DOW_LABELS.map((d) => (
            <div key={d} className="text-xs font-medium text-muted py-1">
              {d}
            </div>
          ))}
          {grid.flat().map((cell) => {
            const dim = !cell.inRange;
            const ring = cell.isToday;
            const badge = cell.holiday
              ? cell.holiday
              : cell.isFirstOfMonth
                ? "Mùng 1"
                : cell.isFullMoon
                  ? "Rằm"
                  : null;
            return (
              <div
                key={cell.iso}
                className={[
                  "aspect-square rounded-md border p-1 text-left",
                  dim ? "bg-surface-muted text-muted border-transparent" : "bg-surface text-ink border-border",
                  ring ? "ring-2 ring-ink" : "",
                ].join(" ")}
              >
                <div className="text-sm font-medium leading-tight">{cell.solarDay}</div>
                <div className="text-[10px] text-muted tabular-nums leading-tight">
                  {cell.lunarDay}/{cell.lunarMonth}
                </div>
                {badge && (
                  <div className="mt-0.5 text-[9px] leading-tight text-warning font-medium truncate" title={badge}>
                    {badge}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
    </Reveal>
  );
}
