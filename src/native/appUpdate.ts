// src/native/appUpdate.ts
//
// Auto-actualización de la app nativa (sideload). Al arrancar, la app pide
// `.../apps/version.json` (subido por el pipeline build-apk.yml en cada push a
// main) y compara su versionCode con el instalado. Si hay una versión mayor,
// UpdateGate decide CUÁNDO ofrecerla (ver ventana segura, abajo) → "Actualizar"
// lanza el instalador de Android con el APK ya descargado.
//
// Sólo nativo: en web no hay APK ni plugin → checkForUpdate() devuelve null.
// Futuro (Parte C): en Play Store, sustituir por In-App Updates API (immediate),
// que instala 100% automático sin el toque de "app desconocida".
//
// ── VENTANA DE ACTUALIZACIÓN SEGURA (26/07) ─────────────────────────────────
// Una estación de cocina no puede pararse a instalar en mitad del pase. Por eso:
//   1. La DESCARGA va siempre por detrás, en silencio (prefetchUpdate), en
//      cuanto se detecta versión nueva. Descargar no interrumpe a nadie.
//   2. La INSTALACIÓN sólo se ofrece cuando la cocina está en calma. Las señales
//      de BBDD (trabajos de impresión vivos, pedidos en curso, minutos desde la
//      última venta) las da la RPC station_update_window; la inactividad táctil
//      la mide el propio UpdateGate en el dispositivo.
// Con esto, la release forzada del código de pase (26/07) debería ser la última
// que haya que aplicar con la cocina cerrada.

import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { supabase } from '@/lib/supabase'
import { EscposPrinter } from './print/EscposPrinter'
import { getDeviceToken } from './print/printWorker'

export interface RemoteVersion {
  versionCode: number
  versionName: string
  apkUrl: string
  mandatory: boolean
}

/** Señales de BBDD sobre si esta estación puede actualizarse ahora. */
export interface UpdateWindow {
  ok: boolean
  safe: boolean
  reasons: string[]
  pendingJobs: number
  activeOrders: number
  minutesSinceSale: number | null
  /** true = la RPC no existe en este proyecto (migración sin aplicar). Ver abajo. */
  unsupported?: boolean
}

/** Forma cruda de lo que devuelve station_update_window (jsonb). */
interface WindowRow {
  ok?: boolean
  safe?: boolean
  reasons?: unknown[]
  pending_jobs?: number
  active_orders?: number
  minutes_since_sale?: number | null
}

/**
 * Llamada a RPC todavía SIN tipos generados (la migración del 26/07 se aplica a
 * mano y database.ts se regenera después). Mismo idiom que ordersFeedService:
 * un cast de la función, no un `any` suelto. Cuando database.ts incluya estas
 * RPC, esto se puede sustituir por supabase.rpc directo.
 */
function rpc(fn: string, args: Record<string, unknown>): Promise<{
  data: unknown
  error: { message?: string; code?: string } | null
}> {
  // ⚠️ El cast va ANTES del .bind (si no, TS2589) y el .bind es OBLIGATORIO:
  // supabase-js pierde el `this` si se extrae `rpc` a una variable suelta y
  // revienta con "Cannot read properties of undefined (reading 'rest')" — la
  // llamada ni siquiera sale a la red. Ya pasó con el banner del KPI de cocina.
  const call = (supabase!.rpc as unknown as (
    f: string, a: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  ).bind(supabase!)
  return call(fn, args)
}

function versionUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '') ?? ''
  return `${base}/storage/v1/object/public/apps/version.json`
}

/** Devuelve la actualización disponible (o null si no hay / no aplica). */
export async function checkForUpdate(): Promise<{ remote: RemoteVersion; current: number } | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    // cache-buster: el bucket es público y podría cachearse.
    const resp = await fetch(`${versionUrl()}?t=${Date.now()}`, { cache: 'no-store' })
    if (!resp.ok) return null
    const remote = (await resp.json()) as RemoteVersion
    if (!remote || typeof remote.versionCode !== 'number') return null
    const { versionCode } = await EscposPrinter.getVersionCode()
    if (remote.versionCode > versionCode) return { remote, current: versionCode }
    return null
  } catch {
    return null
  }
}

/** Descarga el APK en segundo plano, sin UI ni permisos. Devuelve true si queda
 *  listo para instalar al instante. En plugin viejo (APK anterior) el método no
 *  existe → false, y la instalación descargará en su momento, como siempre. */
export async function prefetchUpdate(apkUrl: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const r = await EscposPrinter.downloadApk({ url: apkUrl })
    return r?.ok === true
  } catch {
    return false
  }
}

/** ¿Hay ya un APK descargado esperando? (para saber si instalar será inmediato) */
export async function isUpdateDownloaded(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const r = await EscposPrinter.hasDownloadedApk()
    return r?.ready === true
  } catch {
    return false
  }
}

/** Instala el APK (usa el predescargado si lo hay; si no, descarga de apkUrl). */
export async function installUpdate(apkUrl: string): Promise<void> {
  await EscposPrinter.installApk({ url: apkUrl })
}

/**
 * ¿Es seguro instalar AHORA según la BBDD? Devuelve null cuando no se puede
 * saber (sin token de dispositivo, sin red). El llamador decide: aquí "no sé"
 * NUNCA significa "sí, adelante" en una estación con token, pero tampoco debe
 * bloquear a un dispositivo que no es estación.
 *
 * CASO ESPECIAL — la RPC no existe (migración del 26/07 sin aplicar): eso NO es
 * "espera", es "esta BBDD no sabe de ventanas". Se marca `unsupported` para que
 * el actualizador vuelva al comportamiento anterior (ofrecer y que decida quien
 * esté delante). Si no, una migración olvidada dejaría a la flota sin poder
 * actualizarse jamás, y en silencio — el peor fallo posible en un actualizador.
 */
