// tests/conta/cumplimiento/agentePlan.test.ts
//
// Pruebas fijas del agente «Plan contable» (C02 §4, scripts/conta/lib/agentePlan.mjs),
// parte de la serie. La base correcta es la serie REAL generada del BOE
// (supabase/conta/pgc/serie.json); los fallos se fabrican haciéndole a una fila
// real lo que le puede pasar (regla 31).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import correcciones from '../../../supabase/conta/pgc/correcciones.json'
import serie from '../../../supabase/conta/pgc/serie.json'
import ref from '../../../docs/conta/referencia/serie.json'
import { activar } from '@/modules/conta/lib/planEmpresa'
import { informePlan, revisarEmpresas, revisarSerieEnBase, revisarSerieEnTexto } from '../../../scripts/conta/lib/agentePlan.mjs'

const textos = {
  pymes: readFileSync('docs/conta/fuentes/textos/rd-1515-2007.txt', 'utf8'),
  general: readFileSync('docs/conta/fuentes/textos/rd-1514-2007.txt', 'utf8'),
}
type Fila = Record<string, unknown>
const base = (): Fila[] => serie.cuentas.map((c) => ({ ...c, valid_to: null }))
const textos_ = (h: { texto: string }[]) => h.map((x) => x.texto)

describe('agente «Plan contable» · serie', () => {
  it('la base y el BOE tal como deben estar: en verde', () => {
    expect(revisarSerieEnTexto(textos, correcciones)).toEqual([])
    expect(revisarSerieEnBase(base(), serie)).toEqual([])
  })

  it('falta una cuenta en la base', () => {
    const b = base().filter((r) => !(r.plan === 'pymes' && r.code === '621'))
    expect(textos_(revisarSerieEnBase(b, serie))).toEqual(['Base · pymes 621 (Arrendamientos y cánones): falta en pgc_account.'])
  })

  it('alguien ha vuelto a cargar el título con la errata', () => {
    const b = base().map((r) => (r.plan === 'pymes' && r.code === '232' ? { ...r, name: 'Propiedad industrial' } : r))
    expect(textos_(revisarSerieEnBase(b, serie))).toEqual(['Base · pymes 232: name es «Propiedad industrial» y la serie dice «Instalaciones técnicas en montaje».'])
  })

  it('una cuenta que no es de la serie, y dos vigentes a la vez', () => {
    const b = [...base(), { ...base()[0], code: '99999', plan: 'pymes' }, { ...base()[1] }]
    const t = textos_(revisarSerieEnBase(b, serie))
    expect(t).toContain('Base · pymes 99999: está en pgc_account y no en la serie.')
    expect(t.some((x) => /hay dos filas vigentes a la vez/.test(x))).toBe(true)
  })

  it('una versión cerrada (valid_to) no cuenta como vigente', () => {
    const vieja = { ...base().find((r) => r.plan === 'general' && r.code === '500')!, valid_from: '2008-01-01', valid_to: '2021-01-31' }
    expect(revisarSerieEnBase([...base(), vieja], serie)).toEqual([])
  })

  it('el BOE corrige una errata: el agente dice que la corrección sobra', () => {
    const corregido = { ...textos, general: textos.general.replaceAll('74.\nSUBVENCIONES, DONACIONESY LEGADOS', '74.\nSUBVENCIONES, DONACIONES Y LEGADOS') }
    expect(corregido.general).not.toBe(textos.general)
    expect(textos_(revisarSerieEnTexto(corregido, correcciones))).toEqual([
      'BOE · general 74: el cuadro ya dice «SUBVENCIONES, DONACIONES Y LEGADOS»: el BOE ha corregido la errata y esta corrección sobra.',
    ])
  })

  it('sin el texto del BOE no da verde', () => {
    expect(textos_(revisarSerieEnTexto({ pymes: textos.pymes }, correcciones))).toEqual(['No tengo el texto del BOE del plan de general: no puedo comprobar la serie.'])
  })

  it('el informe dice el caso concreto', () => {
    const t = informePlan([{ nivel: 'rojo', texto: 'Base · pymes 621 (Arrendamientos y cánones): falta en pgc_account.' }],
      { donde: 'staging-conta', hoy: '2026-10-04', filas: 1685, resumen: serie.resumen })
    expect(t).toMatch(/\*\*1 en rojo:\*\*\n\n- Base · pymes 621/)
  })
})

// ── Empresa por empresa (tarea 3): la base tal como la deja activar() ───────

describe('agente «Plan contable» · empresas', () => {
  const filas = (t: string) => (ref.tablas as Record<string, { filas: unknown }>)[t].filas as Fila[]
  const ivas = filas('tax_rate').filter((t) => t.tax_system === 'iva' && t.treatment === 'taxed' && t.valid_to === null)
  const hojas = serie.cuentas.filter((c) => c.plan === 'pymes' && c.is_leaf).map((c) => ({ code: c.code, name: c.name, plainName: c.plain_name }))
  const empresa = { id: 'e1', account_id: 'c01a0000-cuenta', legal_name: 'Taberna de Prueba', chart_kind: 'pymes', account_digits: 8, tax_territory: 'peninsula_baleares' }
  const bdDe = () => {
    const r = activar({ hojas, digitos: 8, ivas: ivas.map((t) => ({ id: String(t.code), rate: Number(t.rate) })), retenciones: [], gastos: [],
      bancos: [], proveedores: [{ id: 'p1', name: 'Uno' }], cuentaComun: { proveedores: false } })
    const company_account = r.cuentas.map((c) => ({ id: c.code, account_id: empresa.account_id, company_id: 'e1', plan: 'pymes', code: c.code, template_code: c.templateCode, kind: c.kind, status: c.status }))
    const company_account_link = r.enlaces.map((l) => ({ company_id: 'e1', company_account_id: l.code, entity: l.entity, entity_id: l.entityId, role: l.role }))
    const tipos_vigentes = ivas.map((t) => ({ id: String(t.code), code: t.code, rate: t.rate, tax_system: 'iva', is_system: true, account_id: null }))
    return { empresas_plan: [empresa], company_account, company_account_link, tipos_vigentes }
  }

  it('una empresa recién activada está en verde', () => {
    expect(revisarEmpresas(bdDe(), serie)).toEqual([])
  })
  it('una empresa sin plan activado no se revisa (no es un fallo)', () => {
    expect(revisarEmpresas({ ...bdDe(), company_account: [], company_account_link: [] }, serie)).toEqual([])
  })
  it('le falta una hoja, una cuenta con otra longitud, un enlace a una oculta y un IVA sin cuenta', () => {
    const bd = bdDe()
    bd.company_account = bd.company_account.filter((c) => c.code !== '62100000')
      .map((c) => (c.code === '40000001' ? { ...c, status: 'oculta' } : c.code === '68100000' ? { ...c, code: '681000000' } : c))
    bd.company_account_link = bd.company_account_link.filter((l) => !(l.entity_id === 'iva_reducido' && l.role === 'repercutido'))
    expect(textos_(revisarEmpresas(bd, serie))).toEqual([
      'Empresa · Taberna de Prueba (cuenta c01a0000): le faltan 1 cuentas de serie de su plan (621).',
      'Empresa · Taberna de Prueba (cuenta c01a0000): 1 cuentas no tienen 8 dígitos (681000000).',
      'Empresa · Taberna de Prueba (cuenta c01a0000): un supplier apunta a 40000001, que está oculta.',
      'Empresa · Taberna de Prueba (cuenta c01a0000): el tipo iva_reducido (10 %) no tiene cuenta de IVA repercutido.',
    ])
  })
})
