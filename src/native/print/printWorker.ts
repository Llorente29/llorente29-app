// src/native/print/printWorker.ts
// "El agente, dentro de la app". Reclama la cola print_job por token de
// dispositivo, renderiza el ticket con el MISMO motor que el agente Node,
// y lo imprime por el plugin nativo (socket TCP a la impresora de red).
//
// ARRANQUE SIN CONSOLA (F3):
//   - El emparejamiento vive en la app: la Estación (/estacion) llama a
//     pairEstacion(token) al vincular la tablet (pegando el token o escaneando
//     el QR). pairEstacion guarda el token, fija el MODO del dispositivo =
//     'estacion' y arranca el worker. Ya NO hace falta folvyPrint.start por
//     consola (se mantiene como atajo de diagnóstico, no como vía principal).
//   - Al cargar la app nativa, autostart() arranca solo si hay token guardado y
//     el modo NO es 'equipo'/'gestion' (gating por modo; el respaldo autoritativo
//     en BBDD, kds_device.device_mode, llega en F5).
//
// GUARDARRAÍL: el worker SOLO imprime en la app nativa (Capacitor). En el
// navegador web NO reclama la cola, para no interferir con producción.
//
// NOTA: la bolsa sale en TEXTO por ahora (la versión imagen se porta después).

import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { renderForType } from './ticketRenderer';
import { renderDoc } from './escpos';
import { EscposPrinter } from './EscposPrinter';

const TOKEN_KEY = 'folvy_print_device_token';
// Token de la Estación (/estacion). Es el MISMO kds_device.token; lo leemos como
// alternativa para tablets ya vinculadas en la Estación antes de F3.
const ESTACION_TOKEN_KEY = 'kds_device_token';
// Modo del dispositivo (cliente). 'estacion' imprime; 'equipo'/'gestion' no.
// F5 lo respaldará en kds_device.device_mode como fuente autoritativa.
const MODE_KEY = 'folvy_device_mode';

export type DeviceMode = 'estacion' | 'equipo' | 'gestion';

function readStored(key: string): string {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* almacenamiento no disponible */ }
}
function removeStored(key: string): void {
  try { localStorage.removeItem(key); } catch { /* */ }
}

/** Modo del dispositivo guardado (o null si nunca se fijó). */
export function getDeviceMode(): DeviceMode | null {
  const m = readStored(MODE_KEY);
  return m === 'estacion' || m === 'equipo' || m === 'gestion' ? m : null;
}
export function setDeviceMode(mode: DeviceMode): void {
  writeStored(MODE_KEY, mode);
}

/** Token efectivo del dispositivo: el del worker o, si no, el de la Estación. */
function resolveToken(): string {
  return readStored(TOKEN_KEY) || readStored(ESTACION_TOKEN_KEY);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

async function rpc(fn: string, args: any): Promise<any> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let deviceToken = '';

async function tick() {
  if (busy || !deviceToken) return;
  busy = true;
  try {
    const jobs = await rpc('claim_print_jobs', { p_device_token: deviceToken, p_limit: 10 });
    if (!Array.isArray(jobs) || jobs.length === 0) return;

    for (const job of jobs) {
      const { job_id, doc_type, payload, printer } = job;
      const ip = printer?.ip;
      const port = printer?.port || 9100;
      try {
        if (!ip) throw new Error(`impresora ${printer?.name} sin IP`);
        const buffers: Uint8Array[] = [];
        if (payload && payload.mode === 'by_order' && payload.sale_id) {
          const order = await rpc('order_for_print', { p_device_token: deviceToken, p_sale_id: payload.sale_id });
          if (!order) throw new Error(`pedido ${payload.sale_id} no encontrado`);
          let fiscal: any = null;
          if (doc_type === 'bag') {
            try { fiscal = await rpc('fiscal_for_print', { p_device_token: deviceToken, p_sale_id: payload.sale_id }); } catch { /* sin fiscal */ }
          }
          for (const doc of renderForType(order, doc_type, fiscal || undefined)) buffers.push(renderDoc(doc));
        } else {
          const docs = Array.isArray(payload) ? payload : [payload];
          for (const doc of docs) buffers.push(renderDoc(doc));
        }
        for (const buf of buffers) {
          await EscposPrinter.print({ host: ip, port, data: bytesToBase64(buf) });
        }
        await rpc('report_print_job', { p_device_token: deviceToken, p_job_id: job_id, p_ok: true });
        console.log(`[folvy-print] ok ${doc_type} -> ${printer.name} (${ip})`);
      } catch (e: any) {
        try { await rpc('report_print_job', { p_device_token: deviceToken, p_job_id: job_id, p_ok: false, p_error: e?.message || String(e) }); } catch { /* */ }
        console.error(`[folvy-print] error ${doc_type} -> ${printer?.name}: ${e?.message || e}`);
      }
    }
  } catch (e: any) {
    console.error('[folvy-print] claim:', e?.message || e);
  } finally {
    busy = false;
  }
}

export function startPrintWorker(opts: { token: string; pollMs?: number }) {
  if (!Capacitor.isNativePlatform()) {
    console.warn('[folvy-print] el worker solo funciona en la app nativa (no en el navegador web)');
    return;
  }
  deviceToken = opts.token;
  writeStored(TOKEN_KEY, opts.token);
  if (timer) clearInterval(timer);
  const ms = opts.pollMs || 3000;
  timer = setInterval(() => { void tick(); }, ms);
  void tick();
  console.log(`[folvy-print] worker iniciado (sondeo ${ms} ms)`);
}

export function stopPrintWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  console.log('[folvy-print] worker parado');
}

