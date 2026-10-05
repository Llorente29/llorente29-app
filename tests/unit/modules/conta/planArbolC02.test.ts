// tests/unit/modules/conta/planArbolC02.test.ts
//
// C02, respuesta 5 · El plan como árbol plegable, con la serie REAL
// (supabase/conta/pgc/serie.json) y un plan activado igual que la base
// (activar() del núcleo), como planVistaC02.test.ts.

import { describe, expect, it } from 'vitest'
import serie from '../../../../supabase/conta/pgc/serie.json'
import ref from '../../../../docs/conta/referencia/serie.json'
import { activar } from '@/modules/conta/lib/planEmpresa'
import type { CuentaPlan, CuentaSeriePlan, EnlacePlan } from '@/modules/conta/lib/planVista'
import {
  abiertosPorDefecto, arbolPlan, duenoDeCuenta, estaAbierto, filasBuscadas, filasVisibles, hijasDe, resumenNodo, textoRuta,
} from '@/modules/conta/lib/planArbol'

type Fila = Record<string, unknown>
const SERIE: CuentaSeriePlan[] = serie.cuentas.filter((c) => c.plan === 'pymes')
  .map((c) => ({ code: c.code, name: c.name, plainName: c.plain_name, boeDefinition: c.boe_definition, groupCode: c.group_code, parentCode: c.parent_code, isLeaf: c.is_leaf }))
const filas = (t: string) => (ref.tablas as Record<string, { filas: unknown }>)[t].filas as Fila[]
const r = activar({
  hojas: SERIE.filter((s) => s.isLeaf).map((s) => ({ code: s.code, name: s.name, plainName: s.plainName })), digitos: 8,
  ivas: filas('tax_rate').filter((t) => t.tax_system === 'iva' && t.treatment === 'taxed' && t.valid_to === null).map((t) => ({ id: String(t.code), rate: Number(t.rate) })),
  retenciones: [], gastos: filas('expense_category').map((g) => ({ id: String(g.code), pgcHint: String(g.pgc) })),
  bancos: [{ id: 'b1', name: 'Cuenta principal' }],
  proveedores: [
    { id: 'p1', name: 'Hermanos Ruiz', gastoPista: '600' }, { id: 'p2', name: 'Bebidas Sol', gastoPista: '600' },
    { id: 'p3', name: 'Mercados del Norte', gastoPista: '600' }, { id: 'p4', name: 'Locales del Norte', gastoPista: '621' },
  ],
  cuentaComun: { proveedores: false },
})
const plain = new Map(SERIE.map((s) => [s.code, s.plainName]))
const CUENTAS: CuentaPlan[] = r.cuentas.map((c) => ({
  id: c.code, code: c.code, templateCode: c.templateCode, name: c.name, plainName: c.kind === 'template' ? plain.get(c.templateCode) ?? null : null,
  keywords: [], kind: c.kind, status: c.status, isCommon: !!c.isCommon, source: 'serie',
}))
const ENLACES: EnlacePlan[] = r.enlaces.map((l) => ({ companyAccountId: l.code, entity: l.entity, entityId: l.entityId, role: l.role }))
const A = arbolPlan({ serie: SERIE, cuentas: CUENTAS, enlaces: ENLACES })
const n = (k: string) => A.nodos.get(k)!

describe('el árbol', () => {
  it('niveles: grupo › subgrupo › cuenta › cuenta de apunte › subcuentas de la empresa', () => {
    expect([n('4').tipo, n('40').tipo, n('400').tipo, n('40000000').tipo, n('40000001').tipo]).toEqual(['grupo', 'subgrupo', 'cuenta', 'apunte', 'subcuenta'])
    expect([n('4').nivel, n('40').nivel, n('400').nivel, n('40000000').nivel, n('40000001').nivel]).toEqual([1, 2, 3, 4, 5])
    expect(n('40000001').padre).toBe('40000000')
    expect(textoRuta(n('40000001'))).toBe('4 › 40 › 400 › 40000000')
    // Una hoja de tres cifras (572) no sale como rama: sale su cuenta de apunte bajo el subgrupo.
    expect(n('57200000').padre).toBe('57')
  })
  it('la fila cerrada dice lo que lleva: «400 · Proveedores · N cuentas · 3 subcuentas tuyas»', () => {
    const apuntesDel400 = CUENTAS.filter((c) => c.kind === 'template' && c.templateCode.startsWith('400')).length
    expect(resumenNodo(n('400'))).toBe(`${apuntesDel400} cuentas · 3 subcuentas tuyas`)
    expect(resumenNodo(n('40000000'))).toBe('3 subcuentas tuyas')
    expect(resumenNodo(n('40000001'))).toBeNull()
  })
  it('todas las cuentas de la empresa están en el árbol, una vez', () => {
    expect([...A.porCodigo.keys()].sort()).toEqual(CUENTAS.map((c) => c.code).sort())
  })
  it('las hijas de un nivel, para «Sumas y saldos»', () => {
    expect(hijasDe(A, '400').map((x) => x.numero)).toEqual(CUENTAS.filter((c) => c.kind === 'template' && c.templateCode.startsWith('400')).map((c) => c.code).sort())
  })
})

