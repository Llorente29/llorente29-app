// «Tu empresa» del C00 (tarea 5): lo que la pantalla deduce de los datos.
// Los códigos del IAE y la CNAE son los REALES de la migración de valores de
// serie (regla 31); los meses, con el ejercicio natural de 2026.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  codigoIae, direccionEnUnaLinea, ejercicioActual, ejercicioPropuesto, fraseFalta, limpiarTitulo, loQueFalta, mesParaCerrar,
  mesParaReabrir, mesesConEstado, resumenMeses, revisarQuienEres, textoIva, textoRoles,
  type DatosEmpresa, type Empresa, type EjercicioBd, type PerfilFiscal,
} from '@/modules/conta/empresa/datosEmpresa'
import { APARTADOS } from '@/modules/conta/empresa/apartados'

const HOY = '2026-10-02'
const EJ: EjercicioBd = { id: 'e26', code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', status: 'open' }
const cierres = (hasta: number) => Array.from({ length: hasta }, (_, i) => ({ mes: `2026-${String(i + 1).padStart(2, '0')}-01`, quien: 'Admin Norte', cuando: '2026-01-01' }))

const EMPRESA: Empresa = {
  id: 'c', legalName: 'Taberna de Prueba Norte, S.L.', tradeName: 'Taberna de Prueba Norte', taxId: 'B28000016', taxIdVerifiedAt: null,
  entityKind: 'company', legalFormCode: 'nif_b', fiscalStreetType: 'Calle', fiscalStreet: 'de la Prueba', fiscalNumber: '12',
  fiscalExtra: null, fiscalPostalCode: '28001', fiscalCity: 'Madrid', fiscalProvince: 'Madrid', fiscalCountry: 'ES',
  registryName: null, registrySheet: null, setupStep: 'hecho', setupCompletedAt: '2026-10-01T00:00:00Z',
}
const PERFIL: PerfilFiscal = {
  taxTerritory: 'peninsula_baleares', vatSchemeCode: null, vatCashBasis: false, vatSurcharge: false, vatPeriod: 'quarterly',
  vatProrata: false, vatProrataPct: null, sii: false, chartKind: 'pymes', accountDigits: 8, taxForms: ['303', '390', '111', '115', '202'],
}
const REGIMENES = [{ code: 'general', name: 'Régimen general' }, { code: 'simplificado', name: 'Régimen simplificado' }]
const datos = (p: Partial<DatosEmpresa> = {}): DatosEmpresa => ({
  empresa: EMPRESA, perfil: PERFIL, ejercicios: [EJ], cierres: [], socios: [], formasJuridicas: [], regimenes: REGIMENES, modelos: [], ia: { origenes: [], sugerencias: [], registro: [] },
  actividades: [{ id: 'a', kind: 'business', iaeCode: '1_6711', iaeTitle: null, cnaeCode: '5611', cnaeTitle: null, description: 'Restaurante', startedOn: '2022-03-01', endedOn: null, isMain: true }],
  ...p,
})

describe('el ejercicio y sus meses', () => {
  it('cerrado hasta agosto: septiembre y octubre abiertos, noviembre y diciembre por llegar', () => {
    const m = mesesConEstado(EJ, cierres(8), HOY)
    expect(m.map((x) => x.estado)).toEqual([...Array(8).fill('cerrado'), 'abierto', 'abierto', 'futuro', 'futuro'])
    expect(resumenMeses(m)).toBe('Septiembre y octubre abiertos')
    expect(m.map((x) => x.corto).join(' ')).toBe('Ene Feb Mar Abr May Jun Jul Ago Sep Oct Nov Dic')
  })

  it('se cierra en orden y nunca el mes que aún está pasando', () => {
    expect(mesParaCerrar(EJ, cierres(8), HOY)).toBe('2026-09-01')
    expect(mesParaCerrar(EJ, cierres(9), HOY)).toBeNull() // octubre está en curso
    expect(mesParaCerrar(EJ, [], '2026-01-15')).toBeNull()
    expect(mesParaReabrir(EJ, cierres(8))).toBe('2026-08-01')
    expect(mesParaReabrir(EJ, [])).toBeNull()
  })

  it('el ejercicio de hoy, o el propuesto si no hay', () => {
    expect(ejercicioActual([EJ], HOY)?.code).toBe('2026')
    expect(ejercicioActual([], HOY)).toBeNull()
    expect(ejercicioPropuesto(HOY)).toEqual({ code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31' })
  })
})

describe('los textos, como la maqueta', () => {
  it('el IVA en palabras de la calle', () => {
    expect(textoIva(PERFIL, REGIMENES)).toBe('General · cada tres meses')
    expect(textoIva({ ...PERFIL, vatSchemeCode: 'general', vatPeriod: 'monthly' }, REGIMENES)).toBe('General · cada mes')
    expect(textoIva({ ...PERFIL, vatSchemeCode: 'simplificado' }, REGIMENES)).toBe('Régimen simplificado · cada tres meses')
    expect(textoIva({ ...PERFIL, taxTerritory: 'canarias' }, REGIMENES)).toBe('IGIC (Canarias)')
    expect(textoIva(null, REGIMENES)).toBe('Sin poner')
  })

  it('dirección, roles y apartados del móvil', () => {
    expect(direccionEnUnaLinea(EMPRESA)).toBe('C/ de la Prueba 12, Madrid')
    expect(textoRoles(['administrator', 'partner'])).toBe('Administrador · socio')
    const d = datos({ cierres: cierres(8) })
    expect(APARTADOS.map((a) => [a.titulo(d, HOY), a.resumen(d, HOY)])).toEqual([
      ['Quién eres', 'Taberna de Prueba Norte, S.L. · B28000016'],
      ['A qué te dedicas', 'Restaurante'],
      ['Tus impuestos', 'IVA general · cada tres meses'],
      ['Ejercicio 2026', 'Septiembre y octubre abiertos'],
      ['Socios y cargos', 'Sin poner'],
      ['Detalle contable', 'Viene puesto; lo normal es no tocarlo'],
      ['Lo que ha hecho Folvy', 'Nada todavía'],
    ])
    expect(APARTADOS[4].resumen(datos({ socios: null }), HOY)).toBe('Solo lo ve un administrador')
  })
})

describe('«Todo listo» solo si no falta nada (regla 7)', () => {
  it('con todo puesto, no falta nada', () => {
    expect(loQueFalta(datos(), HOY)).toEqual([])
  })
  it('lo que falta se dice entero, no se esconde', () => {
    const d = datos({ perfil: null, ejercicios: [], actividades: [] })
    expect(fraseFalta(loQueFalta(d, HOY))).toBe('Falta a qué te dedicas, tus impuestos y el ejercicio de 2026')
    expect(loQueFalta(datos({ empresa: { ...EMPRESA, taxId: null } }), HOY)).toEqual(['el NIF'])
  })
  it('una actividad terminada no cuenta como principal', () => {
    const d = datos({ actividades: [{ ...datos().actividades[0], endedOn: '2025-12-31', isMain: false }] })
    expect(loQueFalta(d, HOY)).toEqual(['a qué te dedicas'])
  })
  it('la razón social es obligatoria y el código postal de España son cinco cifras', () => {
    const vacio = { legalName: '', tradeName: '', legalFormCode: '', fiscalStreetType: '', fiscalStreet: '', fiscalNumber: '', fiscalExtra: '', fiscalPostalCode: '2800', fiscalCity: '', fiscalProvince: '', registryName: '', registrySheet: '' }
    expect(Object.keys(revisarQuienEres(vacio, 'ES')).sort()).toEqual(['fiscalPostalCode', 'legalName'])
    expect(revisarQuienEres({ ...vacio, legalName: 'X', fiscalPostalCode: '1000' }, 'PT')).toEqual({})
  })
})

describe('códigos reales del IAE y la CNAE', () => {
  const sql = readFileSync('supabase/migrations/20261003T0130_c00_valores_de_serie.sql', 'utf8')
  it('el ISTAC escribe «1_6779»; en la calle es «677.9» (el de la maqueta)', () => {
    expect(sql).toContain("('1_6779', '1', 'epigrafe', 'Otros servicios de alimentación propios de la restauración'")
    expect(codigoIae('1_6779')).toBe('677.9')
    expect(codigoIae('1_671')).toBe('671')
  })
  it('los títulos oficiales se limpian de guiones invisibles', () => {
    const conGuion = sql.match(/'1_6771', '1', 'epigrafe', '([^']+)'/)![1]
    expect(conGuion).toContain('­')
    expect(limpiarTitulo(conGuion)).not.toContain('­')
  })
})

describe('regla 40: lo que el servicio nombra entre comillas existe en las migraciones', () => {
  const sql = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
  const servicio = readFileSync('src/modules/conta/services/empresaDatosService.ts', 'utf8')
  it('cada tabla de tabla(…) existe', () => {
    const tablas = [...new Set([...servicio.matchAll(/tabla\('([a-z_]+)'\)/g)].map((m) => m[1]))]
    expect(tablas.length).toBeGreaterThan(8)
    for (const t of tablas) expect(sql, t).toMatch(new RegExp(`create table if not exists public\\.${t} \\(`))
  })
  it('cada RPC existe', () => {
    for (const f of [...servicio.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1])) {
      expect(sql, f).toMatch(new RegExp(`create or replace function public\\.${f}\\(`))
    }
  })
  it('cada columna que escribe existe en su tabla', () => {
    const cuerpo = (t: string) => sql.match(new RegExp(`create table if not exists public\\.${t} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? ''
    const comprobar = (t: string, cols: string[]) => { for (const c of cols) expect(cuerpo(t), `${t}.${c}`).toMatch(new RegExp(`\\b${c}\\b`)) }
    comprobar('company', ['legal_name', 'trade_name', 'legal_form_code', 'fiscal_street_type', 'fiscal_street', 'fiscal_number', 'fiscal_extra',
      'fiscal_postal_code', 'fiscal_city', 'fiscal_province', 'registry_name', 'registry_sheet', 'updated_by'])
    comprobar('company_tax_profile', ['tax_territory', 'vat_scheme_code', 'vat_cash_basis', 'vat_surcharge', 'vat_period', 'vat_prorata',
      'vat_prorata_pct', 'sii', 'chart_kind', 'account_digits', 'tax_forms', 'updated_by'])
    comprobar('company_activity', ['description', 'kind', 'iae_code', 'cnae_version', 'cnae_code', 'started_on', 'ended_on', 'is_main', 'created_by'])
    comprobar('fiscal_year', ['code', 'starts_on', 'ends_on', 'previous_year_id', 'created_by'])
    comprobar('company_person', ['full_name', 'tax_id', 'roles', 'ownership_pct', 'ended_on', 'created_by'])
    comprobar('fiscal_period_lock', ['month', 'locked_at', 'locked_by_name', 'reopened_at'])
  })
})
