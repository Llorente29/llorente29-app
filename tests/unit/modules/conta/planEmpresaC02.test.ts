// tests/unit/modules/conta/planEmpresaC02.test.ts
//
// C02, tarea 3 · Núcleo del plan por empresa (src/modules/conta/lib/planEmpresa.ts).
// Población REAL (regla 31): las hojas son las de la serie generada del BOE
// (supabase/conta/pgc/serie.json), los tipos de IVA, retenciones y tipos de
// gasto son los de serie del C00 (docs/conta/referencia/serie.json), y las
// equivalencias del cambio de plan las genera scripts/conta/plan.mjs.

import { describe, expect, it } from 'vitest'
import serie from '../../../../supabase/conta/pgc/serie.json'
import equivalencias from '../../../../supabase/conta/pgc/equivalencias.json'
import ref from '../../../../docs/conta/referencia/serie.json'
import {
  activar, cambioDePlan, coherencia, nuevaSubcuenta, puedeOcultar, rellenar, renumerar, salidaNumeracionAgotada,
  siguienteLibre, subcuenta, type CuentaEmpresa, type Equivalencia, type HojaSerie,
} from '@/modules/conta/lib/planEmpresa'

type Fila = Record<string, unknown>
const hojasDe = (plan: 'pymes' | 'general'): HojaSerie[] =>
  serie.cuentas.filter((c) => c.plan === plan && c.is_leaf).map((c) => ({ code: c.code, name: c.name, plainName: c.plain_name }))
const HOJAS = { pymes: hojasDe('pymes'), general: hojasDe('general') }
const SET = { pymes: new Set(HOJAS.pymes.map((h) => h.code)), general: new Set(HOJAS.general.map((h) => h.code)) }
const filas = (t: string) => (ref.tablas as Record<string, { filas: unknown }>)[t].filas as Fila[]
const IVAS = filas('tax_rate').filter((t) => t.tax_system === 'iva' && t.treatment === 'taxed' && t.valid_to === null && t.territory === 'peninsula_baleares')
  .map((t) => ({ id: String(t.code), rate: Number(t.rate) }))
const RETENCIONES = filas('withholding_rate').filter((t) => t.valid_to === null).map((t) => ({ id: String(t.code), pgcHint: (t.pgc_hint as string) ?? null }))
const GASTOS = filas('expense_category').map((g) => ({ id: String(g.code), pgcHint: String(g.pgc) }))
// Foodint tiene 19 proveedores (producción, 04/10): el mismo número, sin sus nombres.
const PROVEEDORES = Array.from({ length: 19 }, (_, i) => ({ id: `p${i + 1}`, name: `Proveedor ${i + 1}` }))
const BANCOS = [{ id: 'b1', name: 'Cuenta principal' }]

const base = (comun = false, digitos = 8) => activar({
  hojas: HOJAS.pymes, digitos, ivas: IVAS, retenciones: RETENCIONES, gastos: GASTOS, bancos: BANCOS, proveedores: PROVEEDORES, cuentaComun: { proveedores: comun },
})

describe('rellenar y numerar', () => {
  it('rellena a la longitud de la empresa (D2, D3)', () => {
    expect(rellenar('4700', 8)).toBe('47000000')
    expect(rellenar('76200', 6)).toBe('762000')
    expect(() => rellenar('4700', 4)).toThrow(/de 6 a 12/)
    expect(() => rellenar('76200', 5)).toThrow()
  })
  it('subcuenta n de un prefijo, y el siguiente libre empieza en 1 (el 0 es la común)', () => {
    expect(subcuenta('4000', 8, 12)).toBe('40000012')
    expect(subcuenta('472', 8, 21)).toBe('47200021')
    expect(subcuenta('4000', 6, 100)).toBeNull()
    expect(siguienteLibre('4000', 8, new Set(['40000001', '40000002']))).toBe('40000003')
  })
})

