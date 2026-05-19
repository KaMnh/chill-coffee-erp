# Phase 1: Nền tảng & Bundled Supabase Stack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng nền tảng v4 — một dự án Next.js 15 + Tailwind mới, tái sử dụng nguyên tầng backend của v3, chạy cùng nguyên stack Supabase self-hosted trong một docker-compose; kết thúc khi `docker compose up` cho ra stack khỏe mạnh, timezone đúng `Asia/Ho_Chi_Minh`, và owner đăng nhập được. Chưa có UI nghiệp vụ.

**Architecture:** v4 là dự án mới trong thư mục `Chill Coffee ERP`. Tầng backend không-UI của v3 (`src/lib/**`, `src/hooks/**`, `src/middleware.ts`, `src/app/api/**`, `database/**`) được **port nguyên vẹn** — chỉ một sửa đổi nhỏ ở `src/lib/supabase/server.ts` để app trong container gọi Supabase qua hostname nội bộ. Stack Supabase self-hosted chính thức được nhúng vào repo tại `supabase/`; root `docker-compose.yml` dùng `include:` để gộp Supabase + service `app` thành một lệnh `docker compose up`.

**Tech Stack:** Next.js 15 (App Router, standalone) · React 19 · TypeScript strict · Tailwind CSS v4 · TanStack Query 5 · `@supabase/supabase-js` · Supabase self-hosted (Docker) · Node scripts (`.mjs`) cho db-init / seed / smoke-test.

**Quy ước chung khi thực thi:**
- Mọi lệnh shell chạy trên **Windows PowerShell**, cwd = thư mục dự án `C:\Users\RAZER 15\Documents\Claude\Projects\Chill Coffee ERP`.
- Path nguồn để port: `F:\Chill manager\v3\...`.
- Mỗi commit khi thực thi nên kèm trailer co-author theo quy ước harness.
- "Port" = copy file/thư mục y nguyên, **không sửa nội dung** (trừ chỗ ghi rõ).

---

## File Structure

Cây thư mục v4 sau khi hoàn thành Phase 1 (✎ = tạo mới ở Phase 1, ⇄ = port từ v3):

```
Chill Coffee ERP/
├── package.json                ✎ deps + scripts
├── tsconfig.json               ✎ strict, alias @/* , exclude supabase/
├── next.config.mjs             ✎ standalone output
├── postcss.config.mjs          ✎ Tailwind v4
├── Dockerfile                  ✎ multi-stage build cho service app
├── docker-compose.yml          ✎ root: include Supabase + service app
├── .env.example                ✎ template env cho app
├── .gitignore / .gitattributes ✎ (.gitattributes ép LF — tránh lỗi Kong)
├── design.md                   (đã có sẵn)
├── docs/superpowers/plans/      (chứa file plan này)
├── scripts/
│   ├── db-init.mjs              ✎ áp database/*.sql + set timezone
│   ├── seed.mjs                 ✎ tạo owner + integration_clients
│   └── smoke-test.mjs           ✎ kiểm tra kết nối E2E
├── database/                    ⇄ 000_reset, 001_schema..005_storage, migrations/
├── supabase/                    ✎ bundle Supabase self-hosted chính thức (docker-compose.yml, volumes/, .env)
└── src/
    ├── middleware.ts            ⇄
    ├── app/
    │   ├── layout.tsx           ✎ shell tối giản
    │   ├── providers.tsx        ⇄ (QueryClient)
    │   ├── page.tsx             ✎ placeholder
    │   ├── globals.css          ✎ @import "tailwindcss"
    │   └── api/                 ⇄ users, kiotviet, backup (6 route)
    ├── lib/                     ⇄ types, format, datetime, validation, data.ts, data/, kiotviet/, supabase/
    └── hooks/                   ⇄ use-supabase, use-*, queries/
```

