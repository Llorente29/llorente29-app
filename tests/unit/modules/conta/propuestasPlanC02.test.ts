// tests/unit/modules/conta/propuestasPlanC02.test.ts
//
// C02, tarea 5 · Las propuestas de la IA sobre el plan (src/modules/conta/lib/propuestasPlan.ts).
// Población REAL (regla 31): el plan sale de activar() sobre la serie del BOE
// y las tablas de serie del C00; los nombres de los tipos de gasto sin pista
// son de los que dan de alta los restaurantes. Las expectativas del parecido
// se miraron primero contra la serie (05/10) y una se corrigió por eso: el
// porqué decía «en el título» cuando coincidía en «qué se apunta aquí».

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import serie from '../../../../supabase/conta/pgc/serie.json'
import ref from '../../../../docs/conta/referencia/serie.json'
import { activar } from '@/modules/conta/lib/planEmpresa'
import type { CuentaPlan, CuentaSeriePlan, EnlacePlan } from '@/modules/conta/lib/planVista'
import { CITAS_IVA, propuestasDelPlan, repartirPropuestas, type EntradaPropuestas, type ProveedorPropuesta } from '@/modules/conta/lib/propuestasPlan'

type Fila = Record<string, unknown>
const filas = (t: string) => (ref.tablas as Record<string, { filas: unknown }>)[t].filas as Fila[]
const SERIE: CuentaSeriePlan[] = serie.cuentas.filter((c) => c.plan === 'pymes')
  .map((c) => ({ code: c.code, name: c.name, plainName: c.plain_name, groupCode: c.group_code, parentCode: c.parent_code, isLeaf: c.is_leaf }))
const IVAS = filas('tax_rate').filter((t) => t.tax_system === 'iva' && t.treatment === 'taxed' && t.valid_to === null && t.territory === 'peninsula_baleares')
const GASTOS = filas('expense_category').map((g) => ({ id: String(g.code), name: String(g.name), pgcHint: String(g.pgc) }))
const P = (id: string, name: string, gastoPista: string | null, o: Partial<ProveedorPropuesta> = {}): ProveedorPropuesta =>
  ({ id, name, gastoPista, marca: null, vatRegime: 'general', countryCode: 'ES', ...o })
const PROVS = [P('p1', 'Hermanos Ruiz', '600'), P('p2', 'Locales del Norte', '621')]
const r = activar({
  hojas: SERIE.filter((s) => s.isLeaf).map((s) => ({ code: s.code, name: s.name, plainName: s.plainName })), digitos: 8,
  ivas: IVAS.map((t) => ({ id: String(t.code), rate: Number(t.rate) })), retenciones: [],
  gastos: GASTOS.map((g) => ({ id: g.id, pgcHint: g.pgcHint })), bancos: [{ id: 'b1', name: 'Banco Prueba' }],
  proveedores: PROVS, cuentaComun: { proveedores: false },
})
const CUENTAS: CuentaPlan[] = r.cuentas.map((c) => ({
  id: c.code, code: c.code, templateCode: c.templateCode, name: c.name, plainName: null, keywords: [], kind: c.kind, status: c.status, isCommon: !!c.isCommon, source: 'serie',
}))
const ENLACES: EnlacePlan[] = r.enlaces.map((l) => ({ companyAccountId: l.code, entity: l.entity, entityId: l.entityId, role: l.role }))
const base = (o: Partial<EntradaPropuestas> = {}): EntradaPropuestas => ({
  digitos: 8, serie: SERIE, cuentas: CUENTAS, enlaces: ENLACES, proveedores: PROVS, bancos: [{ id: 'b1', name: 'Banco Prueba' }],
  gastos: GASTOS, tiposIva: IVAS.map((t) => ({ id: String(t.code), name: String(t.name), rate: Number(t.rate) })),
  ultimoApunte: new Map(), hoy: '2026-10-05', contestadas: new Set(), ...o,
})

describe('un plan recién activado no tiene nada que proponer', () => {
  it('cero propuestas: todo tiene su cuenta', () => {
    expect(propuestasDelPlan(base())).toEqual([])
  })
})

