# Employee Self-Check-in — Operator Runbook

> Target audience: shop owner / operator deploying or maintaining the
> employee self-check-in feature. Assumes a running Chill Coffee ERP stack
> (see `deploy/dockge/README.md`).

---

## 1. Security prerequisites (HARD — all three required)

### 1a. Single trusted reverse proxy

The check-in IP gate is only trustworthy when **exactly one reverse proxy**
(nginx, Caddy, Traefik, …) sits between the public internet and the app
container. That proxy must:

1. Be the **only** listener reachable from outside the server. The app port
   (`APP_PORT`, default `3009`) is bound to `127.0.0.1` in `compose.yaml` and
   is not reachable off-host — do not change this binding.
2. **Set the real client IP.** A plain proxy appends it to `x-forwarded-for`.
   **Behind Cloudflare you MUST set `CHECKIN_TRUSTED_IP_HEADER=cf-connecting-ip`** —
   the right-most `x-forwarded-for` hop is a Cloudflare **edge** IP that *rotates per
   request*, so the anchor IP and the employee's IP never match and every check-in
   fails. `cf-connecting-ip` is the stable real ISP IP that Cloudflare sets (and
   overwrites if a client tries to forge it). When that header is set it is the
   **only** trusted source: a request missing a valid value is **rejected
   (fail-closed)** — the app never downgrades to the spoofable `x-forwarded-for`
   chain. For full anti-spoof, also restrict the origin firewall to Cloudflare IP
   ranges (or enable Cloudflare Authenticated Origin Pulls), so the origin can only
   be reached *through* Cloudflare.
3. **Inject the `x-checkin-proxy-secret` header** on every request, using the
   value you put in `CHECKIN_PROXY_SECRET`. The app rejects check-in requests
   that arrive without this header (returns `503`), so bypassing the proxy is
   useless even if the attacker somehow reaches the raw port.