describe('estado inicial', () => {
  it('«Todas»: el grupo abierto hasta el nivel de cuenta; la 40000000 no se ve con la 400 cerrada', () => {
    const def = abiertosPorDefecto(A, '4', 'todas')
    const vis = filasVisibles(A, '4', (k) => estaAbierto(k, new Map(), def), 'todas').map((x) => x.numero)
    expect(vis).toContain('400')
    expect(vis).toContain('403')
    expect(vis).not.toContain('40000000')
    expect(vis).not.toContain('40000001')
  })
  it('«Las que usas»: abiertas las que tienen subcuentas o enlaces; las demás, cerradas', () => {
    const def = abiertosPorDefecto(A, '4', 'usadas')
    expect(def.has('400')).toBe(true)
    expect(def.has('40000000')).toBe(true)
    expect(def.has('403')).toBe(false)
    const vis = filasVisibles(A, '4', (k) => estaAbierto(k, new Map(), def), 'usadas').map((x) => x.numero)
    expect(vis).toContain('40000001')
    // Ordena, no esconde (regla 7): la 403 sigue, plegada.
    expect(vis).toContain('403')
    expect(vis).not.toContain('40300000')
  })
  it('lo que la persona ha tocado manda sobre el estado inicial', () => {
    const def = abiertosPorDefecto(A, '4', 'usadas')
    const tocados = new Map([['400', false], ['403', true]])
    const vis = filasVisibles(A, '4', (k) => estaAbierto(k, tocados, def), 'usadas').map((x) => x.numero)
    expect(vis).not.toContain('40000000')
    expect(vis).toContain('40300000')
  })
})

describe('buscar aplana', () => {
  it('«alquiler»: la 62100000 por lo que se apunta en ella, con su ruta', () => {
    const f = filasBuscadas(A, CUENTAS, SERIE, 'alquiler')
    expect(f.map((x) => x.numero)).toContain('62100000')
    // En pymes la 621 es hoja: su cuenta de apunte cuelga del subgrupo.
    expect(textoRuta(f.find((x) => x.numero === '62100000')!)).toBe('6 › 62')
    expect(f.every((x) => x.cuentaId)).toBe(true)
  })
  it('por número: «4720» trae las subcuentas del IVA soportado, solo cuentas', () => {
    const f = filasBuscadas(A, CUENTAS, SERIE, '4720').map((x) => x.numero)
    expect(f.length).toBeGreaterThan(0)
    expect(f.every((x) => x.startsWith('4720'))).toBe(true)
  })
  it('por la cuenta del cuadro: «Proveedores, empresas del grupo» trae las de la 403', () => {
    const f = filasBuscadas(A, CUENTAS, SERIE, 'Proveedores, empresas del grupo').map((x) => x.numero)
    expect(f).toContain('40300000')
  })
})

describe('de quién es una cuenta (enlaces del Mayor)', () => {
  const c = (code: string) => CUENTAS.find((x) => x.code === code)!
  it('la subcuenta de un proveedor es suya; la de un banco, del banco; la del IVA, del IVA', () => {
    expect(duenoDeCuenta(c('40000001'), ENLACES)).toMatchObject({ tipo: 'proveedor' })
    expect(duenoDeCuenta(c('57200001'), ENLACES)).toEqual({ tipo: 'banco', id: 'b1' })
    expect(duenoDeCuenta(c('47200021'), ENLACES)).toMatchObject({ tipo: 'iva' })
  })
  it('una cuenta de serie sin enlaces no es de nadie (nada que enlazar)', () => {
    expect(duenoDeCuenta(c('62900000'), ENLACES)).toBeNull()
  })
  it('la común de proveedores no es de ninguno, aunque los lleve a todos', () => {
    const comun = { ...c('40000000'), isCommon: true }
    const enl = [...ENLACES, { companyAccountId: '40000000', entity: 'supplier' as const, entityId: 'p9', role: 'principal' as const }]
    expect(duenoDeCuenta(comun, enl)).toBeNull()
  })
})
