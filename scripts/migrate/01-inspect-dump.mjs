// scripts/migrate/01-inspect-dump.mjs — Stage 1: schema diff v2 dump vs v4 schema.
// Output markdown report tới docs/migration/v2-to-v4-schema-diff.md.
//
// Usage:
//   npm run migrate:inspect
//   node scripts/migrate/01-inspect-dump.mjs [--dump <path>] [--target <path>] [--out <path>]
//
// Defaults: dump=migration/v2-dump.sql, target=database/001_schema.sql,
// out=docs/migration/v2-to-v4-schema-diff.md
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { parseCreateTables, parseAlterAddColumn, applyPatches } from "./_lib/sql-parser.mjs";

// Whitelist các bảng trong scope migration (theo plan).
const SCOPE = [
  "employees",
  "employee_accounts",
  "expense_categories",
  "expense_templates",
  "expenses",
  "cash_day_openings",
  "cash_counts",
  "cash_close_reports",
  "cash_drawer_events",
  "shift_assignments",
  "shift_payroll_records",
  "safe_transactions",
  "handover_sessions",
  "handover_tasks",
];

function parseArgs(argv) {
  const out = {
    dump: "migration/v2-dump.sql",
    target: "database/001_schema.sql",
    outFile: "docs/migration/v2-to-v4-schema-diff.md",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dump") out.dump = argv[++i];
    else if (a === "--target") out.target = argv[++i];
    else if (a === "--out") out.outFile = argv[++i];
  }
  return out;
}

function loadSchema(path) {
  if (!existsSync(path)) throw new Error(`Không tìm thấy file: ${path}`);
  const sql = readFileSync(path, "utf8");
  const tables = parseCreateTables(sql);
  const patches = parseAlterAddColumn(sql);
  applyPatches(tables, patches);
  return tables;
}

function classifyDiff(v2Col, v4Col) {
  if (!v2Col && v4Col) return "NEW_v4";
  if (v2Col && !v4Col) return "DROPPED_v4";
  if (v2Col.type !== v4Col.type) return "TYPE_DIFF";
  if (v2Col.nullable !== v4Col.nullable) return "NULLABLE_DIFF";
  if ((v2Col.default || "") !== (v4Col.default || "")) return "DEFAULT_DIFF";
  return "OK";
}

function formatCell(col) {
  if (!col) return "—";
  const parts = [col.type];
  if (!col.nullable) parts.push("NOT NULL");
  if (col.default) parts.push(`default ${col.default}`);
  return parts.join(", ");
}

function tableDiffRows(v2Tab, v4Tab) {
  const allCols = new Set([
    ...Object.keys(v2Tab || {}),
    ...Object.keys(v4Tab || {}),
  ]);
  const rows = [];
  for (const col of allCols) {
    const v2 = v2Tab?.[col];
    const v4 = v4Tab?.[col];
    const status = classifyDiff(v2, v4);
    rows.push({ col, v2, v4, status });
  }
  // Sort: OK last, diffs first; in groups, alphabetical
  const order = { TYPE_DIFF: 0, NEW_v4: 1, DROPPED_v4: 2, NULLABLE_DIFF: 3, DEFAULT_DIFF: 4, OK: 5 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.col.localeCompare(b.col));
  return rows;
}

function noteFor(status, col) {
  switch (status) {
    case "TYPE_DIFF":
      if (col.v2?.type === "timestamp" && col.v4?.type === "timestamptz")
        return "v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT.";
      return "Cần CAST trong INSERT.";
    case "NEW_v4":
      return col.v4?.default ? `Default v4 (${col.v4.default}) sẽ áp dụng.` : "Cột mới — sẽ null/default trong v2 data.";
    case "DROPPED_v4":
      return "v4 không còn cột này. Data sẽ mất nếu không thêm logic.";
    case "NULLABLE_DIFF":
      return "Constraint khác — kiểm tra row có NULL không.";
    case "DEFAULT_DIFF":
      return "Default expression khác — kiểm tra nếu rely on default.";
    default:
      return "";
  }
}

