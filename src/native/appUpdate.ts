// src/native/appUpdate.ts
//
// Auto-actualización de la app nativa (sideload). Al arrancar, la app pide
// `.../apps/version.json` (subido por el pipeline build-apk.yml en cada push a
// main) y compara su versionCode con el instalado. Si hay una versión mayor,
// UpdateGate muestra un modal bloqueante (si mandatory) → "Actualizar" descarga
// el APK y lanza el instalador de Android.
//
// Sólo nativo: en web no hay APK ni plugin → checkForUpdate() devuelve null.
// Futuro (Parte C): en Play Store, sustituir por In-App Updates API (immediate),
// que instala 100% automático sin el toque de "app desconocida".

import { Capacitor } from '@capacitor/core'
import { EscposPrinter } from './print/EscposPrinter'

export interface RemoteVersion {
  versionCode: number
  versionName: string
  apkUrl: string
  mandatory: boolean
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

/** Descarga e instala el APK indicado (lanza el instalador de Android). */
export async function installUpdate(apkUrl: string): Promise<void> {
  await EscposPrinter.installApk({ url: apkUrl })
}