**Lưu ý quyết định cấu trúc:**
- `supabase/` chứa bundle Supabase chính thức **để nguyên** — dễ cập nhật về sau. `tsconfig.json` phải `exclude` thư mục này (nếu không `tsc` sẽ cố biên dịch file TS trong `supabase/volumes/`).
- UI của v3 (`src/features/**`, `src/shared/**`, `src/app/page.tsx` thật, `components.tsx`, `panels.tsx`) **không port** ở Phase 1 — sẽ dựng lại bằng Tailwind ở Phase 2/3.

---

## Task 1: Khởi tạo repo + file cấu hình dự án

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `postcss.config.mjs`, `.gitignore`, `.gitattributes`

- [ ] **Step 1: `git init` trong thư mục dự án**

Run:
```powershell
git init
git branch -M main
```
Expected: `Initialized empty Git repository ...`

- [ ] **Step 2: Tạo `package.json`**

```json
{
  "name": "chill-coffee-erp",
  "version": "4.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3009",
    "build": "next build",
    "start": "next start -p 3009",
    "db:init": "node scripts/db-init.mjs",
    "db:seed": "node scripts/seed.mjs",
    "smoke": "node scripts/smoke-test.mjs"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.8",
    "@tanstack/react-query": "^5.100.7",
    "lucide-react": "^1.14.0",
    "next": "^15.3.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.15.18",
    "@types/react": "^19.0.12",
    "@types/react-dom": "^19.0.4",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 3: Tạo `tsconfig.json`** (giống v3, nhưng `exclude` thêm `supabase`)

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "supabase", "scripts"]
}
```

- [ ] **Step 4: Tạo `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone build: outputs `.next/standalone/server.js` for Docker.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
};

export default nextConfig;
```

- [ ] **Step 5: Tạo `postcss.config.mjs`** (Tailwind v4)

```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

- [ ] **Step 6: Tạo `.gitignore`**

```
node_modules/
.next/
out/
build/
next-env.d.ts
*.tsbuildinfo

# Env — KHÔNG commit secrets
.env
.env.local
supabase/.env

# Supabase runtime data (tạo lúc chạy)
supabase/volumes/db/data/
supabase/volumes/storage/

.DS_Store
```

- [ ] **Step 7: Tạo `.gitattributes`** (ép LF — bundle Supabase lỗi entrypoint Kong nếu file CRLF trên Windows)

```
* text=auto eol=lf
*.png binary
*.ico binary
*.jpg binary
```

- [ ] **Step 8: Cài dependencies**

Run: `npm install`
Expected: cài xong, tạo `package-lock.json`, không lỗi.

- [ ] **Step 9: Commit**

```powershell
git add .
git commit -m "chore: initialize Chill Coffee ERP v4 project skeleton"
```

---

## Task 2: App shell tối giản (Tailwind đã chạy)

**Files:**
- Create: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/providers.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Tạo `src/app/globals.css`** (Phase 1 chỉ import Tailwind; Phase 2 thêm `@theme` token)

```css
@import "tailwindcss";
```

- [ ] **Step 2: Tạo `src/app/providers.tsx`** (port nguyên từ v3 `src/app/providers.tsx`)

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1
          }
        }
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 3: Tạo `src/app/layout.tsx`** (tối giản — PWA/SwRegister để Phase 6)

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Chill Coffee ERP",
  description: "Hệ thống quản lý vận hành Chill Coffee Garden",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Tạo `src/app/page.tsx`** (placeholder — dùng class Tailwind để chứng minh Tailwind hoạt động)

```tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-50">
      <div className="rounded-2xl border border-neutral-800 px-8 py-6 text-center">
        <h1 className="text-2xl font-semibold">Chill Coffee ERP v4</h1>
        <p className="mt-1 text-sm text-neutral-400">Phase 1 — foundation đang chạy.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Verify build + dev render**

Run: `npm run build`
Expected: build PASS, có dòng `Route (app) ... /`.