describe('activar el plan en una empresa', () => {
  it('copia las 615 hojas de pymes rellenadas, sin ningún choque', () => {
    const { cuentas, avisos } = base()
    expect(avisos).toEqual([])
    expect(cuentas.filter((c) => c.kind === 'template')).toHaveLength(615)
    expect(new Set(cuentas.map((c) => c.code)).size).toBe(cuentas.length)
    expect(cuentas.every((c) => c.code.length === 8)).toBe(true)
  })

  it('472 y 477 por cada tipo de IVA vigente: 21, 10 y 4 (el ejemplo del encargo)', () => {
    const { cuentas, enlaces } = base()
    const iva = cuentas.filter((c) => c.kind === 'own' && /^47[27]/.test(c.code)).map((c) => c.code).sort()
    expect(iva).toEqual(['47200004', '47200010', '47200021', '47700004', '47700010', '47700021'])
    const general = enlaces.filter((l) => l.entity === 'tax_rate' && l.entityId === 'iva_general').map((l) => `${l.role}:${l.code}`).sort()
    expect(general).toEqual(['repercutido:47700021', 'soportado:47200021'])
  })

  it('cada retención a 4751 y cada tipo de gasto a su 6xx: enlaces reales, no pistas', () => {
    const { enlaces } = base()
    const ret = enlaces.filter((l) => l.entity === 'withholding_rate')
    expect(ret).toHaveLength(RETENCIONES.length)
    expect(new Set(ret.map((l) => l.code))).toEqual(new Set(['47510000']))
    const g = Object.fromEntries(enlaces.filter((l) => l.entity === 'expense_category').map((l) => [l.entityId, l.code]))
    expect(g.rent).toBe('62100000')
    expect(g.food_beverage).toBe('60000000')
    expect(Object.keys(g)).toHaveLength(GASTOS.length)
  })

  it('una subcuenta por banco (57200001) y por proveedor (40000001…40000019)', () => {
    const { cuentas, enlaces } = base()
    expect(enlaces.find((l) => l.entity === 'bank_account')?.code).toBe('57200001')
    const prov = enlaces.filter((l) => l.entity === 'supplier').map((l) => l.code)
    expect(prov[0]).toBe('40000001')
    expect(prov.at(-1)).toBe('40000019')
    expect(cuentas.find((c) => c.code === '40000012')?.name).toBe('Proveedores · Proveedor 12')
  })

  it('con «cuenta común» los proveedores van todos a 40000000 y no se crea ninguna subcuenta', () => {
    const { cuentas, enlaces } = base(true)
    expect(cuentas.some((c) => c.templateCode === '4000' && c.kind === 'own')).toBe(false)
    expect(new Set(enlaces.filter((l) => l.entity === 'supplier').map((l) => l.code))).toEqual(new Set(['40000000']))
  })

  it('430: solo la común, sin subcuentas (D5)', () => {
    const { cuentas } = base()
    expect(cuentas.filter((c) => c.templateCode === '4300').map((c) => [c.code, c.kind, c.isCommon])).toEqual([['43000000', 'template', true]])
  })

  it('el resultado es coherente', () => {
    const { cuentas, enlaces } = base()
    expect(coherencia(cuentas, enlaces, SET.pymes, 8)).toEqual([])
  })
})

describe('coherencia (encargo §3)', () => {
  it('subcuenta colgada de una cuenta con hijas (400 no es hoja), y longitud distinta', () => {
    const { cuentas, enlaces } = base()
    const mal: CuentaEmpresa[] = [...cuentas, { code: '4000001', templateCode: '400', name: 'Inventada', kind: 'own', status: 'activa' }]
    const r = coherencia(mal, enlaces, SET.pymes, 8).map((x) => x.regla).sort()
    expect(r).toEqual(['longitud', 'sin_padre'])
  })
  it('dos proveedores en la misma subcuenta que no es la común', () => {
    const { cuentas, enlaces } = base()
    const dos = [...enlaces, { entity: 'supplier' as const, entityId: 'p2', role: 'principal' as const, code: '40000001' }]
    expect(coherencia(cuentas, dos, SET.pymes, 8).map((x) => x.texto)).toEqual(['40000001 (Proveedores · Proveedor 1) es la subcuenta de dos terceros y no es la cuenta común.'])
  })
  it('una cuenta oculta con enlace activo, y no se deja ocultar', () => {
    const { cuentas, enlaces } = base()
    const oculta = cuentas.map((c) => (c.code === '62100000' ? { ...c, status: 'oculta' as const } : c))
    expect(coherencia(oculta, enlaces, SET.pymes, 8).map((x) => x.regla)).toEqual(['oculta_con_enlace'])
    expect(puedeOcultar('62100000', enlaces)).toEqual({ ok: false, motivo: 'Tiene un enlace activo (expense_category). Cambia antes ese enlace a otra cuenta.' })
    expect(puedeOcultar('62900000', enlaces).ok).toBe(false)
    expect(puedeOcultar('62300000', enlaces).ok).toBe(false)
    expect(puedeOcultar('68100000', enlaces)).toEqual({ ok: true })
  })
})

describe('añadir subcuenta y numeración agotada', () => {
  it('la siguiente libre bajo su hoja', () => {
    const { cuentas } = base()
    const r = nuevaSubcuenta({ code: '4000', name: 'Proveedores (euros)', plainName: null }, 8, cuentas, 'Hermanos Ruiz')
    expect(r).toEqual({ ok: true, cuenta: { code: '40000020', templateCode: '4000', name: 'Hermanos Ruiz', kind: 'own', status: 'activa' } })
  })
  it('con 6 dígitos caben 99 proveedores; el 100 dice que se ha agotado', () => {
    const cien = activar({ hojas: HOJAS.pymes, digitos: 6, ivas: [], retenciones: [], gastos: [], bancos: [],
      proveedores: Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), cuentaComun: { proveedores: false } })
    expect(cien.cuentas.filter((c) => c.templateCode === '4000' && c.kind === 'own')).toHaveLength(99)
    expect(cien.avisos).toEqual(['Numeración agotada en 4000: P99 se queda sin subcuenta.'])
  })
  it('agotada antes del primer asiento: ampliar; después: prefijo libre en la misma cuenta (no amplía sola)', () => {
    const cuadro = new Set(serie.cuentas.filter((c) => c.plan === 'pymes').map((c) => c.code))
    expect(salidaNumeracionAgotada('4000', 6, false, cuadro, new Set())).toMatchObject({ tipo: 'ampliar', digitos: 7 })
    expect(salidaNumeracionAgotada('4000', 6, true, cuadro, new Set())).toMatchObject({ tipo: 'prefijo', prefijo: '4001' })
    expect(salidaNumeracionAgotada('4000', 6, true, cuadro, new Set(['4001', '4002']))).toMatchObject({ tipo: 'prefijo', prefijo: '4003' })
    expect(salidaNumeracionAgotada('4000', 12, false, cuadro, new Set())).toMatchObject({ tipo: 'prefijo' })
  })
})

