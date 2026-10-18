"use client";

/**
 * Main navigation — a frosted-glass navbar with the Manestage wordmark
 * (Plus Jakarta Sans + mini Mane badge), iris active-link indicators, a shimmer
 * CTA, and a shadcn Sheet-based mobile menu.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Briefcase, Home, Menu, Presentation } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { LocalCoachToggle } from "@/components/local-coach-toggle";
import { ManeBadge } from "@/components/mascot/mane";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/presentation", label: "Presentation", icon: Presentation },
  { href: "/interview", label: "Interview", icon: Briefcase },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative rounded-none px-4 py-1.5 font-sans text-sm font-medium transition-colors duration-200",
        active
          ? "text-iris-800"
          : "text-ink-900/60 hover:text-ink-900",
      )}
    >
      {label}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-none bg-gradient-to-r from-transparent via-iris-700 to-transparent"
        />
      )}
    </Link>
  );
}

export function MainNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="glass-fresh sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        {/* Brand */}
        <div className="flex items-center gap-1.5">
          <Link href="/" className="flex items-center gap-2.5">
            <ManeBadge size={28} />
            <span className="font-display text-base font-bold tracking-tight text-ink-900">
              Mane<span className="text-iris-700">stage</span>
            </span>
          </Link>
        </div>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.href}
              href={link.href}
              label={link.label}
              active={isActive(link.href)}
            />
          ))}
        </nav>

        {/* CTA + mobile trigger */}
        <div className="flex items-center gap-2">
          <LocalCoachToggle />
          <ShimmerButton
            className="hidden px-4 py-2 text-sm font-semibold md:flex"
            background="#8b5a3c"
            shimmerColor="#ffd9b8"
            shimmerDuration="3s"
            onClick={() => router.push("/presentation")}
          >
            <span className="flex items-center gap-1.5">
              <Presentation className="size-3.5" />
              Start practicing
            </span>
          </ShimmerButton>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-9 text-ink-800 hover:bg-iris-100 hover:text-ink-900 md:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-64 border-iris-700/20 bg-card/95 text-ink-900 backdrop-blur-xl"
            >
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 font-display text-ink-900">
                  <ManeBadge size={26} />
                  Manestage
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-4 flex flex-col gap-1" aria-label="Mobile">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-none px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive(link.href)
                        ? "bg-iris-100 text-iris-800 ring-1 ring-iris-600/40"
                        : "text-ink-900/70 hover:bg-iris-50 hover:text-ink-900",
                    )}
                  >
                    <link.icon className="size-4" />
                    {link.label}
                  </Link>
                ))}
              </nav>
              <Separator className="bg-iris-700/15" />
              <p className="px-1 text-xs text-ink-500">
                Camera &amp; history stay on this device. AI scoring uses the
                cloud unless Local coach is on.
              </p>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
}