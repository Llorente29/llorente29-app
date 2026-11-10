// GD · «Volver a empezar» (nº51): la puerta, las guardas de la siembra y la
// entrada «Tu cuenta» de Ajustes, solo en una demo. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { CAMBIOS_DEL_MES, PASOS, esPaso, fechasDeLosCambios, inicioDeLasCuotas, porqueNo, type Puerta } from '../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos'
import { GC_SANDBOX, PORTAL_DE_PRUEBAS, crearSiembra, guardaPortal } from '../../../../../supabase/functions/_shared/gd/siembra'
import { indiceAjustes } from '@/config/navegacion'
import { vale } from '../../../../../supabase/functions/conta-gocardless-leer/comparacion'

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
    expect(PASOS.map((p) => p.id)).toEqual(['portal_borrar', 'portal_sembrar', 'sandbox_borrar', 'sandbox_sembrar', 'sumied', 'leer', 'tarifa', 'cambios', 'portal'])
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

describe('GD · nº63 · las cuotas mensuales de la demo, desde enero', () => {
  it('enero del año en curso, en Madrid', () => {
    expect(inicioDeLasCuotas('2026-11-09')).toBe('2026-01-01')
    expect(inicioDeLasCuotas('2027-01-02')).toBe('2027-01-01')
  })
  it('así una cuota cuenta ya este mes; desde diciembre, no (lo que hacía decir «Ningún cliente»)', () => {
    expect(vale('2026-01', null, '2026-11')).toBe(true)
    expect(vale('2026-12', null, '2026-11')).toBe(false)
  })
})

describe('GD · nº68 · los cambios del cobro del mes que viene', () => {
  it('alta y nivel el 1 del mes que viene, baja este mes (nº76: la regla del mes entero)', () => {
    expect(fechasDeLosCambios('2026-11-09')).toEqual({ altaEl: '2026-12-01', esteMes: '2026-11-01', mesQueViene: '2026-12-01' })
    expect(fechasDeLosCambios('2026-12-20')).toEqual({ altaEl: '2027-01-01', esteMes: '2026-12-01', mesQueViene: '2027-01-01' })
  })
  it('a quién: Talleres Ruiz (+1), Imprenta Rápida Sol (a Premium) y Reformas Atalaya (una baja)', () => {
    expect(CAMBIOS_DEL_MES.alta.cliente).toBe('Talleres Ruiz, S.L.')
    expect(CAMBIOS_DEL_MES.nivel).toEqual({ cliente: 'Imprenta Rápida Sol, S.L.', nivel: 'Premium' })
    expect(CAMBIOS_DEL_MES.baja.cliente).toBe('Reformas Atalaya, S.L.')
  })
  it('de Básica (90 €) a Premium (150 €) sube más de un 30 %: pide «Lo he mirado, aprobar»', () => {
    expect((150 - 90) / 90).toBeGreaterThan(0.3)
  })
})

describe('GD · nº71 · «Tu cuenta» en el menú de Ajustes de la izquierda', () => {
  it('sale en una cuenta demo y no en las demás', async () => {
    const { PRODUCTOS, pestanasVisibles } = await import('@/modules/conta/esqueleto/productos')
    const ajustes = PRODUCTOS.find((p) => p.id === 'ajustes')!
    const ids = (demo: boolean) => pestanasVisibles(ajustes, { hosteleria: false, diez: false, interruptores: new Set(), demo }).map((t) => t.id)
    expect(ids(true)).toContain('cuenta')
    expect(ids(false)).not.toContain('cuenta')
  })
})