describe('renumerar al cambiar la longitud (antes del primer asiento)', () => {
  it('8 → 10: conserva el número de cada subcuenta y no choca nada', () => {
    const { cuentas } = base()
    const r = renumerar(cuentas, 8, 10)
    if (!r.ok) throw new Error(r.motivo)
    const m = new Map(r.cambios.map((c) => [c.antes, c.despues]))
    expect(m.get('40000012')).toBe('4000000012')
    expect(m.get('47200021')).toBe('4720000021')
    expect(m.get('47000000')).toBe('4700000000')
    expect(new Set(r.cambios.map((c) => c.despues)).size).toBe(cuentas.length)
  })
  it('8 → 6 cabe (19 proveedores); a 5 no se deja', () => {
    const { cuentas } = base()
    expect(renumerar(cuentas, 8, 6).ok).toBe(true)
    expect(renumerar(cuentas, 8, 5)).toEqual({ ok: false, motivo: 'La longitud tiene que ir de 6 a 12 dígitos.' })
  })
  it('a 6 no cabe una subcuenta con número de tres cifras', () => {
    const { cuentas } = base()
    const mas = [...cuentas, { code: '40000120', templateCode: '4000', name: 'Proveedor 120', kind: 'own' as const, status: 'activa' as const }]
    expect(renumerar(mas, 8, 6)).toEqual({ ok: false, motivo: '40000120 (Proveedor 120) no cabe en 6 dígitos.' })
  })
})

describe('cambio de plan (D4)', () => {
  const EQ = equivalencias.pymes_a_general as Equivalencia[]
  it('pymes → general: añade las hojas que faltan; lo que cuelga de una hoja que deja de serlo, a elegir', () => {
    const { cuentas, enlaces } = base()
    const conDerivado: CuentaEmpresa[] = [...cuentas, { code: '17600001', templateCode: '176', name: 'Derivado de prueba', kind: 'own', status: 'activa' }]
    const r = cambioDePlan('pymes', 'general', conDerivado, enlaces, SET, EQ)
    if (!r.ok) throw new Error(r.motivo)
    expect(r.elegir.map((x) => [x.cuenta.code, x.equivalencia.candidatos.map((c) => c.code)])).toEqual([['17600001', ['1765', '1768']]])
    expect(r.anadir).toContain('800')
    expect(r.anadir.every((h) => SET.general.has(h) && !SET.pymes.has(h))).toBe(true)
    expect(r.aviso).toMatch(/lo decidís la empresa y su asesor/)
  })
  it('una hoja de pymes sin nada colgando no pide elegir nada', () => {
    const { cuentas, enlaces } = base()
    const r = cambioDePlan('pymes', 'general', cuentas, enlaces, SET, EQ)
    expect(r.ok && r.elegir).toEqual([])
  })
  it('general → pymes: se bloquea con datos en una cuenta que pymes no tiene, con la lista', () => {
    const g = activar({ hojas: HOJAS.general, digitos: 8, ivas: IVAS, retenciones: RETENCIONES, gastos: GASTOS, bancos: BANCOS, proveedores: PROVEEDORES, cuentaComun: { proveedores: false } })
    const libre = cambioDePlan('general', 'pymes', g.cuentas, g.enlaces, SET, EQ)
    expect(libre.ok).toBe(true)
    const con8 = [...g.cuentas, { code: '80000001', templateCode: '800', name: 'Ajuste', kind: 'own' as const, status: 'activa' as const }]
    const r = cambioDePlan('general', 'pymes', con8, g.enlaces, SET, EQ)
    expect(r).toMatchObject({ ok: false, motivo: 'No se puede pasar al plan de pymes: hay una cuenta con datos en cuentas que el plan de pymes no tiene (80000001).' })
  })
  it('las 12 equivalencias tienen candidatos con su línea del cuadro', () => {
    expect(EQ).toHaveLength(12)
    for (const e of EQ) {
      expect(e.candidatos.length, e.code).toBeGreaterThan(0)
      for (const c of e.candidatos) expect(c.cita).toMatch(/^RD 1514\/2007, cuarta parte/)
    }
  })
})