Run: `npm run dev`, mở `http://localhost:3009`
Expected: thấy card "Chill Coffee ERP v4" trên nền đen, bo góc — chứng minh Tailwind compile đúng. Dừng dev server (Ctrl+C).

- [ ] **Step 6: Commit**

```powershell
git add .
git commit -m "feat: minimal Next.js + Tailwind app shell"
```

---

## Task 3: Port tầng thư viện backend (`src/lib/**`)

**Files:**
- Port: toàn bộ `F:\Chill manager\v3\src\lib\` → `src\lib\` (gồm `types.ts`, `format.ts`, `datetime.ts`, `validation.ts`, `data.ts`, `data/`, `kiotviet/`, `supabase/`)
- Modify: `src/lib/supabase/server.ts`

- [ ] **Step 1: Copy thư mục `src/lib`**

Run:
```powershell
Copy-Item -Recurse -Force "F:\Chill manager\v3\src\lib" "src\lib"
```
Expected: `src\lib\` xuất hiện với các file utils + 3 thư mục con `data/`, `kiotviet/`, `supabase/`.

- [ ] **Step 2: Sửa `src/lib/supabase/server.ts`** — cho phép app trong container gọi Supabase qua hostname nội bộ `kong`

Có **2 chỗ** giống hệt nhau trong file (trong `getServiceRoleClient` và `getUserClient`). Thay cả hai:

Tìm (xuất hiện 2 lần):
```ts
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
```
Thay bằng:
```ts
  const url = process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
```

> Lý do (deviation duy nhất khỏi "port nguyên"): browser luôn dùng `NEXT_PUBLIC_SUPABASE_URL` (URL công khai); nhưng app chạy trong container Docker phải gọi Supabase qua `http://kong:8000` trên network nội bộ. `SUPABASE_INTERNAL_URL` rỗng khi dev bằng `npm run dev` → fallback về URL công khai, không ảnh hưởng. `src/lib/supabase/client.ts` (browser) **không** đổi.

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: PASS, không lỗi.
> Nếu `tsc` báo thiếu import từ `@/shared/...` hoặc `@/features/...`: nếu file đó là type/logic thuần (không JSX) thì port thêm file đó; nếu là component UI thì ghi chú lại — sẽ giải quyết ở Phase 2/3.

- [ ] **Step 4: Commit**

```powershell
git add .
git commit -m "feat: port v3 backend lib layer (data, kiotviet, supabase, utils)"
```

---

## Task 4: Port tầng hooks (`src/hooks/**`)

**Files:**
- Port: toàn bộ `F:\Chill manager\v3\src\hooks\` → `src\hooks\` (gồm `use-supabase.ts`, `use-auth-cookie-sync.ts`, `use-pos-sync.ts`, `use-realtime-invalidate.ts`, `queries/`)

- [ ] **Step 1: Copy thư mục `src/hooks`**

Run:
```powershell
Copy-Item -Recurse -Force "F:\Chill manager\v3\src\hooks" "src\hooks"
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add .
git commit -m "feat: port v3 hooks layer (TanStack Query hooks + realtime/pos-sync)"
```

---

## Task 5: Port middleware + API routes

**Files:**
- Port: `F:\Chill manager\v3\src\middleware.ts` → `src\middleware.ts`
- Port: `F:\Chill manager\v3\src\app\api\` → `src\app\api\` (6 route: `users`, `users/[id]`, `kiotviet/config`, `kiotviet/sync`, `kiotviet/webhook/[secret]`, `backup/full`)

- [ ] **Step 1: Copy middleware + API routes**

Run:
```powershell
Copy-Item -Force "F:\Chill manager\v3\src\middleware.ts" "src\middleware.ts"
Copy-Item -Recurse -Force "F:\Chill manager\v3\src\app\api" "src\app\api"
```

- [ ] **Step 2: Verify TypeScript + build**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run build`
Expected: build PASS; danh sách Route có cả các route `/api/...`.

- [ ] **Step 3: Commit**

