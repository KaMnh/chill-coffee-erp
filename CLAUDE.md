# Chill Coffee ERP — Hướng dẫn dự án

ERP cho quán cà phê (tiếng Việt). Stack: **Next.js 15 App Router · React 19 · TypeScript · Supabase (Postgres local) · pgTAP · Vitest · Tailwind 4 / Radix UI · TanStack Query · Recharts · Docker + GitHub Actions**.

- DB là **Supabase local** (không phải cloud MCP). Query: `docker exec -i supabase-db psql`. Tài khoản test: `owner@chill.local`.
- Dev server ở **port 3009**. KHÔNG chạy `npm run build` khi `next dev` đang chạy (clobber `.next`). CI verify khi push lên main; release Docker khi tag `v*`.
- Lệnh kiểm thử: `npm run test:run` (Vitest) · `npm run pgtap` · `npm run verify:phase` (chạy cả hai).

---

## ⚠️ Quy trình bắt buộc: Plan / Spec → Codex review

**Mọi plan và spec do Claude Code viết sẽ được đưa cho Codex review** để xác minh: (1) nội dung **đúng**, và (2) **cover hết** tất cả yêu cầu. Vì vậy khi viết plan/spec, phải viết để một reviewer bên ngoài (Codex) tự kiểm tra được, không cần ngữ cảnh chat:

- **Self-contained**: nêu rõ mục tiêu, scope (in/out), đường dẫn file cụ thể, và giả định.
- **Checklist coverage**: liệt kê TỪNG yêu cầu của user thành mục có thể tick → để Codex đối chiếu không sót.
- **Acceptance criteria + test plan**: nêu cách verify (Vitest/pgTAP nào, kịch bản edge case).
- **Đánh số bước** rõ ràng, mỗi bước một thay đổi kiểm chứng được.
- Dùng skill `superpowers:writing-plans` để soạn plan; nếu cần Claude tự gọi Codex thì dùng `codex:rescue` / `/codex` (xem mục Review bên dưới). Mặc định: user tự đưa cho Codex.
- Brainstorm chat chỉ ra spec/prompt rồi dừng; code & planning chi tiết làm ở chat khác.

---

## Skills — khi nào dùng cái gì

Gọi skill qua tool `Skill`; slash command gõ `/<tên>`. Nếu có ≥1% khả năng một skill áp dụng → gọi để kiểm tra. Thứ tự ưu tiên: **process skill trước** (brainstorming, debugging, TDD) rồi mới **implementation skill**.

### 1. Quy trình cốt lõi — `superpowers:*` (cân nhắc TRƯỚC mọi việc)
| Skill | Dùng khi |
|---|---|
| `brainstorming` | Trước mọi việc sáng tạo: thêm feature/component/hành vi mới → làm rõ ý định & yêu cầu |
| `writing-plans` | Có spec → viết plan nhiều bước trước khi đụng code (xuất plan để Codex review) |
| `executing-plans` / `subagent-driven-development` | Thực thi plan đã viết, có checkpoint review |
| `test-driven-development` | Implement feature/bugfix → viết test trước |
| `systematic-debugging` | Gặp bug / test fail / hành vi lạ → điều tra trước khi sửa |
| `verification-before-completion` | Trước khi tuyên bố "xong/đã sửa": chạy lệnh verify, có bằng chứng |
| `requesting-code-review` / `receiving-code-review` | Hoàn tất task / nhận feedback review |
| `using-git-worktrees` | Bắt đầu việc cần workspace cô lập |
| `dispatching-parallel-agents` | ≥2 task độc lập chạy song song được |
| `finishing-a-development-branch` | Implement xong, hết test → quyết định merge/PR |
| `writing-skills` | Tạo/sửa skill mới |

### 2. Stack của dự án (dùng thường xuyên)
| Skill | Dùng khi |
|---|---|
| `supabase:supabase` | Bất kỳ việc gì với Supabase: DB, Auth, RLS, migration, edge function, client `@supabase/ssr` |
| `supabase:supabase-postgres-best-practices` | Viết/tối ưu query, thiết kế schema, index Postgres |
| `vercel:nextjs` | Routing, Server Components/Actions, layout, data fetching App Router |
| `vercel:shadcn` | Cài/compose component shadcn-ui, theming Tailwind |
| `vercel:react-best-practices` | Review chất lượng sau khi sửa nhiều file `.tsx` |
| `frontend-design:frontend-design` | Dựng UI/page/app có chất lượng thiết kế cao, tránh "AI aesthetic" |
| `vercel:vercel-functions` / `next-cache-components` | Serverless/Fluid Compute, PPR, `use cache`, caching |

### 3. Review & chất lượng code
| Lệnh / Skill | Dùng khi |
|---|---|
| `/code-review` | Review diff hiện tại (bug + dọn dẹp); `ultra` = multi-agent cloud; `--fix` để áp dụng |
| `/simplify` | Dọn code đã đổi cho gọn/đúng altitude (chỉ chất lượng, không hunt bug) |
| `/review` · `/security-review` | Review PR · security review nhánh hiện tại |
| `/verify` · `/run` | Chạy app thật để xác nhận thay đổi hoạt động (không chỉ test) |
| `codex:rescue` (`/codex`) | Khi Claude bí, cần pass thứ hai, root-cause sâu, hoặc giao task lớn cho Codex |
| `codex:setup` | Kiểm tra Codex CLI sẵn sàng + bật/tắt cổng review lúc dừng |

### 4. Nghiên cứu & tài liệu
| Skill | Dùng khi |
|---|---|
| `deep-research` | Báo cáo nghiên cứu nhiều nguồn, fact-checked (làm rõ scope trước nếu mơ hồ) |
| context7 (MCP) | Tra tài liệu chính xác của thư viện/SDK/CLI — ưu tiên hơn web search cho docs |
| `claude-api` | Hỏi về Claude/Anthropic API: model id, pricing, tool use, streaming, caching |
| `anthropic-skills:docx/pdf/pptx/xlsx` | Tạo/đọc/sửa Word · PDF · slide · Excel/CSV |

### 5. CLAUDE.md, cấu hình & tự động hoá
| Skill | Dùng khi |
|---|---|
| `claude-md-management:revise-claude-md` | Cập nhật CLAUDE.md với điều học được trong session |
| `claude-md-management:claude-md-improver` | Audit/cải thiện CLAUDE.md theo template |
| `update-config` | Sửa `settings.json`: hook, permission, env, hành vi tự động ("from now on when X") |
| `claude-code-setup:claude-automation-recommender` | Gợi ý hook/subagent/skill/MCP cho repo |
| `/schedule` · `/loop` | Lịch cron cloud agent · chạy lặp theo interval |
| `keybindings-help` | Tuỳ biến phím tắt `~/.claude/keybindings.json` |

### 6. Animation & Vercel infra (khi cần)
- `gsap-skills:*` — animation: `gsap-core`, `gsap-react`, `gsap-scrolltrigger`, `gsap-timeline`, `gsap-plugins`, `gsap-performance`, `gsap-utils`.
- `vercel:deploy` / `vercel:env` / `vercel:vercel-cli` / `deployments-cicd` — deploy & quản lý env trên Vercel (chỉ khi thực sự deploy lên Vercel).

> Đây là index để biết skill nào tồn tại. Mô tả đầy đủ + checklist nằm trong chính skill — luôn `Skill`-invoke để đọc bản mới nhất, đừng dựa vào trí nhớ.
