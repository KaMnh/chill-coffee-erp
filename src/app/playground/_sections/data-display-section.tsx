import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { BentoCard } from "@/components/ui/bento-card";
import { StatCard } from "@/components/ui/stat-card";
import { PromoCard } from "@/components/ui/promo-card";
import { InsightCard } from "@/components/ui/insight-card";
import { ListItem } from "@/components/ui/list-item";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";

export function DataDisplaySection() {
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Data display</h2>
      <SubSection title="Card variants">
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Basic Card</CardTitle>
            </CardHeader>
            <CardBody>Card content here.</CardBody>
          </Card>
          <BentoCard>
            <CardTitle>Bento Card</CardTitle>
            <p className="text-sm text-muted mt-2">Larger radius, used in bento grids.</p>
          </BentoCard>
        </div>
      </SubSection>
      <SubSection title="StatCard pastels">
        <div className="grid grid-cols-4 gap-4">
          <StatCard color="peach" title="Doanh thu" subtitle="Hôm nay" value="₫2.5M" onAction={() => {}} />
          <StatCard color="blue" title="Khách" subtitle="Hôm nay" value="124" onAction={() => {}} />
          <StatCard color="mint" title="Lãi gộp" subtitle="Tháng này" value="38%" onAction={() => {}} />
          <StatCard color="lilac" title="Tăng trưởng" subtitle="So với tháng trước" value="+12%" onAction={() => {}} />
        </div>
      </SubSection>
      <SubSection title="PromoCard">
        <PromoCard
          badge="PRO"
          headline="Nâng cấp gói Analytics"
          description="Truy cập báo cáo nâng cao và xuất CSV."
          onAction={() => {}}
        />
      </SubSection>
      <SubSection title="InsightCard">
        <div className="grid grid-cols-3 gap-4">
          <InsightCard icon="checkCircle" iconColor="mint" title="Hoàn tất chốt két" description="Báo cáo hôm nay đã được tạo lúc 23:15." />
          <InsightCard icon="alertTriangle" iconColor="peach" title="Hết hàng" description="Cà phê arabica sắp hết tồn." />
          <InsightCard icon="sparkles" iconColor="lilac" title="Top sản phẩm" description="Cappuccino vẫn dẫn đầu tuần này." />
        </div>
      </SubSection>
      <SubSection title="Badge variants">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="solid" semantic="success">Active</Badge>
          <Badge variant="soft" semantic="success" withDot>Online</Badge>
          <Badge variant="soft" semantic="warning">Pending</Badge>
          <Badge variant="soft" semantic="danger">Failed</Badge>
          <Badge variant="count">3</Badge>
        </div>
      </SubSection>
      <SubSection title="Avatar group">
        <AvatarGroup>
          <Avatar initials="OW" />
          <Avatar initials="MA" />
          <Avatar initials="SO" />
          <Avatar initials="EV" />
        </AvatarGroup>
      </SubSection>
      <SubSection title="ListItem + Tooltip">
        <div className="bg-surface rounded-lg">
          <ListItem
            avatar={<Avatar initials="OW" />}
            title="Owner"
            subtitle="owner@chill.local"
            action={
              <Tooltip content="Vai trò: chủ quán">
                <Badge variant="soft" semantic="success">owner</Badge>
              </Tooltip>
            }
          />
          <ListItem
            avatar={<Avatar initials="ST" />}
            title="Staff A"
            subtitle="staff-a@chill.local"
          />
        </div>
      </SubSection>
      <SubSection title="DataTable">
        <DataTable
          columns={[
            { key: "name", header: "Tên", sortable: true },
            { key: "role", header: "Vai trò" },
            {
              key: "status",
              header: "Trạng thái",
              render: (r) =>
                r.status === "active" ? (
                  <Badge variant="soft" semantic="success" withDot>active</Badge>
                ) : (
                  <Badge variant="soft" semantic="warning">pending</Badge>
                ),
            },
          ]}
          data={[
            { id: 1, name: "Owner", role: "owner", status: "active" },
            { id: 2, name: "Staff A", role: "staff", status: "active" },
            { id: 3, name: "Staff B", role: "staff", status: "pending" },
          ]}
          rowKey={(r) => String(r.id)}
        />
      </SubSection>
      <SubSection title="EmptyState placeholder">
        <div className="text-muted text-sm">(EmptyState ở Feedback section)</div>
        <Button size="sm">Action</Button>
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