```powershell
git add .
git commit -m "feat: port v3 middleware and API routes"
```

---

## Task 6: Port SQL database

**Files:**
- Port: `F:\Chill manager\v3\database\` → `database\` (`000_reset.sql`, `001_schema.sql`, `002_functions.sql`, `003_rls.sql`, `004_seed.sql`, `005_storage.sql`, `README.md`, `migrations/`)

- [ ] **Step 1: Copy thư mục `database`**

Run:
```powershell
Copy-Item -Recurse -Force "F:\Chill manager\v3\database" "database"
```
Expected: `database\` có 6 file `.sql` + `README.md` + thư mục `migrations/`.

> `000_reset.sql` là DESTRUCTIVE — **không bao giờ chạy tự động**. `db-init.mjs` (Task 8) chỉ áp `001`–`005`. Thư mục `migrations/` là nơi đặt migration cộng thêm về sau (Phase 4/5).

- [ ] **Step 2: Commit**

```powershell
git add .
git commit -m "chore: port v3 database SQL (schema, functions, RLS, seed, storage)"
```

---

## Task 7: Nhúng stack Supabase self-hosted

**Files:**
- Create: `supabase/` (bundle Docker chính thức của Supabase) + `supabase/.env`

- [ ] **Step 1: Lấy bundle Docker chính thức của Supabase**

Run (sparse checkout cho nhanh):
```powershell
git clone --filter=blob:none --no-checkout --depth=1 https://github.com/supabase/supabase .tmp-supabase
cd .tmp-supabase
git sparse-checkout init --cone
git sparse-checkout set docker
git checkout
cd ..
Copy-Item -Recurse -Force ".tmp-supabase\docker\*" "supabase\"
Copy-Item -Force "supabase\.env.example" "supabase\.env"
Remove-Item -Recurse -Force ".tmp-supabase"
```
Expected: `supabase\` có `docker-compose.yml`, `.env.example`, `.env`, `volumes/`, `utils/`.

- [ ] **Step 2: Pin image tags**

Mở `supabase/docker-compose.yml`. Với mỗi service có `image: ...:latest` hoặc tag thả nổi, ghi cố định version hiện tại (xem giá trị thực trong file vừa tải — Supabase đã pin sẵn phần lớn). Ghi lại danh sách image+tag vào cuối file plan này khi thực thi, để tái lập được.

- [ ] **Step 3: Sinh secret và điền `supabase/.env`**

Sinh các secret bằng `openssl` (Git Bash trên Windows có sẵn `openssl`):
```bash
openssl rand -base64 48   # SECRET_KEY_BASE  (>= 64 ký tự — chạy lại nếu ngắn)
openssl rand -hex 16      # VAULT_ENC_KEY    (đúng 32 ký tự hex)
openssl rand -base64 24   # PG_META_CRYPTO_KEY, LOGFLARE_*_ACCESS_TOKEN
openssl rand -hex 16      # POSTGRES_PASSWORD (chỉ chữ+số — tránh lỗi URL-encode), S3 keys, MINIO_ROOT_PASSWORD
```
Sinh `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`: chạy `sh supabase/utils/generate-keys.sh` rồi `sh supabase/utils/add-new-auth-keys.sh` (theo hướng dẫn https://supabase.com/docs/guides/self-hosting/docker), HOẶC dùng trang sinh key trong tài liệu self-hosting.

Trong `supabase/.env`, đặt **tất cả** các biến (KHÔNG để giá trị mặc định của `.env.example`):
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`
- `SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY`
- `LOGFLARE_PUBLIC_ACCESS_TOKEN`, `LOGFLARE_PRIVATE_ACCESS_TOKEN`
- `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET`, `MINIO_ROOT_PASSWORD`
- `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` (mật khẩu phải có ít nhất 1 chữ cái)
- `SUPABASE_PUBLIC_URL=http://localhost:8000`, `API_EXTERNAL_URL=http://localhost:8000`, `SITE_URL=http://localhost:3009`