// Borra el token guardado y para el worker (para reconfigurar el dispositivo).
export function clearPrintWorker() {
  stopPrintWorker();
  deviceToken = '';
  removeStored(TOKEN_KEY);
  console.log('[folvy-print] token borrado');
}

// ── Emparejamiento desde la app (F3): vía principal, sin consola ─────────────
//
// La Estación llama a esto al vincular la tablet. Fija el modo = 'estacion'
// (el dispositivo es una estación de impresión), persiste el token y arranca el
// worker si estamos en la app nativa. En el navegador web sólo recuerda el modo
// y el token; el papel sale en la tablet nativa.
export function pairEstacion(token: string, opts?: { pollMs?: number }) {
  const t = token.trim();
  if (!t) return;
  setDeviceMode('estacion');
  // Compartimos el token también con la clave de la Estación, para que ambos
  // (worker y /estacion) lean lo mismo tras un único emparejamiento.
  writeStored(ESTACION_TOKEN_KEY, t);
  // Respaldo AUTORITATIVO en BBDD (F5): marca kds_device.device_mode='estacion'.
  // Best-effort: si falla la red, el worker igual arranca (gate cliente); la
  // próxima vinculación/pulso reintenta. El gate fuerte vive en claim_print_jobs.
  void rpc('set_device_mode_by_token', { p_device_token: t, p_mode: 'estacion' }).catch(() => { /* best-effort */ });
  startPrintWorker({ token: t, pollMs: opts?.pollMs });
}

// Desvincula por completo: para el worker y borra token(s) y modo.
export function unpairDevice() {
  clearPrintWorker();
  removeStored(ESTACION_TOKEN_KEY);
  removeStored(MODE_KEY);
  console.log('[folvy-print] dispositivo desvinculado');
}

// Auto-arranque: solo en la app NATIVA, si hay token guardado de una vez
// anterior Y el modo NO es explícitamente 'equipo'/'gestion' (gating por modo).
// Un móvil de trabajador (modo 'equipo') no arranca el worker.
function autostart() {
  if (!Capacitor.isNativePlatform()) return;
  const saved = resolveToken();
  if (!saved) return;
  const mode = getDeviceMode();
  if (mode === 'equipo' || mode === 'gestion') {
    console.log(`[folvy-print] worker en reposo (modo ${mode})`);
    return;
  }
  startPrintWorker({ token: saved });
}

// Atajo de consola (chrome://inspect) — diagnóstico, ya no es la vía principal:
//   folvyPrint.start({ token: '...' }) / .stop() / .clear() / .pair('...') / .unpair()
if (typeof window !== 'undefined') {
  (window as any).folvyPrint = {
    start: startPrintWorker,
    stop: stopPrintWorker,
    clear: clearPrintWorker,
    pair: pairEstacion,
    unpair: unpairDevice,
  };
}

autostart();
