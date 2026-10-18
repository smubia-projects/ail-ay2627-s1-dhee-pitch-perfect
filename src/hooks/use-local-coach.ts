"use client";

/**
 * Reactive Local-coach preference — starts false (SSR-safe), syncs after
 * mount, and stays in sync across components via the prefs event + the
 * browser `storage` event (cross-tab).
 */

import * as React from "react";

import {
  PREFS_CHANGED_EVENT,
  isLocalCoach,
  setLocalCoach,
} from "@/lib/prefs-store";

export function useLocalCoach(): [boolean, (on: boolean) => void] {
  const [on, setOn] = React.useState(false);

  React.useEffect(() => {
    const sync = () => setOn(isLocalCoach());
    sync();
    window.addEventListener(PREFS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PREFS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = React.useCallback((next: boolean) => setLocalCoach(next), []);
  return [on, update];
}
