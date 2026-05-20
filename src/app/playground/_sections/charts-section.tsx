import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";

const weekData = [
  { day: "T2", revenue: 1.2, highlight: false },
  { day: "T3", revenue: 1.8, highlight: false },
  { day: "T4", revenue: 2.4, highlight: true },
  { day: "T5", revenue: 1.6, highlight: false },
  { day: "T6", revenue: 2.0, highlight: false },
  { day: "T7", revenue: 2.8, highlight: false },
  { day: "CN", revenue: 2.2, highlight: false },
];

const trend = [
  { day: "T2", value: 50 },
  { day: "T3", value: 65 },
  { day: "T4", value: 60 },
  { day: "T5", value: 72 },
  { day: "T6", value: 80 },
  { day: "T7", value: 95 },
  { day: "CN", value: 88 },
];

export function ChartsSection() {
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Charts</h2>
      <SubSection title="BarChart — doanh thu tuần (T4 highlight)">
        <BarChart
          data={weekData}
          xKey="day"
          yKey="revenue"
          highlightKey="highlight"
          formatY={(v) => `₫${v.toFixed(1)}M`}
        />
      </SubSection>
      <SubSection title="LineChart — xu hướng">
        <LineChart data={trend} xKey="day" yKey="value" formatY={(v) => `${v}`} />
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
