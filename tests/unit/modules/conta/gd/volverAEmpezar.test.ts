// GD · «Volver a empezar» (nº51): la puerta, las guardas de la siembra y la
// entrada «Tu cuenta» de Ajustes, solo en una demo. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { PASOS, esPaso, porqueNo, type Puerta } from '../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos'
import { GC_SANDBOX, PORTAL_DE_PRUEBAS, crearSiembra, guardaPortal } from '../../../../../supabase/functions/_shared/gd/siembra'
import { indiceAjustes } from '@/config/navegacion'

const BIEN = `https://${PORTAL_DE_PRUEBAS}/rest/1/abc123/`
const puerta = (p: Partial<Puerta> = {}): Puerta => ({ esDemo: true, esAdmin: true, portalCrm: PORTAL_DE_PRUEBAS, entornosGc: ['pruebas'], faltan: [], ...p })

describe('GD · Volver a empezar · la puerta', () => {
  it('demo, administrador, portal de pruebas, GoCardless de pruebas y los dos secretos: se puede', () => {
    expect(porqueNo(puerta(), PORTAL_DE_PRUEBAS)).toBeNull()
    expect(porqueNo(puerta({ portalCrm: null, entornosGc: [] }), PORTAL_DE_PRUEBAS)).toBeNull()
  })
  it('cualquier otra cosa, no, y dice por qué', () => {
    expect(porqueNo(puerta({ esDemo: false }), PORTAL_DE_PRUEBAS)).toMatch(/cuenta de demostración/)
    expect(porqueNo(puerta({ esAdmin: false }), PORTAL_DE_PRUEBAS)).toMatch(/administrador/)
    expect(porqueNo(puerta({ portalCrm: 'qbo.bitrix24.es' }), PORTAL_DE_PRUEBAS)).toMatch(/no el portal de pruebas/)
    expect(porqueNo(puerta({ entornosGc: ['pruebas', 'real'] }), PORTAL_DE_PRUEBAS)).toMatch(/no es el de pruebas/)
    expect(porqueNo(puerta({ faltan: ['GD_B24_ENTRANTE_URL', 'GD_GC_SANDBOX_RW_TOKEN'] }), PORTAL_DE_PRUEBAS)).toBe('Faltan los secretos GD_B24_ENTRANTE_URL y GD_GC_SANDBOX_RW_TOKEN en las funciones: los pega Julio.')
  })
  it('los pasos, en su orden, y nada más', () => {
    expect(PASOS.map((p) => p.id)).toEqual(['portal_borrar', 'portal_sembrar', 'sandbox_borrar', 'sandbox_sembrar', 'sumied', 'leer', 'tarifa'])
    expect(esPaso('comprobar')).toBe(true)
    expect(esPaso('borrar_todo')).toBe(false)
  })
})

describe('GD · Volver a empezar · las guardas de la siembra', () => {
  it('solo el webhook del portal de pruebas', () => {
    expect(guardaPortal(BIEN.slice(0, -1))).toBe(BIEN)
    expect(() => guardaPortal('https://qbo.bitrix24.es/rest/1/abc123/')).toThrow(/no del de pruebas/)
    expect(() => guardaPortal('https://b24-s3mr2y.bitrix24.es/')).toThrow(/webhook entrante/)
  })
  it('GoCardless, siempre el sandbox; y sin token no llama a nadie', async () => {
    const urls: string[] = []
    const f = (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify({ mandates: [], customers: [], meta: { cursors: {} } }), { status: 200 }) }) as unknown as typeof fetch
    await crearSiembra({ b24Url: BIEN, gcToken: 'sandbox_prueba', decir: () => {}, fetch: f }).borrarGoCardless()
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((u) => u.startsWith(`${GC_SANDBOX}/`))).toBe(true)
    urls.length = 0
    await expect(crearSiembra({ b24Url: BIEN, gcToken: '', decir: () => {}, fetch: f }).sembrarGoCardless()).rejects.toThrow(/token/)
    expect(urls).toEqual([])
  })
})

describe('GD · Ajustes › Tu cuenta', () => {
  const ids = (demo: boolean) => indiceAjustes(false, demo).flatMap((g) => g.entradas.map((e) => e.id))
  it('sale solo en una cuenta de demostración', () => {
    expect(ids(true)).toContain('cuenta')
    expect(ids(false)).not.toContain('cuenta')
  })
})
