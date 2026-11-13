'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createManagerDailyClient, managerControlState } from '@/lib/manager-daily-client.mjs';
import { portalReads } from '@/lib/portal-read-policy.mjs';

export function useManagerDailyAttendance(enabled, months, refreshToken) {
  const [client] = useState(() => createManagerDailyClient({ blocked: portalReads.isBlocked }));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  const previousRefresh = useRef(refreshToken);
  const monthKey = [...new Set(months)].sort().join(',');
  useEffect(() => {
    if (enabled) void client.connect(); else client.clear();
  }, [enabled, client]);
  useEffect(() => {
    if (!enabled || previousRefresh.current === refreshToken) return;
    previousRefresh.current = refreshToken;
    void client.recover();
  }, [enabled, refreshToken, client]);
  useEffect(() => {
    if (!enabled || !state.ready) return;
    for (const month of monthKey.split(',')) void client.loadMonth(month);
  }, [enabled, state.ready, state.snapshot?.version, monthKey, refreshToken, client]);
  return { ...state, ...managerControlState(state), perform: client.perform, retry: client.retry };
}
