"use client";

import { useAnchorHeartbeat } from "@/hooks/use-anchor-heartbeat";

/**
 * Headless mount-point for the anchor heartbeat (Task 9).
 *
 * Render this ONCE inside the authed shell. On devices that hold an anchor
 * token in localStorage it keeps the shop's public IP fresh (token-only — no
 * owner session needed); on every other device it is a no-op. Renders nothing.
 */
export function AnchorHeartbeat(): null {
  useAnchorHeartbeat();
  return null;
}
