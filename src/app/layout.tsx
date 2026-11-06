import type { Metadata } from "next";
import { ApiNotices } from "@/components/RateLimitCTA";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Manestage: Presentation and Interview Coach",
    template: "%s · Manestage",
  },
  description:
    "Manestage is a friendly practice studio. Rehearse presentations and interviews with Mane, get your scores, and watch yourself improve session after session.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        {/* Rate-limit CTA (429) and demo-paused notice (503) for every API call */}
        <ApiNotices />
      </body>
    </html>
  );
}
