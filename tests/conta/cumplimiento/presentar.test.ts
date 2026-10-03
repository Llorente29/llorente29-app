// tests/conta/cumplimiento/presentar.test.ts
//
// Respuesta 3 del C00, punto 5: la ficha de la empresa tiene que bastar para
// presentar el modelo 200 y depositar las cuentas. La lista de lo que piden
// vive en src/modules/conta/lib/presentar.ts (la pantalla) y en
// scripts/conta/lib/coherencia.mjs (el agente, en ámbar). Aquí: que cada
// requisito se detecta solo, y que la app y el agente dicen lo mismo sobre
// TODAS las combinaciones de datos que faltan (2^14), no sobre tres ejemplos.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { faltaParaPresentar, revisarCoherencia, tocaPresentar as tocaAgente } from '../../../scripts/conta/lib/coherencia.mjs'
import { faltan, requisitosParaPresentar, tocaPresentar } from '@/modules/conta/lib/presentar'
import type { DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'

const HOY = '2026-10-03'

/** Una sociedad con TODO lo que piden el 200 y el depósito. */
function completa(): DatosEmpresa {
  return {
    empresa: {
      id: 'e', legalName: 'Llorente29 Food, S.L.', tradeName: null, taxId: 'B56496938', taxIdVerifiedAt: null, entityKind: 'company',
      legalFormCode: 'nif_b', fiscalStreetType: 'Calle', fiscalStreet: 'Florencio Llorente', fiscalNumber: '29', fiscalExtra: null,
      fiscalPostalCode: '28027', fiscalCity: 'Madrid', fiscalProvince: 'Madrid', fiscalCountry: 'ES',
      registryName: 'Madrid', registryVolume: '40000', registryFolio: '1', registrySheet: 'M-700000', registryEntry: '1.ª',
      incorporatedOn: '2021-03-15', dehuEmail: 'avisos@llorente29.test', dehuPhone: null, phone: '910000000', email: null,
      setupStep: 'hecho', setupCompletedAt: '2026-10-03',
    },
    perfil: null,
    actividades: [{ id: 'a', kind: 'business', iaeCode: '1_6779', iaeTitle: null, cnaeCode: '5611', cnaeTitle: null, description: 'Comida a domicilio', startedOn: null, endedOn: null, isMain: true }],
    ejercicios: [
      { id: 'y25', code: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31', status: 'closed', averageStaffFixed: 4, averageStaffTemporary: 1.5, isAudited: false },
      { id: 'y26', code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', status: 'open' },
    ],
    cierres: [],
    socios: [
      { id: 's1', fullName: 'Julio', taxId: '00000000T', roles: ['administrator', 'partner'], ownershipPct: 60, startedOn: null, endedOn: null, signsAccounts: true },
      { id: 's2', fullName: 'Socia', taxId: '11111111H', roles: ['partner'], ownershipPct: 40, startedOn: null, endedOn: null },
    ],
    dominante: null, formasJuridicas: [], regimenes: [], modelos: [], ia: { origenes: [], sugerencias: [], registro: [] },
  }
}

/** Cada requisito, y cómo se rompe UNA sola cosa para que falte. */
const ROMPER: Record<string, (d: DatosEmpresa) => void> = {
  razon_social: (d) => { d.empresa.legalName = null },
  nif: (d) => { d.empresa.taxId = null },
  forma: (d) => { d.empresa.legalFormCode = null },
  domicilio: (d) => { d.empresa.fiscalPostalCode = null },
  constitucion: (d) => { d.empresa.incorporatedOn = null },
  registro: (d) => { d.empresa.registryFolio = null },
  contacto: (d) => { d.empresa.phone = null; d.empresa.email = null },
  dehu: (d) => { d.empresa.dehuEmail = null },
  cnae: (d) => { d.actividades[0].cnaeCode = null },
  representante: (d) => { d.socios![0].roles = ['partner'] },
  socios: (d) => { d.socios![1].taxId = null },
  firmantes: (d) => { d.socios![0].signsAccounts = false },
  plantilla: (d) => { d.ejercicios[0].averageStaffTemporary = null },
  auditoria: (d) => { d.ejercicios[0].isAudited = null },
}
const CLAVES = Object.keys(ROMPER)

/** La empresa como la saca el volcado del agente (agente-datos-maestros.sql). */
function aVolcado(d: DatosEmpresa, taxForms: string[] = []) {
  const e = d.empresa
  return {
    account_id: 'c01a0000-x', legal_name: e.legalName, entity_kind: e.entityKind, completa: true, tax_forms: taxForms,
    tax_id: e.taxId, legal_form_code: e.legalFormCode, fiscal_street: e.fiscalStreet, fiscal_postal_code: e.fiscalPostalCode,
    fiscal_city: e.fiscalCity, incorporated_on: e.incorporatedOn, registry_name: e.registryName, registry_volume: e.registryVolume,
    registry_folio: e.registryFolio, registry_sheet: e.registrySheet, registry_entry: e.registryEntry, phone: e.phone, email: e.email,
    dehu_email: e.dehuEmail,
    actividades: d.actividades.map((a) => ({ description: a.description, iae_code: a.iaeCode, cnae_code: a.cnaeCode, ended_on: a.endedOn, is_main: a.isMain })),
    personas: (d.socios ?? []).map((s) => ({ roles: s.roles, tax_id_puesto: s.taxId !== null, ownership_pct: s.ownershipPct, signs_accounts: s.signsAccounts === true, ended_on: s.endedOn })),
    ejercicios: d.ejercicios.map((y) => ({ code: y.code, status: y.status, starts_on: y.startsOn, ends_on: y.endsOn,
      average_staff_fixed: y.averageStaffFixed ?? null, average_staff_temporary: y.averageStaffTemporary ?? null,
      is_audited: y.isAudited ?? null, auditor_name: y.auditorName ?? null, audit_opinion: y.auditOpinion ?? null })),
  }
}

describe('lo que piden el 200 y el depósito, uno a uno', () => {
  it('con todo, no falta nada', () => {
    expect(faltan(requisitosParaPresentar(completa(), HOY))).toEqual([])
  })
  it('cada requisito se detecta solo: romper una cosa hace que falte esa y ninguna otra', () => {
    for (const clave of CLAVES) {
      const d = completa()
      ROMPER[clave](d)
      expect(faltan(requisitosParaPresentar(d, HOY)).map((r) => r.clave), clave).toEqual([clave])
    }
  })
  it('sin socios a la vista (no es administrador) no se dice «falta»: no se sabe', () => {
    const d = completa()
    d.socios = null
    const rs = requisitosParaPresentar(d, HOY)
    expect(rs.filter((r) => r.estado === 'no_se').map((r) => r.clave)).toEqual(['representante', 'socios', 'firmantes'])
  })
  it('un autónomo no presenta el 200 ni deposita cuentas', () => {
    const d = completa()
    d.empresa.entityKind = 'self_employed'
    expect(requisitosParaPresentar(d, HOY)).toEqual([])
    expect(tocaPresentar(d)).toBe(false)
  })
  it('toca presentar con un ejercicio cerrado o con el 200 entre los modelos', () => {
    const d = completa()
    expect(tocaPresentar(d)).toBe(true)
    d.ejercicios = d.ejercicios.filter((y) => y.status === 'open')
    expect(tocaPresentar(d)).toBe(false)
    d.perfil = { taxTerritory: 'peninsula_baleares', vatSchemeCode: null, vatCashBasis: false, vatSurcharge: false, vatPeriod: 'quarterly',
      vatProrata: false, vatProrataPct: null, sii: false, chartKind: 'pymes', accountDigits: 8, taxForms: ['200', '202'], salesTaxRateCode: null }
    expect(tocaPresentar(d)).toBe(true)
  })
  it('la plantilla y la auditoría son las del último ejercicio cerrado', () => {
    const d = completa()
    d.ejercicios[1].averageStaffFixed = null // el abierto no cuenta
    expect(faltan(requisitosParaPresentar(d, HOY))).toEqual([])
    expect(requisitosParaPresentar(d, HOY).find((r) => r.clave === 'plantilla')!.texto).toBe('Plantilla media de 2025, fija y no fija')
  })
})

describe('la app y el agente dicen lo mismo', () => {
  it('en las 16.384 combinaciones de los 14 requisitos', () => {
    let vistas = 0
    for (let m = 0; m < 1 << CLAVES.length; m++) {
      const d = completa()
      CLAVES.forEach((c, i) => { if (m & (1 << i)) ROMPER[c](d) })
      const app = faltan(requisitosParaPresentar(d, HOY)).map((r) => r.clave)
      const agente = faltaParaPresentar(aVolcado(d), HOY).map((r: { clave: string }) => r.clave)
      if (JSON.stringify(app) !== JSON.stringify(agente)) expect(agente, `combinación ${m}`).toEqual(app)
      vistas++
    }
    expect(vistas).toBe(16384)
  })
  it('y cuándo toca', () => {
    const d = completa()
    expect(tocaAgente(aVolcado(d))).toBe(tocaPresentar(d))
    d.ejercicios = d.ejercicios.filter((y) => y.status === 'open')
    expect(tocaAgente(aVolcado(d))).toBe(false)
    expect(tocaAgente(aVolcado(d, ['200']))).toBe(true)
  })
})

describe('el agente avisa en ámbar, sin interrumpir', () => {
  it('a quien ya le toca presentar, cada cosa que falta con el documento que la pide', () => {
    const d = completa()
    d.empresa.incorporatedOn = null
    d.ejercicios[0].isAudited = null
    const r = revisarCoherencia({ tablas: { tax_form: [] }, empresas: [aVolcado(d)] }, { hoy: HOY })
    expect(r.map((x: { nivel: string; detalle: string }) => `${x.nivel} ${x.detalle}`)).toEqual([
      'ambar Falta «Fecha de constitución», que piden el modelo 200 y el depósito de cuentas.',
      'ambar Falta «Si las cuentas de 2025 están auditadas y, si lo están, el auditor y su opinión», que piden el modelo 200 y el depósito de cuentas.',
    ])
  })
  it('a quien aún no le toca, nada', () => {
    const d = completa()
    d.ejercicios = d.ejercicios.filter((y) => y.status === 'open')
    d.empresa.incorporatedOn = null
    expect(revisarCoherencia({ tablas: { tax_form: [] }, empresas: [aVolcado(d)] }, { hoy: HOY })).toEqual([])
  })
  it('el volcado no saca el NIF de las personas: solo si lo tienen', () => {
    const sql = readFileSync('scripts/conta/agente-datos-maestros.sql', 'utf8')
    expect(sql).toContain("'tax_id_puesto', x.tax_id is not null")
    expect(sql).not.toMatch(/'tax_id', x\.tax_id/)
    expect(sql).not.toMatch(/full_name/)
  })
})