describe('terceros sin subcuenta (alta)', () => {
  it('dos proveedores nuevos de mercancía: las siguientes libres del 400, o la común', () => {
    const [p] = propuestasDelPlan(base({ proveedores: [...PROVS, P('p3', 'Mercados del Norte', '600'), P('p4', 'Lácteos Vega', '600')] }))
    expect(p).toMatchObject({
      tipo: 'proveedores', confianza: 'alta', si: 'Sí, créalas', no: 'Ahora no',
      titulo: 'Tienes 2 proveedores nuevos que no tienen subcuenta. ¿Les creo la suya en el 400?',
      porque: 'Lácteos Vega → 40000002 y Mercados del Norte → 40000003. Así cada uno tiene su extracto. Van al 400 porque te venden mercancía, por su tipo de gasto.',
    })
    expect(p.ops).toEqual([
      { op: 'crear', hoja: '4000', nombre: 'Proveedores · Lácteos Vega', entity: 'supplier', entity_id: 'p4' },
      { op: 'crear', hoja: '4000', nombre: 'Proveedores · Mercados del Norte', entity: 'supplier', entity_id: 'p3' },
    ])
    expect(p.alternativa).toEqual({ texto: 'Prefiero una cuenta común', ops: [
      { op: 'enlazar', entity: 'supplier', entity_id: 'p4', role: 'principal', code: '40000000' },
      { op: 'enlazar', entity: 'supplier', entity_id: 'p3', role: 'principal', code: '40000000' },
    ] })
  })
  it('uno de servicios va al 410, y un banco nuevo al 572', () => {
    const ps = propuestasDelPlan(base({ proveedores: [...PROVS, P('p5', 'Gestoría Prueba', '623')], bancos: [{ id: 'b1', name: 'Banco Prueba' }, { id: 'b2', name: 'Caja Dos' }] }))
    expect(ps.map((p) => p.titulo)).toEqual([
      'Tienes 1 proveedor nuevo que no tiene subcuenta. ¿Le creo la suya en el 410?',
      'Tienes un banco sin subcuenta. ¿Le creo la suya en el 572?',
    ])
    expect(ps[0].porque).toBe('Gestoría Prueba → 41000002. Así cada uno tiene su extracto. Van al 410 porque te prestan servicios, por su tipo de gasto.')
    expect(ps[1].porque).toBe('Caja Dos → 57200002. Así cada banco tiene su extracto y se puede conciliar.')
  })
})

describe('tipos de gasto sin cuenta: pista (alta), título (media), parecido (baja → bandeja)', () => {
  const sinEnlace = (id: string) => ENLACES.filter((l) => !(l.entity === 'expense_category' && l.entityId === id))
  it('con pista, la de su tabla', () => {
    const [p] = propuestasDelPlan(base({ enlaces: sinEnlace('food_beverage') }))
    expect(p).toMatchObject({ tipo: 'gasto', confianza: 'alta', titulo: '«Compras de mercaderías» no tiene cuenta. ¿La apunto en la 60000000?',
      porque: 'Su tabla dice que va a la 600 (Compras de mercaderías).' })
  })
  it('sin pista, por el título o por lo que se apunta aquí, y dice dónde coincidió', () => {
    const gastos = ['Seguros', 'Material de oficina', 'Comisiones de plataformas de reparto', 'Gestoría'].map((n, i) => ({ id: `g${i}`, name: n, pgcHint: null }))
    const ps = propuestasDelPlan(base({ gastos }))
    expect(ps.map((p) => [p.confianza, p.titulo])).toEqual([
      ['media', '«Seguros» no tiene cuenta. ¿La apunto en la 62500000?'],
      ['media', '«Material de oficina» no tiene cuenta. ¿La apunto en la 62900000?'],
      ['baja', '«Comisiones de plataformas de reparto» no tiene cuenta. ¿La apunto en la 62600000?'],
    ])
    expect(ps[0].porque).toBe('Por el nombre: «Seguros» está entero en el título de la 625 (Primas de seguros).')
    expect(ps[1].porque).toMatch(/^Por el nombre: «Material de oficina» está entero en lo que se apunta en la 629 \(Otros servicios: «.+»\)\.$/)
    // La baja no sale como tarjeta: se queda en la bandeja de revisión.
    const { tarjetas, revisar } = repartirPropuestas(ps)
    expect(tarjetas.map((p) => p.confianza)).toEqual(['media', 'media'])
    expect(revisar.map((p) => p.titulo)).toEqual(['«Comisiones de plataformas de reparto» no tiene cuenta. ¿La apunto en la 62600000?'])
  })
})

