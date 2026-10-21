"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ENDPOINTS, type ApiMode, type DraftStatusView } from "./api";

/*
 * Polls the reading/building status every 1.5 s while anything is in flight (a file being
 * read, the profile being built, or an upload the server hasn't reported yet), and stops by
 * itself when everything is done. `kick()` starts polling again after a new upload.
 */

const INTERVAL_MS = 1500;
/** After a kick, keep polling at least this long even if the server still reports idle. */
const GRACE_MS = 8000;

export function useDraftStatus(mode: ApiMode, locale: string, initial: DraftStatusView | null) {
  const [status, setStatus] = useState<DraftStatusView | null>(initial);
  const [polling, setPolling] = useState<boolean>(Boolean(initial && (initial.phase === "reading" || initial.phase === "building")));
  const graceUntil = useRef(0);
  const failures = useRef(0);

  const fetchOnce = useCallback(async () => {
    try {
      const s = await api<DraftStatusView>(`${ENDPOINTS[mode].status}?locale=${locale}`);
      failures.current = 0;
      setStatus(s);
      const busy = s.phase === "reading" || s.phase === "building";
      if (!busy && Date.now() > graceUntil.current) setPolling(false);
      return s;
    } catch (err) {
      failures.current += 1;
      // A few misses in a row (offline, deploy) pause polling; the next kick resumes it.
      if (failures.current >= 4) setPolling(false);
      console.warn("[status] poll failed", err);
      return null;
    }
  }, [mode, locale]);

  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await fetchOnce();
      if (!stopped) timer = setTimeout(loop, INTERVAL_MS);
    };
    timer = setTimeout(loop, 300);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [polling, fetchOnce]);

  const kick = useCallback(() => {
    graceUntil.current = Date.now() + GRACE_MS;
    failures.current = 0;
    setPolling(true);
  }, []);

  return { status, polling, kick, refresh: fetchOnce, setStatus };
}
