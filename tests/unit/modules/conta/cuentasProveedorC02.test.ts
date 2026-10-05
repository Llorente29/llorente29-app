// tests/unit/modules/conta/cuentasProveedorC02.test.ts
//
// C02, tarea 6 · La pestaña «Contabilidad» de la ficha de proveedor
// (src/modules/conta/lib/cuentasProveedor.ts). Población REAL (regla 31): el
// plan sale de activar() sobre la serie del BOE; los tipos de IVA, retenciones,
// tipos de gasto, regímenes y modelos son los de serie del C00
// (docs/conta/referencia/serie.json). Las citas que no viven en el C00 se
// buscan en el texto descargado del BOE. Los apuntes del extracto son de
// semilla: los de verdad llegan con el C04.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import serie from '../../../../supabase/conta/pgc/serie.json'
import ref from '../../../../docs/conta/referencia/serie.json'
import { activar } from '@/modules/conta/lib/planEmpresa'
import type { CuentaPlan } from '@/modules/conta/lib/planVista'
import {
  CITAS, cuentasDelProveedor, extracto, saldosPorMes, textoSaldo, tipoDeOperacion, vaAl347,
  type Apunte, type EnlaceCuenta, type EntradaCuentas, type ProveedorConta,
} from '@/modules/conta/lib/cuentasProveedor'

type Fila = Record<string, unknown>
const filas = (t: string) => (ref.tablas as Record<string, { filas: unknown }>)[t].filas as Fila[]
const TASAS = filas('tax_rate').filter((t) => t.tax_system === 'iva' && t.treatment === 'taxed' && t.valid_to === null && t.territory === 'peninsula_baleares')
const RETS = filas('withholding_rate').filter((t) => t.valid_to === null)
const GASTOS = filas('expense_category')
const r = activar({
  hojas: serie.cuentas.filter((c) => c.plan === 'pymes' && c.is_leaf).map((c) => ({ code: c.code, name: c.name, plainName: c.plain_name })), digitos: 8,
  ivas: TASAS.map((t) => ({ id: String(t.code), rate: Number(t.rate) })),
  retenciones: RETS.map((t) => ({ id: String(t.code), pgcHint: (t.pgc_hint as string) ?? null })),
  gastos: GASTOS.map((g) => ({ id: String(g.code), pgcHint: String(g.pgc) })),
  bancos: [{ id: 'b1', name: 'Banco Prueba' }],
  proveedores: [{ id: 'p1', name: 'Hermanos Ruiz', gastoPista: '600' }, { id: 'p2', name: 'Locales del Norte', gastoPista: '621' }],
  cuentaComun: { proveedores: false },
})
const CUENTAS: CuentaPlan[] = r.cuentas.map((c) => ({
  id: c.code, code: c.code, templateCode: c.templateCode, name: c.name, plainName: null, keywords: [], kind: c.kind, status: c.status, isCommon: !!c.isCommon, source: 'serie',
}))
const ENLACES: EnlaceCuenta[] = r.enlaces.map((l) => ({ companyAccountId: l.code, entity: l.entity, entityId: l.entityId, role: l.role, source: 'serie' }))
const PROV: ProveedorConta = {
  id: 'p1', name: 'Hermanos Ruiz', entityKind: 'company', taxIdType: 'nif_es', countryCode: 'ES', vatRegime: 'general',
  usualTaxRateIds: ['iva_reducido', 'iva_general'], irpfWithholdingPct: null, expenseCategoryId: 'food_beverage',
}
const conNorma = (t: string) => filas(t).map((f) => ({ code: String(f.code), name: String(f.name), legalRef: (f.legal_ref as string) ?? null }))
const entrada = (o: Partial<EntradaCuentas> = {}): EntradaCuentas => ({
  proveedor: PROV, perfil: { vatProrata: false, vatProrataPct: null, vatSurcharge: false, vatCashBasis: false, presenta347: true },
  cuentas: CUENTAS, enlaces: ENLACES,
  tasas: TASAS.map((t) => ({ id: String(t.code), name: String(t.name), rate: Number(t.rate), surchargeRate: (t.surcharge_rate as number) ?? null })),
  retenciones: RETS.map((t) => ({ id: String(t.code), name: String(t.name), rate: Number(t.rate) })),
  bancos: [{ id: 'b1', name: 'Banco Prueba', iban: 'ES9121000418450200051332' }],
  regimenes: conNorma('vat_scheme'), modelos: conNorma('tax_form'), ...o,
})
const linea = (e: EntradaCuentas, clave: string) => cuentasDelProveedor(e).lineas.find((l) => l.clave === clave)!
const dato = (e: EntradaCuentas, clave: string) => cuentasDelProveedor(e).datos.find((d) => d.clave === clave)

