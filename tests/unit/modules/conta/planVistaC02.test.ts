// tests/unit/modules/conta/planVistaC02.test.ts
//
// C02, tarea 4 · La vista del plan (src/modules/conta/lib/planVista.ts) sobre
// la serie REAL (supabase/conta/pgc/serie.json) y un plan activado con el
// núcleo (activar) y los tipos de serie del C00 (regla 31).

import { describe, expect, it } from 'vitest'
import serie from '../../../../supabase/conta/pgc/serie.json'
import ref from '../../../../docs/conta/referencia/serie.json'
import { activar } from '@/modules/conta/lib/planEmpresa'
import { cuentasPorGrupo, encaja, filasPlan, loQueLleva, resumenPlan, type CuentaPlan, type CuentaSeriePlan, type EnlacePlan } from '@/modules/conta/lib/planVista'

type Fila = Record<string, unknown>
const SERIE: CuentaSeriePlan[] = serie.cuentas.filter((c) => c.plan === 'pymes')
  .map((c) => ({ code: c.code, name: c.name, plainName: c.plain_name, groupCode: c.group_code, parentCode: c.parent_code, isLeaf: c.is_leaf }))
const filas = (t: string) => (ref.tablas as Record<string, { filas: unknown }>)[t].filas as Fila[]
const r = activar({
  hojas: SERIE.filter((s) => s.isLeaf).map((s) => ({ code: s.code, name: s.name, plainName: s.plainName })), digitos: 8,
  ivas: filas('tax_rate').filter((t) => t.tax_system === 'iva' && t.treatment === 'taxed' && t.valid_to === null).map((t) => ({ id: String(t.code), rate: Number(t.rate) })),
  retenciones: [], gastos: filas('expense_category').map((g) => ({ id: String(g.code), pgcHint: String(g.pgc) })),
  bancos: [{ id: 'b1', name: 'Cuenta principal' }],
  proveedores: [{ id: 'p1', name: 'Hermanos Ruiz', gastoPista: '600' }, { id: 'p2', name: 'Locales del Norte', gastoPista: '621' }],
  cuentaComun: { proveedores: false },
})
const plain = new Map(SERIE.map((s) => [s.code, s.plainName]))
const CUENTAS: CuentaPlan[] = r.cuentas.map((c) => ({
  id: c.code, code: c.code, templateCode: c.templateCode, name: c.name, plainName: c.kind === 'template' ? plain.get(c.templateCode) ?? null : null,
  keywords: c.code === '41000001' ? ['local', 'casero'] : [], kind: c.kind, status: c.status, isCommon: !!c.isCommon, source: 'serie',
}))
const ENLACES: EnlacePlan[] = r.enlaces.map((l) => ({ companyAccountId: l.code, entity: l.entity, entityId: l.entityId, role: l.role }))
const vista = (o: Partial<Parameters<typeof filasPlan>[0]>) => filasPlan({ serie: SERIE, cuentas: CUENTAS, enlaces: ENLACES, grupo: 4, busqueda: '', orden: 'todas', ...o })

describe('filas del plan', () => {
  it('grupo 4: cabeceras con código corto, hojas completas y subcuentas debajo de su hoja', () => {
    const f = vista({})
    const i400 = f.findIndex((x) => x.numero === '400')
    expect(f[i400]).toMatchObject({ tipo: 'cabecera', titulo: 'Proveedores', cuentaId: null })
    expect(f[i400 + 1]).toMatchObject({ tipo: 'cuenta', numero: '40000000' })
    expect(f[i400 + 2]).toMatchObject({ tipo: 'subcuenta', numero: '40000001', titulo: 'Proveedores · Hermanos Ruiz', lleva: '1 proveedor', origen: 'tuya' })
    expect(f.find((x) => x.numero === '41000001')).toMatchObject({ tipo: 'subcuenta', titulo: 'Acreedores · Locales del Norte' })
    expect(f.find((x) => x.numero === '47200021')).toMatchObject({ lleva: '1 tipo de IVA', origen: 'tuya' })
    expect(f.find((x) => x.numero === '40')).toMatchObject({ tipo: 'subgrupo' })
  })

  it('«Las que usas» ordena y no quita nada (regla 7)', () => {
    const todas = vista({ orden: 'todas' })
    const usadas = vista({ orden: 'usadas' })
    expect(usadas).toHaveLength(todas.length)
    expect(new Set(usadas.map((x) => x.clave))).toEqual(new Set(todas.map((x) => x.clave)))
    // En el subgrupo 47, la rama de 472 (usada) va antes que la de 470 (no usada).
    const pos = (n: string) => usadas.findIndex((x) => x.numero === n)
    expect(pos('472')).toBeLessThan(pos('470'))
  })

  it('buscar «alquiler» encuentra la 621 por lo que se apunta en ella, aunque esté en otro grupo', () => {
    const f = vista({ busqueda: 'alquiler' })
    expect(f.filter((x) => x.cuentaId).map((x) => x.numero)).toContain('62100000')
    expect(f.find((x) => x.numero === '62')).toBeTruthy()
  })

  it('buscar por número y por palabra clave', () => {
    expect(vista({ busqueda: '4720' }).filter((x) => x.cuentaId).map((x) => x.numero)).toEqual(['47200000', '47200004', '47200010', '47200021'])
    expect(vista({ busqueda: 'casero' }).filter((x) => x.cuentaId).map((x) => x.numero)).toEqual(['41000001'])
    expect(encaja('Hacienda IVA', { code: '472', name: 'Hacienda Pública, IVA soportado', plainName: null })).toBe(true)
  })
})

describe('cifras y resumen', () => {
  it('lo que lleva una cuenta', () => {
    expect(loQueLleva([])).toBeNull()
    expect(loQueLleva(ENLACES.filter((l) => l.companyAccountId === '60200000'))).toBe('2 tipos de gasto')
  })
  it('la línea del índice dice la cifra real (D2), no la de la maqueta', () => {
    expect(resumenPlan({ plan: 'pymes', digitos: 8, cuentas: CUENTAS.length })).toBe(`Pymes · 8 dígitos · ${CUENTAS.length} cuentas`)
    expect(resumenPlan(null)).toBe('Sin activar')
    expect([...cuentasPorGrupo(CUENTAS).keys()].sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