- [ ] **Step 4: Khởi động thử riêng stack Supabase**

Run:
```powershell
cd supabase
docker compose up -d
docker compose ps
```
Expected: sau ~1 phút, tất cả service `Up (healthy)`. Nếu service `kong` lỗi entrypoint → file bị CRLF; chuẩn hoá `supabase/` về LF rồi `docker compose down && docker compose up -d`.

Mở `http://localhost:8000` → Supabase Studio hỏi basic auth (dùng `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`). Sau khi xác nhận:
```powershell
docker compose down
cd ..
```

- [ ] **Step 5: Commit** (`.env` đã bị `.gitignore` loại)

```powershell
git add .
git commit -m "chore: vendor self-hosted Supabase Docker stack"
```

---

## Task 8: Dockerfile + root docker-compose + .env.example + script db-init

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.env.example`, `scripts/db-init.mjs`

- [ ] **Step 1: Tạo `Dockerfile`** (port từ v3, multi-stage standalone, kèm `postgresql-client` cho route backup)

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# postgresql-client cung cấp pg_dump cho /api/backup/full.
RUN apk add --no-cache postgresql-client
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

> Build sẽ cần thư mục `public/` tồn tại. Nếu chưa có, tạo `public/.gitkeep` rỗng.

- [ ] **Step 2: Tạo `docker-compose.yml`** (root — gộp Supabase + service `app`)

```yaml
name: chill-coffee-erp

# Gộp nguyên stack Supabase self-hosted. Yêu cầu Docker Compose >= 2.23.
include:
  - path: supabase/docker-compose.yml
    env_file: supabase/.env

services:
  app:
    container_name: chill-app
    restart: unless-stopped
    build:
      context: .
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
        NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-http://localhost:3009}
    env_file: .env
    environment:
      NODE_ENV: production
      # Server-side gọi Supabase qua hostname nội bộ Kong trên network chung.
      SUPABASE_INTERNAL_URL: http://kong:8000
    ports:
      - "${APP_PORT:-3009}:3000"
    depends_on:
      - kong
      - db
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 3: Tạo `.env.example`** (env cho app — Supabase có `.env` riêng tại `supabase/.env`)

```
# Chill Coffee ERP v4 — App environment.
# Copy file này thành `.env`, điền giá trị thật. Stack Supabase có env riêng ở supabase/.env

# URL Supabase (Kong gateway) mà BROWSER dùng.
#   Dev (npm run dev trên host): http://localhost:8000
#   Prod: domain Supabase công khai
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000

# Copy 2 giá trị này từ supabase/.env sau khi đã sinh key Supabase:
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# URL công khai của app + port host
NEXT_PUBLIC_APP_URL=http://localhost:3009
APP_PORT=3009

# POS ingest (KiotViet). INGEST_CLIENT_SECRET = plaintext; bản hash bcrypt nằm ở bảng integration_clients.
INGEST_CLIENT_ID=chill-erp
INGEST_CLIENT_SECRET=

# Tùy chọn: secret cho cron polling (openssl rand -hex 32). Rỗng = tắt cron.
CRON_SECRET=

# Tùy chọn: admin Postgres URL cho tính năng backup DB.
# Stack gộp: postgresql://postgres:<POSTGRES_PASSWORD>@db:5432/postgres
POSTGRES_BACKUP_URL=

# Server-only — docker-compose tự set cho container app. Khi `npm run dev` trên host: để rỗng.
SUPABASE_INTERNAL_URL=
```

- [ ] **Step 4: Tạo `scripts/db-init.mjs`** (áp `database/001`–`005` + ép timezone)

