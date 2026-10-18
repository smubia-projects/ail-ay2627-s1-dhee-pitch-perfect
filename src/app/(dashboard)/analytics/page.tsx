"use client";

/**
 * Analytics dashboard page — dual-tabbed presentation/interview practice
 * history with the timeline visualizer.
 */

import * as React from "react";
import { motion } from "framer-motion";
import { BarChart3, Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";

export default function AnalyticsPage() {
  return (
    <div className="flex flex-1 flex-col gap-8 p-6 md:p-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex flex-col gap-2"
      >
        <Badge className="w-fit border-iris-700/40 bg-iris-200 text-iris-900 backdrop-blur">
          <BarChart3 />
          Master analytics
        </Badge>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">
          How you&apos;re improving
        </h1>
        <p className="max-w-2xl font-medium text-ink-700">
          Flip between Presentation Analytics and Interview Analytics. The
          line graph shows every session. The radar compares your latest run
          with the one before it.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }}
        className="rounded-none border border-iris-700/20 bg-iris-50/70 p-5 shadow-[0_24px_60px_-30px_rgba(74,46,28,0.5)] backdrop-blur"
      >
        <AnalyticsDashboard />
      </motion.div>

      <p className="flex items-center gap-1.5 text-xs text-ink-900/50">
        <Trophy className="size-3.5 text-iris-700/70" />
        Your history lives in this browser only. Nothing leaves this
        device.
      </p>
    </div>
  );
}
