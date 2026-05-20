import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";

export function ButtonsSection() {
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Buttons</h2>
      <SubSection title="Button — variants">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </SubSection>
      <SubSection title="Button — sizes">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </SubSection>
      <SubSection title="Button — states">
        <div className="flex flex-wrap gap-3">
          <Button leadingIcon={<Icon name="plus" size={16} />}>With icon</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button square>Square radius</Button>
        </div>
      </SubSection>
      <SubSection title="IconButton — sizes & variants">
        <div className="flex flex-wrap items-center gap-3">
          <IconButton icon="bell" size={32} aria-label="32" />
          <IconButton icon="bell" size={40} aria-label="40" />
          <IconButton icon="bell" size={48} aria-label="48" />
          <IconButton icon="x" size={40} variant="secondary" aria-label="x" />
          <IconButton icon="x" size={40} variant="destructive" aria-label="x" />
          <IconButton icon="x" size={40} variant="ghost" aria-label="x" />
        </div>
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