```js
// scripts/db-init.mjs — áp schema SQL của Chill vào Postgres của stack Supabase đã chạy,
// rồi ép quy ước timezone Asia/Ho_Chi_Minh.
// Chạy SAU `docker compose up -d`:  node scripts/db-init.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SQL_FILES = [
  "database/001_schema.sql",
  "database/002_functions.sql",
  "database/003_rls.sql",
  "database/004_seed.sql",
  "database/005_storage.sql",
];

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

const POSTGRES_PASSWORD = readEnvValue("supabase/.env", "POSTGRES_PASSWORD");

function psql(sql) {
  execFileSync(
    "docker",
    [
      "compose", "exec", "-T",
      "-e", `PGPASSWORD=${POSTGRES_PASSWORD}`,
      "db",
      "psql", "-U", "postgres", "-d", "postgres", "-h", "127.0.0.1",
      "-v", "ON_ERROR_STOP=1", "-f", "-",
    ],
    { input: sql, stdio: ["pipe", "inherit", "inherit"] }
  );
}

for (const file of SQL_FILES) {
  console.log(`\n>>> Áp ${file}`);
  psql(readFileSync(file, "utf8"));
}

console.log("\n>>> Ép timezone Asia/Ho_Chi_Minh");
psql("ALTER DATABASE postgres SET timezone TO 'Asia/Ho_Chi_Minh';");

console.log("\nXong. Restart để connection pool nhận timezone mới:");
console.log("  docker compose restart db rest realtime");
```

- [ ] **Step 5: Verify áp schema**

```powershell
if (-not (Test-Path public)) { New-Item -ItemType Directory public | Out-Null; New-Item -ItemType File public\.gitkeep | Out-Null }
docker compose up -d
docker compose ps
```
Expected: tất cả service Supabase + `app` đều `Up`/`healthy` (service `app` build từ Dockerfile).

> Trước khi `up`: đảm bảo `.env` (root) đã tồn tại — copy từ `.env.example`, và copy `NEXT_PUBLIC_SUPABASE_ANON_KEY` (= `ANON_KEY`) + `SUPABASE_SERVICE_ROLE_KEY` (= `SERVICE_ROLE_KEY`) từ `supabase/.env` sang.

Run: `npm run db:init`
Expected: in lần lượt `>>> Áp database/001..005`, không lỗi; cuối cùng `>>> Ép timezone`.

Run:
```powershell
docker compose restart db rest realtime
docker compose exec -T -e PGPASSWORD=<POSTGRES_PASSWORD> db psql -U postgres -h 127.0.0.1 -d postgres -c "SELECT current_setting('timezone');"
```
Expected: `Asia/Ho_Chi_Minh`.

```powershell
docker compose exec -T -e PGPASSWORD=<POSTGRES_PASSWORD> db psql -U postgres -h 127.0.0.1 -d postgres -c "SELECT count(*) FROM public.employees;"
```
Expected: trả về `0` (bảng tồn tại → schema đã áp).

- [ ] **Step 6: Commit**

```powershell
git add .
git commit -m "feat: bundled docker-compose (app + Supabase) and db-init script"
```

---

## Task 9: Seed owner + integration client

**Files:**
- Create: `scripts/seed.mjs`

Tham chiếu schema (từ `database/001_schema.sql`):
- `employees(code, name, position, hourly_rate, is_active)`
- `employee_accounts(employee_id, auth_user_id, role, status)` — `role` ∈ owner/manager/staff_operator/employee_viewer
- `profiles(id, display_name)`
- `integration_clients(client_id, client_secret_hash, name, is_active)` — hash bằng `crypt(secret, gen_salt('bf'))`

- [ ] **Step 1: Tạo `scripts/seed.mjs`**