describe('Sus cuentas (maqueta N7)', () => {
  it('su cuenta, sus facturas por su tipo de gasto, el IVA de sus dos tipos y sin retención por ser sociedad', () => {
    const e = entrada()
    expect(linea(e, 'su_cuenta').cuentas.map((c) => c.titulo)).toEqual(['40000001 · Proveedores · Hermanos Ruiz'])
    expect(linea(e, 'facturas')).toMatchObject({ cuentas: [{ titulo: '60000000 · Compras de mercaderías' }], nota: 'por su tipo de gasto', propia: null })
    // El texto entero, no solo el código: el tipo no se repite (salió «21 % 21 %» en la captura del 05/10).
    expect(linea(e, 'iva').cuentas.map((c) => c.titulo)).toEqual(['47200010 · IVA soportado 10 %', '47200021 · IVA soportado 21 %'])
    expect(linea(e, 'retencion')).toMatchObject({ cuentas: [], texto: 'No lleva · es una sociedad' })
    expect(linea(e, 'pago')).toMatchObject({ cuentas: [], texto: 'Sin decir' })
    expect(linea(e, 'suplidos')).toMatchObject({ cuentas: [], texto: 'No lleva' })
  })

  it('su cuenta solo ofrece subcuentas libres del 400/410 (la del otro proveedor, no)', () => {
    const op = linea(entrada(), 'su_cuenta').opciones.map((c) => c.code)
    expect(op).toContain('40000001')
    expect(op).not.toContain('41000001')
    expect(op.every((c) => /^4[01]0/.test(c))).toBe(true)
  })

  it('lo suyo manda sobre lo de su tipo de gasto, y la marca IA sale de lo aprendido', () => {
    const e = entrada({ enlaces: [...ENLACES, { companyAccountId: '62900000', entity: 'supplier', entityId: 'p1', role: 'gasto', source: 'ai_accepted' }] })
    expect(linea(e, 'facturas')).toMatchObject({ cuentas: [{ code: '62900000' }], nota: null, ia: true, propia: '62900000' })
  })

  it('le pagas desde su banco, con el IBAN corto; solo ofrece bancos', () => {
    const e = entrada({ enlaces: [...ENLACES, { companyAccountId: '57200001', entity: 'supplier', entityId: 'p1', role: 'pago', source: 'manual' }] })
    expect(linea(e, 'pago').cuentas[0].titulo).toBe('57200001 · Banco Prueba · ES91 ···· 1332')
    expect(linea(e, 'pago').opciones.map((c) => c.code)).toEqual(['57200001'])
  })

  it('un autónomo con el 15 %: su retención va a la 4751 de profesionales', () => {
    const e = entrada({ proveedor: { ...PROV, entityKind: 'self_employed', irpfWithholdingPct: 15 } })
    expect(linea(e, 'retencion')).toMatchObject({ texto: '15 %', cuentas: [{ code: '47510000' }] })
  })

  it('ISP o compra en la UE: también la 477, porque el IVA lo declaras tú', () => {
    const ue = entrada({ proveedor: { ...PROV, countryCode: 'PT', vatRegime: null, usualTaxRateIds: ['iva_general'] } })
    expect(linea(ue, 'iva')).toMatchObject({ nota: 'compra en la UE: lo declaras tú' })
    expect(linea(ue, 'iva').cuentas.map((c) => c.code)).toEqual(['47200021', '47700021'])
    const isp = entrada({ proveedor: { ...PROV, vatRegime: 'inversion_sujeto_pasivo', usualTaxRateIds: ['iva_general'] } })
    expect(linea(isp, 'iva').nota).toBe('inversión del sujeto pasivo: lo declaras tú')
  })
})

describe('lo que solo sale si aplica (respuesta 2)', () => {
  it('sin prorrata, recargo ni caja en el perfil, no salen', () => {
    expect(cuentasDelProveedor(entrada()).datos.map((d) => d.clave)).toEqual(['identificador', 'operacion'])
    expect(dato(entrada(), 'identificador')!.valor).toBe('NIF')
  })

  it('tipo de operación: España, UE (Grecia es GR) y fuera, con el 303 y el 349 del C00', () => {
    expect(tipoDeOperacion({ vatRegime: null, countryCode: 'ES' })).toBe('espana')
    expect(tipoDeOperacion({ vatRegime: null, countryCode: 'GR' })).toBe('ue')
    expect(tipoDeOperacion({ vatRegime: null, countryCode: 'GB' })).toBe('fuera')
    expect(tipoDeOperacion({ vatRegime: 'intracomunitario', countryCode: 'ES' })).toBe('ue')
    expect(dato(entrada({ proveedor: { ...PROV, countryCode: 'FR', vatRegime: null } }), 'operacion')).toEqual({
      clave: 'operacion', etiqueta: 'Tipo de operación', valor: 'Compra en la UE', fuente: 'Modelo 303 (Orden EHA/3786/2008) y modelo 349 (Orden EHA/769/2010)',
    })
  })

  it('con prorrata, recargo y caja en el perfil: cada uno con su fuente', () => {
    const e = entrada({ perfil: { vatProrata: true, vatProrataPct: 83, vatSurcharge: true, vatCashBasis: true, presenta347: true } })
    expect(dato(e, 'deducible')).toMatchObject({ valor: '83 %', fuente: 'Ley 37/1992, art. 102' })
    expect(dato(e, 'recargo')).toMatchObject({ valor: 'Te lo cobra: 1,4 % con el 10 % y 5,2 % con el 21 %', fuente: 'Ley 37/1992, art. 120.Uno.6' })
    expect(dato(e, 'caja')!.fuente).toBe('Ley 37/1992, art. 120.Uno.9')
  })

  it('las citas que no están en el C00 están, literales, en el texto del BOE descargado', () => {
    for (const c of Object.values(CITAS)) {
      const texto = readFileSync(`docs/conta/fuentes/textos/${c.fuente}.txt`, 'utf8')
      expect(texto.includes(c.literal), `${c.norma}: «${c.literal}»`).toBe(true)
    }
  })
})

