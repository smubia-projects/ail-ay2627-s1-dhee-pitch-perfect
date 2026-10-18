"use client";

/**
 * Floating bottom navigation — a sharp cream dock with Home, Interview,
 * Analytics, and the Practice action in the middle. The Practice button sits
 * INSIDE the bar at the same height as the other items (no raised circle),
 * with consistent spacing on mobile and desktop. Active links tint pastel
 * with brown ink.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, House, Play, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Home", icon: House },
  { href: "/interview", label: "Interview", icon: UserRound },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;

function DockLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-16 flex-col items-center gap-0.5 rounded-none px-3 py-2 text-[11px] font-semibold transition-colors",
        active
          ? "bg-iris-100 text-iris-700"
          : "text-ink-500 hover:text-iris-700",
      )}
    >
      <Icon className="size-5" />
      {label}
    </Link>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const practiceActive = pathname.startsWith("/presentation");

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2"
    >
      <div className="flex items-center gap-1 rounded-none border border-iris-700/25 bg-card/95 px-2 py-1.5 shadow-[0_10px_30px_rgba(139,90,60,0.2)] backdrop-blur-xl">
        <DockLink
          href={ITEMS[0].href}
          label={ITEMS[0].label}
          icon={ITEMS[0].icon}
          active={pathname === "/"}
        />

        {/* Inline Practice action: same height & spacing as the other items */}
        <Link
          href="/presentation"
          aria-label="Start practicing"
          aria-current={practiceActive ? "page" : undefined}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-none text-primary-foreground shadow-sm transition-transform hover:scale-105 active:scale-95",
            practiceActive
              ? "bg-iris-700 ring-2 ring-iris-200"
              : "bg-iris-700",
          )}
        >
          <Play className="size-4 fill-current" />
        </Link>

        <DockLink
          href={ITEMS[1].href}
          label={ITEMS[1].label}
          icon={ITEMS[1].icon}
          active={pathname.startsWith("/interview")}
        />
        <DockLink
          href={ITEMS[2].href}
          label={ITEMS[2].label}
          icon={ITEMS[2].icon}
          active={pathname.startsWith("/analytics")}
        />
      </div>
    </nav>
  );
}