```js
// scripts/seed.mjs — tạo tài khoản owner đầu tiên + integration client cho KiotViet ingest.
// Chạy SAU db-init:  node scripts/seed.mjs
// Biến môi trường yêu cầu: OWNER_EMAIL, OWNER_PASSWORD (>= 8 ký tự).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

const SUPABASE_URL = readEnvValue(".env", "NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = readEnvValue(".env", "SUPABASE_SERVICE_ROLE_KEY");
const INGEST_CLIENT_ID = readEnvValue(".env", "INGEST_CLIENT_ID");
const INGEST_CLIENT_SECRET = readEnvValue(".env", "INGEST_CLIENT_SECRET");
const POSTGRES_PASSWORD = readEnvValue("supabase/.env", "POSTGRES_PASSWORD");

const ownerEmail = process.env.OWNER_EMAIL;
const ownerPassword = process.env.OWNER_PASSWORD;
if (!ownerEmail || !ownerPassword || ownerPassword.length < 8) {
  throw new Error("Cần OWNER_EMAIL và OWNER_PASSWORD (>= 8 ký tự).");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1) Tạo auth user (auto-confirm email)
const { data: authData, error: authErr } = await admin.auth.admin.createUser({
  email: ownerEmail,
  password: ownerPassword,
  email_confirm: true,
});
if (authErr || !authData.user) throw new Error(`Tạo auth user lỗi: ${authErr?.message}`);
const authUserId = authData.user.id;
console.log("✓ Auth user:", authUserId);

// 2) employees
const { data: emp, error: empErr } = await admin
  .from("employees")
  .insert({ name: "Owner", position: "Chủ quán", hourly_rate: 0, is_active: true })
  .select("id")
  .single();
if (empErr || !emp) throw new Error(`Tạo employee lỗi: ${empErr?.message}`);
console.log("✓ Employee:", emp.id);

// 3) employee_accounts (role owner)
const { error: accErr } = await admin.from("employee_accounts").insert({
  employee_id: emp.id,
  auth_user_id: authUserId,
  role: "owner",
  status: "active",
});
if (accErr) throw new Error(`Tạo employee_account lỗi: ${accErr.message}`);
console.log("✓ employee_account: owner/active");

// 4) profiles
await admin.from("profiles").upsert(
  { id: authUserId, display_name: "Owner" },
  { onConflict: "id" }
);

// 5) integration_clients — dùng crypt() nên insert qua psql
const sql =
  `insert into public.integration_clients (client_id, client_secret_hash, name, is_active) ` +
  `values ('${INGEST_CLIENT_ID}', crypt('${INGEST_CLIENT_SECRET}', gen_salt('bf')), 'Chill ERP Next.js', true) ` +
  `on conflict (client_id) do nothing;`;
execFileSync(
  "docker",
  ["compose", "exec", "-T", "-e", `PGPASSWORD=${POSTGRES_PASSWORD}`, "db",
   "psql", "-U", "postgres", "-d", "postgres", "-h", "127.0.0.1", "-v", "ON_ERROR_STOP=1", "-c", sql],
  { stdio: ["pipe", "inherit", "inherit"] }
);
console.log("✓ integration_clients:", INGEST_CLIENT_ID);
console.log("\nSeed xong.");
```

> `INGEST_CLIENT_SECRET` trong `.env` phải có giá trị thật trước khi chạy (sinh bằng `openssl rand -base64 32`).

- [ ] **Step 2: Chạy seed**

Run (PowerShell):
```powershell
$env:OWNER_EMAIL = "owner@chill.local"
$env:OWNER_PASSWORD = "chill-owner-2026"
npm run db:seed
```
Expected: in `✓ Auth user`, `✓ Employee`, `✓ employee_account`, `✓ integration_clients`, `Seed xong.`

- [ ] **Step 3: Commit**

```powershell
git add .
git commit -m "feat: owner + integration client seed script"
```

---

## Task 10: Kiểm thử nghiệm thu Phase 1 (end-to-end)

**Files:**
- Create: `scripts/smoke-test.mjs`

- [ ] **Step 1: Tạo `scripts/smoke-test.mjs`** (đăng nhập owner + đọc dữ liệu có RLS)