describe('va al 347 este año', () => {
  const f = (fecha: string, total: number, abono = false) => ({ fecha, total, abono })
  const base = { año: 2026, perfil: { presenta347: true }, proveedor: PROV }
  it('suma el año natural, resta abonos y compara con 3.005,06 €', () => {
    expect(vaAl347({ ...base, facturas: [f('2026-02-01', 2000), f('2026-09-24', 1005.06)] })).toMatchObject({ va: false, importe: 3005.06 })
    expect(vaAl347({ ...base, facturas: [f('2026-02-01', 2000), f('2026-09-24', 1005.07)] })).toMatchObject({ va: true, texto: 'Sí · supera los 3.005,06 €' })
    expect(vaAl347({ ...base, facturas: [f('2026-02-01', 4000), f('2026-03-01', 1500, true), f('2025-12-31', 9000)] })).toMatchObject({ va: false, importe: 2500 })
  })
  it('no va lo de la UE, lo importado ni lo que lleva retención; ni si la empresa no lo presenta', () => {
    const facturas = [f('2026-05-01', 10000)]
    expect(vaAl347({ ...base, facturas, proveedor: { ...PROV, countryCode: 'IT', vatRegime: null } }).fuente).toBe('RD 1065/2007, art. 33.2.i')
    expect(vaAl347({ ...base, facturas, proveedor: { ...PROV, countryCode: 'US', vatRegime: null } }).fuente).toBe('RD 1065/2007, art. 33.2.g')
    expect(vaAl347({ ...base, facturas, proveedor: { ...PROV, irpfWithholdingPct: 19 } }).va).toBe(false)
    expect(vaAl347({ ...base, facturas, perfil: { presenta347: false } }).va).toBeNull()
  })
})

describe('extracto (semilla: los apuntes llegan con el C04)', () => {
  const A: Apunte[] = [
    { fecha: '2026-03-10', documento: 'F-0310', concepto: 'Factura', debe: 0, haber: 1210, enlace: { tipo: 'factura', id: 'f1' } },
    { fecha: '2026-01-15', documento: 'F-0115', concepto: 'Factura', debe: 0, haber: 605.5, enlace: { tipo: 'factura', id: 'f0' } },
    { fecha: '2026-02-05', documento: 'P-0205', concepto: 'Pago', debe: 605.5, haber: 0, enlace: { tipo: 'pago', id: 'p0' } },
    { fecha: '2025-12-20', documento: 'F-1220', concepto: 'Factura del año anterior', debe: 0, haber: 100, enlace: null },
    { fecha: '2027-01-02', documento: 'F-0102', concepto: 'Factura del año siguiente', debe: 0, haber: 50, enlace: null },
  ]
  it('vista 1: por fecha, con el saldo acumulado desde la apertura', () => {
    const x = extracto(A.filter((a) => a.fecha.startsWith('2026')), 100)
    expect(x.map((a) => [a.documento, a.saldo])).toEqual([['F-0115', 705.5], ['P-0205', 100], ['F-0310', 1310]])
    expect(extracto([])).toEqual([])
  })
  it('vista 2: doce meses del ejercicio, apertura con lo anterior, cierre y total del año', () => {
    const s = saldosPorMes(A, { inicio: '2026-01-01', fin: '2026-12-31' })
    expect(s.meses).toHaveLength(12)
    expect(s.apertura).toBe(100)
    expect(s.meses.slice(0, 3)).toEqual([
      { mes: '2026-01', debe: 0, haber: 605.5, saldo: 605.5, acumulado: 705.5 },
      { mes: '2026-02', debe: 605.5, haber: 0, saldo: -605.5, acumulado: 100 },
      { mes: '2026-03', debe: 0, haber: 1210, saldo: 1210, acumulado: 1310 },
    ])
    expect(s).toMatchObject({ debe: 605.5, haber: 1815.5, cierre: 1310 })
    expect(s.meses[11].acumulado).toBe(1310)
  })
  it('un ejercicio que no empieza en enero', () => {
    const s = saldosPorMes([], { inicio: '2026-07-01', fin: '2027-06-30' })
    expect(s.meses.map((m) => m.mes)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'])
  })
  it('el saldo dice de qué lado está', () => {
    expect(textoSaldo(1283.15)).toEqual({ importe: '1.283,15 €', lado: 'a tu cargo' })
    expect(textoSaldo(-20)).toEqual({ importe: '20 €', lado: 'a su cargo' })
    expect(textoSaldo(0).lado).toBe('a cero')
  })
})
