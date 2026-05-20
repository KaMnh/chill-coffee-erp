"use client";

import {
  ArrowRight, ArrowUpRight, Bell, Check, ChevronDown, ChevronLeft,
  ChevronRight, Filter, Info, Loader2, Search, X, Plus, Minus,
  AlertTriangle, AlertCircle, CheckCircle2, Sparkles,
  // Phase 3A — nav icons
  LayoutDashboard, Wallet, Users, Banknote, PiggyBank, FileText,
  BarChart3, Settings,
  // Phase 3A — action icons
  LogOut, Menu, RefreshCw, Download, Clock, Lock, Printer,
  // Phase 3B.1 — action icons
  Trash2, Save,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import { forwardRef } from "react";

export const Icons = {
  arrowRight: ArrowRight,
  arrowUpRight: ArrowUpRight,
  bell: Bell,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  filter: Filter,
  info: Info,
  loader: Loader2,
  search: Search,
  x: X,
  plus: Plus,
  minus: Minus,
  alertTriangle: AlertTriangle,
  alertCircle: AlertCircle,
  checkCircle: CheckCircle2,
  sparkles: Sparkles,
  // Phase 3A nav
  layoutDashboard: LayoutDashboard,
  wallet: Wallet,
  users: Users,
  banknote: Banknote,
  piggyBank: PiggyBank,
  fileText: FileText,
  barChart3: BarChart3,
  settings: Settings,
  // Phase 3A actions
  logOut: LogOut,
  menu: Menu,
  refreshCw: RefreshCw,
  download: Download,
  clock: Clock,
  lock: Lock,
  printer: Printer,
  // Phase 3B.1 actions
  trash: Trash2,
  save: Save,
} as const;

export type IconName = keyof typeof Icons;
type IconSize = 16 | 20 | 24;

export interface IconProps extends Omit<LucideProps, "size" | "strokeWidth"> {
  name: IconName;
  size?: IconSize;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = 20, ...rest },
  ref
) {
  const Component: LucideIcon = Icons[name];
  return <Component ref={ref} size={size} strokeWidth={2} {...rest} />;
});
