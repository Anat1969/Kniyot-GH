// No login, ever: a long private key lives on the device (and in the "open on another device" link).
// The database stores only its sha256, and all access goes through two checked functions.
import type { Saved } from './state';

export const SUPA_URL = 'https://ktqmwpbzcnzkhjskqisy.supabase.co';
export const SUPA_KEY = (import.meta as any).env?.VITE_SUPA_KEY || 'sb_publishable_IkreG7naPa1h-d4kGp1gpA_sLU4tg5q';
const KEY_NAME = 'kniyot.key.v1';

export function deviceKey(): string {
  const fromLink = new URLSearchParams(location.hash.split('?')[1] || '').get('k');
  if (fromLink && /^[a-f0-9]{48}$/.test(fromLink)) {
    try { localStorage.setItem(KEY_NAME, fromLink); } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname + location.hash.split('?')[0]);
    return fromLink;
  }
  let k = '';
  try { k = localStorage.getItem(KEY_NAME) || ''; } catch { /* ignore */ }
  if (!/^[a-f0-9]{48}$/.test(k)) {
    k = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(KEY_NAME, k); } catch { /* ignore */ }
  }
  return k;
}

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(fn + ' ' + r.status);
  return r.json();
}

export async function cloudLoad(): Promise<Saved | null> {
  try { return (await rpc('kny_get', { p_key: deviceKey() })) as Saved | null; } catch { return null; }
}
export async function cloudSave(s: Saved): Promise<boolean> {
  try { await rpc('kny_save', { p_key: deviceKey(), p_data: s }); return true; } catch { return false; }
}

export interface ReceiptLine { name: string; qty: number; unit_price: number; total: number; barcode?: string }
export interface Receipt { store: string; total: number | null; lines: ReceiptLine[] }
export async function readReceipt(imageBase64: string, mime: string): Promise<Receipt> {
  const r = await fetch(`${SUPA_URL}/functions/v1/kniyot-receipt`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64, mime }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !Array.isArray(j.lines)) throw new Error((j && j.error) || 'קריאת הקבלה נכשלה');
  return j as Receipt;
}