function renderTableSection(name, v2Tab, v4Tab) {
  const lines = [`## ${name}`, ""];
  if (!v2Tab && !v4Tab) {
    lines.push("_Không có ở cả v2 dump lẫn v4 schema (out of scope)._", "");
    return lines.join("\n");
  }
  if (!v2Tab) {
    lines.push(`> ⚠️  Bảng **không tồn tại** trong v2 dump. Skip migration cho bảng này (hoặc xác nhận tên khác).`, "");
    return lines.join("\n");
  }
  if (!v4Tab) {
    lines.push(`> ⚠️  Bảng **không tồn tại** trong v4 schema. Bỏ scope hoặc add table trước Stage 3.`, "");
    return lines.join("\n");
  }

  const rows = tableDiffRows(v2Tab, v4Tab);
  const summary = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const summaryStr = Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(", ");
  lines.push(`_Summary: ${summaryStr}_`, "");
  lines.push("| Column | v2 | v4 | Status | Notes |");
  lines.push("|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| \`${r.col}\` | ${formatCell(r.v2)} | ${formatCell(r.v4)} | **${r.status}** | ${noteFor(r.status, r)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderReport(v2, v4) {
  const dateStr = new Date().toISOString();
  const lines = [
    "# Schema Diff Report: Supabase v2.x → Chill Coffee ERP v4",
    "",
    `_Generated: ${dateStr}_`,
    "",
    "## Tổng quan",
    "",
    `- Bảng v2 (parsed): **${Object.keys(v2).length}**`,
    `- Bảng v4 (parsed): **${Object.keys(v4).length}**`,
    `- Bảng trong scope migration: **${SCOPE.length}**`,
    "",
    "**Status legend:**",
    "- `OK` — cùng tên, type, nullable, default",
    "- `TYPE_DIFF` — cùng tên, khác type (vd: `timestamp` vs `timestamptz`)",
    "- `NEW_v4` — chỉ có ở v4 (sẽ null/default cho data v2)",
    "- `DROPPED_v4` — chỉ có ở v2 (lost nếu không xử lý)",
    "- `NULLABLE_DIFF` — khác NOT NULL constraint",
    "- `DEFAULT_DIFF` — cùng tên/type nhưng default expression khác",
    "",
    "---",
    "",
  ];

  // Bảng trong scope nhưng không có ở v2 (out-of-scope warnings)
  const missingInV2 = SCOPE.filter((t) => !v2[t]);
  const missingInV4 = SCOPE.filter((t) => !v4[t]);
  if (missingInV2.length || missingInV4.length) {
    lines.push("## ⚠️  Cảnh báo phạm vi", "");
    if (missingInV2.length) {
      lines.push(`- Bảng KHÔNG tồn tại trong v2 dump: ${missingInV2.map((t) => `\`${t}\``).join(", ")}`);
      lines.push("  - → Hoặc tên bảng v2 khác, hoặc v2.x chưa có module này. Confirm trước Stage 3.");
    }
    if (missingInV4.length) {
      lines.push(`- Bảng KHÔNG tồn tại trong v4 schema: ${missingInV4.map((t) => `\`${t}\``).join(", ")}`);
    }
    lines.push("");
  }

  // Bảng có ở v2 nhưng ngoài scope (info, không phải warning)
  const v2NotInScope = Object.keys(v2).filter((t) => !SCOPE.includes(t)).sort();
  if (v2NotInScope.length) {
    lines.push("## Bảng ở v2 dump nhưng NGOÀI scope migration", "");
    lines.push(v2NotInScope.map((t) => `- \`${t}\` (${Object.keys(v2[t]).length} cột)`).join("\n"));
    lines.push("", "_Sales/inventory/safe nằm ở đây là expected. Nếu thấy bảng quan trọng → review lại scope._", "");
  }

  lines.push("---", "", "## Chi tiết per-table", "");
  for (const name of SCOPE) {
    lines.push(renderTableSection(name, v2[name], v4[name]));
  }

  lines.push("---", "");
  lines.push("## Bước tiếp theo");
  lines.push("");
  lines.push("1. Review từng table section bên trên.");
  lines.push("2. Nếu có nhiều `TYPE_DIFF` hoặc `DROPPED_v4` quan trọng → tạo `migration/mapping-rules.json` (xem `scripts/migrate/README.md`).");
  lines.push("3. Nếu mọi thứ là `OK` hoặc `NEW_v4` (default OK) → có thể chạy thẳng Stage 2.");
  lines.push("4. Lưu ý đặc biệt: cảnh báo `timestamp` vs `timestamptz` ở các cột thời gian → migration scripts đã xử lý nhưng cần verify ở Stage 4.");
  lines.push("");
  return lines.join("\n");
}

// Main
const args = parseArgs(process.argv);
console.log(`>>> Reading v2 dump: ${args.dump}`);
const v2 = loadSchema(args.dump);
console.log(`    Parsed ${Object.keys(v2).length} tables from v2 dump.`);

console.log(`>>> Reading v4 schema: ${args.target}`);
const v4 = loadSchema(args.target);
console.log(`    Parsed ${Object.keys(v4).length} tables from v4 schema.`);

const report = renderReport(v2, v4);
mkdirSync(dirname(args.outFile), { recursive: true });
writeFileSync(args.outFile, report, "utf8");
console.log(`\n✓ Diff report written: ${args.outFile}`);
console.log(`\nMở file để review, sau đó tạo migration/mapping-rules.json nếu cần (xem README).`);