describe('IVA, sin uso, 400/410, UE e ISP', () => {
  it('un tipo nuevo (7,5 %) lleva su 47200075 y su 47700075, con el tipo en el nombre (no «75 %»)', () => {
    const [p] = propuestasDelPlan(base({ tiposIva: [...base().tiposIva, { id: 'nuevo', name: 'IVA reducido nuevo', rate: 7.5 }] }))
    expect(p).toMatchObject({ tipo: 'iva', confianza: 'alta', titulo: 'El IVA reducido nuevo (7,5 %) no tiene sus cuentas. ¿Las creo?' })
    expect(p.ops).toEqual([
      { op: 'crear', hoja: '472', code: '47200075', nombre: 'IVA soportado 7,5 %' },
      { op: 'enlazar', entity: 'tax_rate', entity_id: 'nuevo', role: 'soportado', code: '47200075' },
      { op: 'crear', hoja: '477', code: '47700075', nombre: 'IVA repercutido 7,5 %' },
      { op: 'enlazar', entity: 'tax_rate', entity_id: 'nuevo', role: 'repercutido', code: '47700075' },
    ])
  })
  it('sin uso: solo con apuntes, más de 12 meses y sin nada enlazado', () => {
    const suelta: CuentaPlan = { ...CUENTAS.find((c) => c.code === '62900000')!, id: 'x1', code: '62900001', kind: 'own', name: 'Otros servicios · Antigua' }
    const conSuelta = [...CUENTAS, suelta]
    expect(propuestasDelPlan(base({ cuentas: conSuelta }))).toEqual([]) // sin apuntes no es «sin uso»
    expect(propuestasDelPlan(base({ cuentas: conSuelta, ultimoApunte: new Map([['x1', '2025-11-01']]) }))).toEqual([])
    const [p] = propuestasDelPlan(base({ cuentas: conSuelta, ultimoApunte: new Map([['x1', '2025-09-30'], ['40000001', '2020-01-01']]) }))
    expect(p).toMatchObject({ tipo: 'sin_uso', titulo: 'La 62900001 · Otros servicios · Antigua no se usa desde el 30/09/2025. ¿La oculto?', ops: [{ op: 'ocultar', code: '62900001' }] })
  })
  it('un proveedor de mercancía que pasa a servicios se mueve al 410 y su 400 se oculta', () => {
    const [p] = propuestasDelPlan(base({ proveedores: [P('p1', 'Hermanos Ruiz', '621'), PROVS[1]] }))
    expect(p).toMatchObject({ tipo: 'hoja_proveedor', titulo: 'Hermanos Ruiz está en la 40000001 y le toca la 410. ¿Lo cambio a la 41000002?' })
    expect(p.ops).toEqual([{ op: 'crear', hoja: '4100', nombre: 'Acreedores · Hermanos Ruiz', entity: 'supplier', entity_id: 'p1' }, { op: 'ocultar', code: '40000001' }])
  })
  it('compra en la UE e ISP: sus 472/477 propias, con la ley citada; una vez contestada no vuelve', () => {
    const provs = [...PROVS.map((p) => (p.id === 'p1' ? { ...p, countryCode: 'PT', vatRegime: null } : p)), P('p6', 'Obras Prueba', '622', { vatRegime: 'inversion_sujeto_pasivo' })]
    const enlaces = [...ENLACES, { companyAccountId: '41000001', entity: 'supplier' as const, entityId: 'p6', role: 'principal' as const }]
    const ps = propuestasDelPlan(base({ proveedores: provs, enlaces })).filter((p) => p.tipo.startsWith('iva_'))
    expect(ps.map((p) => [p.tipo, p.confianza, p.ops.map((o) => ('code' in o ? o.code : ''))])).toEqual([
      ['iva_ue', 'media', ['47200101', '47700101']],
      ['iva_isp', 'media', ['47200102', '47700102']],
    ])
    expect(ps[0].porque).toContain('(Ley 37/1992, art. 85)')
    expect(propuestasDelPlan(base({ proveedores: provs, enlaces, contestadas: new Set(['iva_ue']) })).map((p) => p.tipo)).not.toContain('iva_ue')
  })
  it('las citas del IVA de la UE y del ISP están, literales, en la Ley 37/1992 descargada', () => {
    for (const c of Object.values(CITAS_IVA)) {
      expect(readFileSync(`docs/conta/fuentes/textos/${c.fuente}.txt`, 'utf8').includes(c.literal), c.norma).toBe(true)
    }
  })
})