```js
// scripts/smoke-test.mjs — kiểm tra chuỗi anon-key + Auth (GoTrue) + RLS hoạt động.
// Chạy khi stack đang up:  OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/smoke-test.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

const url = readEnvValue(".env", "NEXT_PUBLIC_SUPABASE_URL");
const anonKey = readEnvValue(".env", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email: process.env.OWNER_EMAIL,
  password: process.env.OWNER_PASSWORD,
});
if (authErr || !auth.user) throw new Error(`Đăng nhập owner lỗi: ${authErr?.message}`);
console.log("✓ Owner đăng nhập OK:", auth.user.email);

const { data, error } = await supabase
  .from("employee_accounts")
  .select("role,status")
  .limit(1);
if (error) throw new Error(`Đọc có RLS lỗi: ${error.message}`);
if (!data || data.length === 0) throw new Error("Không đọc được employee_accounts (RLS chặn?)");
console.log("✓ Đọc có RLS OK:", data[0]);

console.log("\nSmoke test PASS.");
```

- [ ] **Step 2: Chạy toàn bộ stack + kiểm tra**

Run:
```powershell
docker compose up -d
docker compose ps
```
Expected ✅ — **tiêu chí nghiệm thu Phase 1:**
1. Mọi service (Supabase + `app`) trạng thái `Up` / `(healthy)`.
2. Timezone: lệnh `psql ... -c "SELECT current_setting('timezone');"` → `Asia/Ho_Chi_Minh`.
3. Schema: `psql ... -c "SELECT count(*) FROM public.employees;"` chạy được.
4. App: `curl http://localhost:3009` (hoặc mở trình duyệt) → trang placeholder "Chill Coffee ERP v4".
5. Studio: `http://localhost:8000` mở được (basic auth).

Run:
```powershell
$env:OWNER_EMAIL = "owner@chill.local"
$env:OWNER_PASSWORD = "chill-owner-2026"
npm run smoke
```
Expected: `✓ Owner đăng nhập OK` + `✓ Đọc có RLS OK` + `Smoke test PASS.`

- [ ] **Step 3: Commit + tag**

```powershell
git add .
git commit -m "test: Phase 1 end-to-end smoke test"
git tag v4-phase-1
```

---

## Verification tổng thể Phase 1

Phase 1 hoàn tất khi **tất cả** đạt:
- [ ] `docker compose up -d` → mọi container healthy (Supabase stack + `app`).
- [ ] `current_setting('timezone')` = `Asia/Ho_Chi_Minh`.
- [ ] `database/001`–`005` đã áp (truy vấn bảng `employees` chạy được).
- [ ] `npm run dev` → `http://localhost:3009` hiện trang placeholder có style Tailwind.
- [ ] `npm run smoke` PASS (owner login qua GoTrue + đọc có RLS).
- [ ] `npx tsc --noEmit` và `npm run build` đều PASS.
- [ ] Tầng backend của v3 (`lib`, `hooks`, `middleware`, `api`, `database`) đã port; chưa có UI nghiệp vụ — đúng phạm vi.

Phase 2 (design system Tailwind + thư viện component) bắt đầu sau khi các mục trên xanh.

---

## Self-Review (đã rà theo spec Phase 1 của master plan)

- **Spec coverage:** scaffold Next+Tailwind (Task 1–2) · port lib/hooks/middleware/api (Task 3–5) · port database (Task 6) · docker-compose gộp Supabase (Task 7–8) · script db-init + timezone (Task 8) · seed owner + integration_clients (Task 9) · verify container/timezone/connectivity/login (Task 10). Khớp đủ.
- **Placeholder:** không có "TBD/TODO"; mọi file mới có nội dung đầy đủ; file port là lệnh copy cụ thể.
- **Type consistency:** sửa `server.ts` dùng đúng tên biến `SUPABASE_INTERNAL_URL`; script đọc đúng tên biến trong `.env` / `supabase/.env`.
- **Lưu ý phụ thuộc:** Task 3 có ghi chú xử lý nếu `tsc` phát hiện import UI ngoài dự kiến.