export async function fetchUpdateWindow(quietMinutes = 20): Promise<UpdateWindow | null> {
  const token = getDeviceToken()
  if (!token || !supabase) return null
  try {
    const { data, error } = await rpc('station_update_window', {
      p_device_token: token,
      p_quiet_minutes: quietMinutes,
    })
    if (error) {
      // PGRST202 / 42883 = función inexistente en el esquema expuesto.
      const code = String(error.code ?? '')
      const msg = String(error.message ?? '')
      const noExiste = code === 'PGRST202' || code === '42883' ||
        /could not find the function|does not exist/i.test(msg)
      if (noExiste) {
        return { ok: false, safe: false, reasons: ['rpc_no_disponible'], pendingJobs: 0, activeOrders: 0, minutesSinceSale: null, unsupported: true }
      }
      return null
    }
    const w = (data ?? null) as WindowRow | null
    if (!w) return null
    return {
      ok: w.ok === true,
      safe: w.safe === true,
      reasons: Array.isArray(w.reasons) ? w.reasons.map(String) : [],
      pendingJobs: Number(w.pending_jobs ?? 0),
      activeOrders: Number(w.active_orders ?? 0),
      minutesSinceSale: w.minutes_since_sale == null ? null : Number(w.minutes_since_sale),
    }
  } catch {
    return null
  }
}

/**
 * Reporta a BBDD qué versión corre este dispositivo (kds_device.app_version).
 * Best-effort absoluto: cualquier fallo se traga: es telemetría, no puede
 * estorbar al arranque de una estación.
 *
 * Incluye el bundleId OTA activo (si hay alguno aplicado) para no perder
 * visibilidad de flota (§7): no se amplía el esquema de kds_device por esto
 * (deuda menor, aceptada) — se aprovecha que app_version ya es texto libre.
 */
export async function reportAppVersion(): Promise<void> {
  const token = getDeviceToken()
  if (!token || !supabase) return
  try {
    let version = 'web'
    if (Capacitor.isNativePlatform()) {
      const v = await EscposPrinter.getVersionCode()
      version = `${v.versionName ?? '?'} (${v.versionCode})`
      try {
        const { bundle } = await CapacitorUpdater.current()
        if (bundle && bundle.id !== 'builtin') version += ` · bundle ${bundle.version}`
      } catch { /* Capgo no disponible en este build viejo: se omite sin más */ }
    }
    await rpc('report_device_app_version', {
      p_device_token: token,
      p_app_version: version,
      p_platform: Capacitor.getPlatform(),
    })
  } catch {
    /* telemetría: nunca molesta */
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// OTA DEL BUNDLE WEB (Capa 2, 31/07) — @capgo/capacitor-updater en MODO MANUAL.
//
// Canal separado de version.json/APK (arriba): bundle.json lo emite CI en CADA
// build (toque o no código nativo) y anuncia el zip de `dist/` de esa build.
// UpdateGate decide CUÁNDO aplicar (misma ventana segura de siempre); aquí solo
// vive el I/O: comprobar, descargar, aplicar. Nunca auto-aplica por su cuenta
// (capacitor.config.ts → CapacitorUpdater.autoUpdate:false).
// ═════════════════════════════════════════════════════════════════════════════

export interface RemoteBundle {
  bundleId: number
  versionName: string
  url: string
  sha256: string
  mandatory: boolean
}

function bundleUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '') ?? ''
  return `${base}/storage/v1/object/public/apps/bundle.json`
}

/** ¿Hay un bundle OTA más nuevo que el que corre ahora? El "builtin" (el que
 *  trae la APK de fábrica, nunca actualizado por OTA) cuenta como bundleId 0 —
 *  siempre inferior a cualquier bundle.json real. */
export async function checkForBundleUpdate(): Promise<{ remote: RemoteBundle } | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const resp = await fetch(`${bundleUrl()}?t=${Date.now()}`, { cache: 'no-store' })
    if (!resp.ok) return null
    const remote = (await resp.json()) as RemoteBundle
    if (!remote || typeof remote.bundleId !== 'number') return null
    const { bundle } = await CapacitorUpdater.current()
    const activeId = bundle && bundle.id !== 'builtin' ? Number(bundle.version) : 0
    const currentId = Number.isFinite(activeId) ? activeId : 0
    if (remote.bundleId > currentId) return { remote }
    return null
  } catch {
    return null
  }
}

/**
 * Descarga el bundle en 2º plano (Capgo lo deja en disco, sin activar). El
 * `version` que se le pasa es el bundleId como texto: es lo que luego lee
 * checkForBundleUpdate() vía CapacitorUpdater.current().bundle.version para
 * comparar. El checksum lo verifica el propio plugin (sha256); si no cuadra,
 * download() rechaza y aquí se traga como "no descargado" — se reintenta en
 * el siguiente ciclo, nunca se aplica un bundle corrupto.
 */
export async function prefetchOtaBundle(remote: RemoteBundle): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const info = await CapacitorUpdater.download({
      url: remote.url,
      version: String(remote.bundleId),
      checksum: remote.sha256,
    })
    return info?.id ?? null
  } catch {
    return null
  }
}

/**
 * Aplica un bundle ya descargado: set() + reload inmediato (destruye el
 * contexto JS actual — por diseño de Capgo esta promesa normalmente no llega
 * a resolver). Si el bundle nuevo no arranca, notifyAppReady() no se llama a
 * tiempo y Capgo hace ROLLBACK solo al bundle bueno anterior en ≤10s — la
 * estación nunca se queda muerta por un OTA malo.
 */
export async function applyOtaBundle(bundleId: string): Promise<void> {
  await CapacitorUpdater.set({ id: bundleId })
}