Example nginx location block:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3009;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   x-checkin-proxy-secret "YOUR_CHECKIN_PROXY_SECRET_HERE";
    proxy_set_header   Host $host;
}
```

### 1b. NTP time synchronisation

The anchor IP freshness check is computed in Postgres using `now()` against
the timestamp stored in `checkin_anchor`. If the server clock drifts, anchors
may be incorrectly considered stale (returning `503`) or — in theory — still
valid past their window. Ensure the host runs a time-sync daemon:

```bash
# Ubuntu / Debian
systemctl status systemd-timesyncd
timedatectl show | grep NTPSynchronized   # must be "yes"
```

### 1c. Wi-Fi-only rule (network enforcement)

Employees must be on **shop Wi-Fi** to check in; mobile data (4G/5G) is
blocked because the IP gate only allows the shop's public IP.

- Post the Wi-Fi SSID + password in the staff area.
- The router's NAT must give all Wi-Fi clients a single shared public IP (the
  standard case for home/small-business routers).
- If the router changes the public IP (CGNAT, ISP rotation), the owner must
  re-anchor — see section 5.

---

## 2. Environment variables

Set these in `deploy/dockge/.env` (Section 13). All are forwarded into the
app container by `compose.yaml`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `CHECKIN_PROXY_SECRET` | **Yes** | _(empty = disabled)_ | Long random string the reverse proxy injects as `x-checkin-proxy-secret`. Generate: `openssl rand -hex 32`. |
| `CHECKIN_TRUSTED_PROXY_COUNT` | No | `1` | Trusted `x-forwarded-for` hops. **Ignored** when `CHECKIN_TRUSTED_IP_HEADER` is set. |
| `CHECKIN_TRUSTED_IP_HEADER` | **Behind Cloudflare** | _(empty)_ | Set to `cf-connecting-ip` behind Cloudflare. When set it is the ONLY IP source — a missing/invalid value → request **rejected** (fail-closed), no `x-forwarded-for` fallback. Leave empty only for a plain `nginx → app` (no platform proxy). |
| `CHECKIN_RATE_MAX` | No | `10` | Max check-in attempts per window per process. |
| `CHECKIN_RATE_WINDOW_MS` | No | `60000` | Rate-limit window in milliseconds (default: 60 s). |

> **Rate-limiter scope:** the limiter is in-process. It resets on container
> restart and is not shared across multiple replicas if you scale horizontally.

---

## 3. Owner setup flow

### 3a. Provision an `employee_self_service` account

1. In the ERP, go to **Settings → Tài khoản → Mời nhân viên**.
2. Send an invitation to the employee's email.
3. The employee accepts the invite and sets a password.
4. Owner approves the account. When approving, select role
   **`employee_self_service`** from the role dropdown.

> Role ceiling: only an `owner` can grant the `owner` role. Managers and
> operators cannot elevate themselves or others to `owner`.

### 3b. Mark the POS device as an anchor

1. From the **shop's Wi-Fi network** (not mobile data), open the ERP on the
   POS device (or any device on the shop network).
2. Go to **Settings → Chấm công → Anchor IP hiện tại**.
3. Click **"Chốt IP này làm anchor"**. The current public IP is saved with a
   timestamp.

> The gate cannot be enabled until at least one anchor exists with a recorded
> IP. The check-in endpoint returns `503` until an anchor is registered.

### 3c. Enable the gate

In the same panel, toggle **"Bật xác thực IP"** to `on`. This writes
`checkin_enabled = true` to `app_settings`.

### 3d. Freshness window

The anchor IP is considered stale after the freshness window (`grace_hours` in
the `checkin_network` setting, default 12 h). A stale anchor causes all check-ins
to return `503`. To keep the IP fresh automatically, leave the ERP app **open on
the anchored POS device**: it pings the heartbeat route on focus + every 6 h.

**Token-only heartbeat (important):** the heartbeat authenticates by the
**device token** stored on the anchored device when the owner marked it — it does
**NOT** require an owner session. So the POS can stay logged in as a **manager or
staff** and still keep the anchor IP fresh; the owner only needs to mark the
device once. The route is `POST /api/shop-presence/heartbeat` (device token +
server-read source IP; `record_shop_anchor_heartbeat` is service-role-only). If
the ISP changes the IP, the next heartbeat updates it automatically; if the app
is closed past `grace_hours`, re-open it (or re-anchor — section 5).

---

## 4. Employee check-in flow

1. Employee connects to **shop Wi-Fi**.
2. Opens the ERP app on their phone and navigates to **Chấm công**.
3. Taps **"Bắt đầu ca"**.
4. The app calls `/api/checkin`, which:
   - Verifies the `x-checkin-proxy-secret` header (proxy-secret gate).
   - Extracts the real client IP — from `CHECKIN_TRUSTED_IP_HEADER` when set
     (`cf-connecting-ip` behind Cloudflare), otherwise from `x-forwarded-for`.
   - Checks the IP against the anchor (fails with `403` if mismatch).
   - Checks anchor freshness (fails with `503` if stale).
   - Inserts a `shift_assignments` row, stamping `check_in_ip` and
     `check_in_user_agent`.
5. On success, the screen shows the shift start time.

---

## 5. Re-anchoring after IP change

When the shop's public IP changes (ISP rotation, router reboot, CGNAT
re-assignment):

1. Connect a device to shop Wi-Fi.
2. Go to **Settings → Chấm công → Anchor IP hiện tại**.
3. Click **"Chốt IP này làm anchor"** again.

Until re-anchored, all check-in attempts return `503 Anchor IP mismatch`.

---

## 6. PDPL privacy and data retention

The check-in feature records:

- `check_in_ip` (public IP of the device at check-in time)
- `check_in_user_agent` (browser/OS string from the device)

These are stored in `shift_assignments` and subject to the following:

- **Consent:** employees must be informed (at account setup or via a posted
  notice) that their device IP and browser fingerprint are logged on check-in.
  The consent screen in the **Chấm công** view surfaces this notice before the
  first check-in.
- **Retention:** `shift_assignments` rows are not auto-purged. Define a
  retention policy that aligns with local PDPL / labour-record requirements
  (typically 2–5 years for payroll records). Rows can be archived via the
  backup-restore UI or a scheduled `DELETE` job.
- **Access:** only `owner` and `manager` roles can query `shift_assignments`
  via RLS. `employee_self_service` cannot read other employees' rows.

---

## 7. Accepted risks and known limitations

| Risk | Mitigation | Status |
|---|---|---|
| On-site password sharing (employee A uses employee B's credentials) | Physical supervision; shift anomaly review | Accepted — no biometric |
| CGNAT / shared-IP environment (multiple businesses share one public IP) | Shop must have a dedicated public IP; verify with ISP | Operator responsibility |
| IPv6 /64 prefix (ISP assigns rotating /64 host addresses) | `ipEquals` in `ip-allowlist.ts` supports `ipv6Prefix64` prefix matching; follow-up tracking issue exists | Partial mitigation — review if ISP is IPv6-only |
| Rate-limiter resets on restart | In-process design; acceptable for single-instance deployment | Accepted |
| Mobile-data bypass if Wi-Fi also allows check-in from another IP | Anchor is a single IP; any mismatch blocks. 4G is a different public IP, so it's blocked automatically | Handled by design |

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Check-in returns `503 Check-in not enabled` | `checkin_enabled` is `false` in `app_settings` | Owner enables the gate in Settings → Chấm công |
| Check-in returns `503 Proxy secret missing or invalid` | Reverse proxy is not injecting `x-checkin-proxy-secret`, or value mismatches `.env` | Verify nginx/Caddy config adds the header; check `CHECKIN_PROXY_SECRET` in `.env` |
| Check-in returns `503 Anchor IP stale` | No anchor heartbeat within the freshness window | Re-anchor from shop network; configure POS device to call `/api/checkin/heartbeat` at startup |
| Check-in returns `403 IP not allowed` | Employee is on mobile data or a different network | Employee must connect to shop Wi-Fi; re-anchor if the shop IP changed |
| **Behind Cloudflare:** every employee gets `403 IP not allowed` even on shop Wi-Fi, or the anchor IP keeps changing on its own | App is reading the rotating Cloudflare **edge** IP instead of the real visitor IP | Set `CHECKIN_TRUSTED_IP_HEADER=cf-connecting-ip` in `.env`, redeploy, then **re-anchor** from shop Wi-Fi (the old anchor holds a stale edge IP) |
| Check-in returns `400 Không xác định được IP` after setting `cf-connecting-ip` | Request reached the app without a valid `cf-connecting-ip` (proxy stripped it, or traffic bypassed Cloudflare) | Ensure the proxy forwards `cf-connecting-ip` and all traffic goes through Cloudflare; this is the fail-closed guard working as intended |
| Check-in returns `429 Too many requests` | Rate limit exceeded | Wait for the window to expire (`CHECKIN_RATE_WINDOW_MS`); or restart the container to reset (not recommended under attack) |
| Check-in returns `403 Not employee_self_service` | Employee's account has a different role | Owner must change the role to `employee_self_service` in Settings → Tài khoản |
| Heartbeat call fails with `401` | Heartbeat route requires an active owner/manager session | Ensure the POS device is logged in as owner/manager before calling the heartbeat endpoint |
