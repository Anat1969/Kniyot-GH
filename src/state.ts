import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { History, Item, Meta, Row, Settings } from './logic';
import { cloudLoad, cloudSave } from './cloud';

const KEY = 'kniyot.state.v1';
const FRESH = 'https://raw.githubusercontent.com/Anat1969/Kniyot-GH/data/';
const LOCAL = '/data/';

export interface Data { meta: Meta; rows: Row[]; byCode: Map<string, Row>; history: History; fresh: boolean }

async function getJson(base: string, name: string) {
  const r = await fetch(base + name, { cache: 'no-cache' });
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return r.json();
}

export interface RegionInfo { id: string; name: string; center: [number, number]; radiusKm: number; date: string; stores: number }

export async function loadRegions(): Promise<RegionInfo[]> {
  try { const r: RegionInfo[] = await getJson(FRESH, 'regions.json'); if (Array.isArray(r) && r.length) return r; } catch { /* snapshot */ }
  return getJson(LOCAL, 'regions.json');
}

export async function loadData(regionId: string): Promise<Data> {
  // the daily job publishes to the "data" branch; the bundled snapshot is the fallback
  const dir = regionId + '/';
  let base = LOCAL + dir, fresh = false, meta: Meta;
  const local: Meta = await getJson(base, 'meta.json');
  meta = local;
  try {
    const remote: Meta = await getJson(FRESH + dir, 'meta.json');
    if (remote.date > local.date && remote.stores.length >= 3) { meta = remote; base = FRESH + dir; fresh = true; }
  } catch { /* snapshot stays */ }
  let rows: Row[], history: History;
  try {
    [rows, history] = await Promise.all([getJson(base, 'catalog.json'), getJson(base, 'history.json')]);
  } catch {
    meta = local; fresh = false;
    [rows, history] = await Promise.all([getJson(LOCAL + dir, 'catalog.json'), getJson(LOCAL + dir, 'history.json')]);
  }
  return { meta, rows, byCode: new Map(rows.map((r) => [r[0], r])), history, fresh };
}

export function localSaved(): Saved | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.settings ? s : null; } catch { return null; }
}

export interface Saved { basket: Item[]; settings: Settings; touched: boolean; at: number; ownBasket?: boolean }

export function useSaved(data: Data | null) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');
  const timer = useRef<number>();

  const defaults = useMemo<Saved | null>(() => data && ({
    basket: data.meta.sample.map((c) => ({ c, q: 1 })),
    settings: { home: { lat: data.meta.region.center[0], lon: data.meta.region.center[1], label: `מרכז ${data.meta.region.name}` }, radius: 0, ref: null, kmCost: 1.4, promos: true, region: data.meta.region.id, homeSet: false },
    touched: false, at: 0,
  }), [data]);

  useEffect(() => {
    if (!defaults) return;
    let local: Saved | null = null;
    try { local = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
    setSaved(local && local.settings ? local : defaults);
    cloudLoad().then((remote) => {
      if (remote && remote.settings && (!local || remote.at > local.at)) {
        setSaved(remote);
        try { localStorage.setItem(KEY, JSON.stringify(remote)); } catch { /* ignore */ }
      } else if (local && local.touched && (!remote || local.at > remote.at)) {
        cloudSave(local).then((ok) => setStatus(ok ? 'saved' : 'offline'));
      }
    });
  }, [defaults]);

  const update = useCallback((fn: (s: Saved) => Saved) => {
    setSaved((prev) => {
      if (!prev) return prev;
      const next = { ...fn(prev), touched: true, at: Date.now() };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
      setStatus('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => cloudSave(next).then((ok) => setStatus(ok ? 'saved' : 'offline')), 700);
      return next;
    });
  }, []);

  return { saved, update, status, defaults };
}
