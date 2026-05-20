"use client";

import { useState } from "react";
import { TextField } from "@/components/ui/text-field";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, Radio } from "@/components/ui/radio";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function FormSection() {
  const [radioValue, setRadioValue] = useState("a");
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Form controls</h2>
      <SubSection title="TextField">
        <div className="grid grid-cols-2 gap-4 max-w-xl">
          <TextField label="Email" placeholder="owner@chill.local" />
          <TextField label="Password" type="password" />
          <TextField label="Có error" defaultValue="invalid" error="Email không hợp lệ" />
          <TextField label="Disabled" disabled defaultValue="readonly" />
        </div>
      </SubSection>
      <SubSection title="Checkbox / Radio / Switch">
        <div className="flex flex-wrap gap-8">
          <div className="flex flex-col gap-2">
            <Checkbox label="Default" />
            <Checkbox label="Checked" defaultChecked />
            <Checkbox label="Disabled" disabled />
          </div>
          <RadioGroup value={radioValue} onValueChange={setRadioValue}>
            <Radio value="a" label="Option A" />
            <Radio value="b" label="Option B" />
            <Radio value="c" label="Option C (disabled)" disabled />
          </RadioGroup>
          <div className="flex flex-col gap-3">
            <Switch />
            <Switch defaultChecked />
            <Switch disabled />
          </div>
        </div>
      </SubSection>
      <SubSection title="Slider">
        <Slider defaultValue={[40]} max={100} step={1} className="max-w-md" formatValue={(v) => `${v}%`} />
      </SubSection>
      <SubSection title="Select">
        <Select defaultValue="apple">
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
            <SelectItem value="cherry">Cherry</SelectItem>
          </SelectContent>
        </Select>
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
