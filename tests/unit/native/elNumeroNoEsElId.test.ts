// tests/unit/native/elNumeroNoEsElId.test.ts
//
// EL 307 Y EL 308, QUE NO ENTRARON (20/09).
//
// Tres tablets se bajaron dos paquetes seguidos y no aplicaron ninguno, sin un
// solo error en pantalla. La causa: `sigueEstandoPublicado` recibía el
// identificador LOCAL de Capgo --una cadena opaca-- y lo comparaba contra el
// NÚMERO del manifiesto. Nunca podían coincidir, así que siempre contestaba
// «ya no está publicado» y la tablet tiraba lo que acababa de bajarse.
//
// Estas pruebas fijan las tres respuestas que tiene que dar, y sobre todo la
// primera: con el manifiesto diciendo el MISMO número, se aplica.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}))
const download = vi.fn()
vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: {
    download: (...a: unknown[]) => download(...a),
    current: vi.fn(), set: vi.fn(),
  },
}))
vi.mock('@/lib/supabase', () => ({ supabase: null }))
vi.mock('@/native/print/EscposPrinter', () => ({ EscposPrinter: {} }))
vi.mock('@/native/print/printWorker', () => ({ getDeviceToken: () => null }))

const { sigueEstandoPublicado, prefetchOtaBundle } = await import('@/native/appUpdate')

/** El manifiesto tal y como lo emite CI. */
const manifiesto = (bundleId: number) => ({
  bundleId,
  versionName: `bundle-${bundleId}`,
  url: `https://x/storage/v1/object/public/apps/bundle-${bundleId}.zip`,
  sha256: 'a'.repeat(64),
  mandatory: false,
})

function contesta(cuerpo: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => cuerpo })))
}

beforeEach(() => { download.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

describe('sigueEstandoPublicado compara NÚMEROS, no identificadores', () => {
  it('el manifiesto dice el mismo número → se aplica', async () => {
    contesta(manifiesto(308))
    expect(await sigueEstandoPublicado(308)).toBe(true)
  })

  it('el manifiesto dice OTRO número → no se aplica (lo han sustituido)', async () => {
    contesta(manifiesto(309))
    expect(await sigueEstandoPublicado(308)).toBe(false)
  })

  it('el manifiesto ya no está (404) → se aplica igual, la lección del 13/09', async () => {
    contesta(null, false)
    expect(await sigueEstandoPublicado(308)).toBe(true)
  })

  it('el manifiesto no contesta (red caída) → se aplica igual', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await sigueEstandoPublicado(308)).toBe(true)
  })

  it('el manifiesto contesta basura → se aplica igual, no se sabe nada', async () => {
    contesta({ bundleId: 'trescientos ocho' })
    expect(await sigueEstandoPublicado(308)).toBe(true)
  })
})

describe('prefetchOtaBundle devuelve los DOS, y son distintos', () => {
  // La forma REAL de lo que devuelve Capgo al descargar: un id local opaco,
  // que NO es el número, y el `version` que le pasamos nosotros.
  const loQueDevuelveCapgo = {
    id: '9f3c1a2b-77d4-4e10-9a5e-2b8c1d0f3a61',
    version: '308',
    downloaded: '2026-09-20T11:45:53.000Z',
    checksum: 'a'.repeat(64),
    status: 'pending',
  }

  it('el id es el de Capgo y el numero es el publicado', async () => {
    download.mockResolvedValue(loQueDevuelveCapgo)
    const p = await prefetchOtaBundle(manifiesto(308))
    expect(p).toEqual({ id: '9f3c1a2b-77d4-4e10-9a5e-2b8c1d0f3a61', numero: 308 })
  })

  it('🔴 EL FALLO DEL 307: pasar el id donde va el numero da SIEMPRE que no', async () => {
    download.mockResolvedValue(loQueDevuelveCapgo)
    const p = await prefetchOtaBundle(manifiesto(308))
    contesta(manifiesto(308))               // el manifiesto está INTACTO
    // Lo que hacía el código de ab7026e: comparar el id local contra el número.
    expect(String(manifiesto(308).bundleId) === String(p!.id)).toBe(false)
    // Lo que hace ahora, con el mismo manifiesto intacto:
    expect(await sigueEstandoPublicado(p!.numero)).toBe(true)
  })

  it('si Capgo no devuelve id, no hay paquete descargado', async () => {
    download.mockResolvedValue(undefined)
    expect(await prefetchOtaBundle(manifiesto(308))).toBeNull()
  })

  it('si la descarga rechaza (checksum malo), no hay paquete descargado', async () => {
    download.mockRejectedValue(new Error('checksum mismatch'))
    expect(await prefetchOtaBundle(manifiesto(308))).toBeNull()
  })
})
