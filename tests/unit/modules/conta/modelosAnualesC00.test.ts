// Respuesta 3 del C00, punto 2: los resúmenes anuales salen de una REGLA que
// vive en la tabla de modelos, no de una lista. Contra las filas reales de la
// serie (docs/conta/referencia/serie.json) y la migración que las carga
// (regla 31): no hay ejemplos inventados.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { anadirAnuales, coherenciaModelos, modelosQuePresenta } from '@/modules/conta/lib/modelos'
import { NORMAS } from '@/modules/conta/lib/normas'
import { aReglaModelo } from '@/modules/conta/services/modelosService'

const FILAS = JSON.parse(readFileSync('docs/conta/referencia/serie.json', 'utf8')).tablas.tax_form.filas as Record<string, unknown>[]
const REGLAS = FILAS.map(aReglaModelo)
const M0190 = readFileSync('supabase/migrations/20261003T0190_c00_modelos_anuales.sql', 'utf8')
const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo)
const base = { territorio: 'peninsula_baleares' as const, actividades: ['business' as const] }

describe('la regla está en la tabla, con su norma', () => {
  it('todo periódico lleva su anual: 111→190, 115→180, 303→390, 202→200', () => {
    const pares = Object.fromEntries(REGLAS.filter((r) => r.anual).map((r) => [r.codigo, r.anual]))
    expect(pares).toEqual({ '111': '190', '115': '180', '303': '390', '202': '200' })
  })
  it('cada anual es una fila de la tabla y dice para qué es', () => {
    const hay = new Set(REGLAS.map((r) => r.codigo))
    for (const r of REGLAS.filter((x) => x.anual)) {
      expect(hay.has(r.anual!), r.anual!).toBe(true)
      expect(REGLAS.find((x) => x.codigo === r.anual)?.descripcion, r.anual!).toMatch(/^En (enero|julio|febrero) /)
    }
  })
  it('la norma de cada anual es la que está comprobada en el texto vigente (normas.ts)', () => {
    const citas: Record<string, string> = {
      '190': NORMAS.irpfResumenAnualRetenciones.cita, '180': NORMAS.irpfResumenAnualRetenciones.cita,
      '390': NORMAS.ivaDeclaracionResumenAnual.cita, '200': NORMAS.isDeclaracionAnual.cita,
    }
    for (const r of REGLAS.filter((x) => x.anual)) expect(r.normaAnual, r.codigo).toBe(citas[r.anual!])
    const t347 = REGLAS.find((r) => r.codigo === '347')!
    expect(t347.porDefecto).toBe('company_not_sii')
    expect(t347.normaPorDefecto).toContain(NORMAS.operacionesConTerceros.cita)
  })
  it('la migración 0190 pone en la base exactamente las filas de la serie', () => {
    for (const f of FILAS) {
      const q = (v: unknown) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
      const linea = `update public.tax_form set description = ${q(f.description)}, annual_form_code = ${q(f.annual_form_code)}, annual_legal_ref = ${q(f.annual_legal_ref)}, default_for = ${q(f.default_for)}, default_legal_ref = ${q(f.default_legal_ref)} where code = ${q(f.code)};`
      expect(M0190, String(f.code)).toContain(linea)
    }
  })
})

describe('los modelos de una empresa: periódicos de la regla del núcleo y anuales de la tabla', () => {
  it('Llorente29 (sociedad, nóminas y alquiler, Madrid, sin SII): lo que faltaba ya está', () => {
    const periodicos = modelosQuePresenta({ ...base, tipo: 'company', retiene: true, alquilaConRetencion: true }).modelos
    const todos = anadirAnuales(periodicos, REGLAS, { tipo: 'company', sii: false })
    expect(codigos(todos)).toEqual(['111', '115', '180', '190', '200', '202', '303', '347', '390'])
    expect(todos.find((m) => m.codigo === '190')?.porque).toBe('En enero resumes las retenciones de todo el año. (RD 439/2007 (Reglamento del IRPF), art. 108.2)')
  })
  it('con el SII, sin 347', () => {
    const periodicos = modelosQuePresenta({ ...base, tipo: 'company', retiene: true, alquilaConRetencion: false }).modelos
    expect(codigos(anadirAnuales(periodicos, REGLAS, { tipo: 'company', sii: true }))).toEqual(['111', '190', '200', '202', '303', '390'])
  })
  it('un autónomo no lleva el 347 por defecto, ni un anual que la tabla no tenga (el 130)', () => {
    const periodicos = modelosQuePresenta({ ...base, tipo: 'self_employed', retiene: false, alquilaConRetencion: false }).modelos
    expect(codigos(anadirAnuales(periodicos, REGLAS, { tipo: 'self_employed', sii: false }))).toEqual(['130', '303', '390'])
  })
  it('en Canarias: sin IVA, pero con el 200 y el 347', () => {
    const periodicos = modelosQuePresenta({ ...base, territorio: 'canarias', tipo: 'company', retiene: false, alquilaConRetencion: false }).modelos
    expect(codigos(anadirAnuales(periodicos, REGLAS, { tipo: 'company', sii: false }))).toEqual(['200', '202', '347'])
  })
})

describe('coherencia, con su norma y el caso concreto', () => {
  it('lo que le puso la IA a Llorente29 antes de la respuesta 3 no cuadra, y dice por qué', () => {
    const r = coherenciaModelos(['111', '115', '202', '303', '390'], REGLAS, { tipo: 'company', sii: false })
    expect(r.map((x) => `${x.clave} ${x.modelo}`)).toEqual(['periodico_sin_anual 111', 'periodico_sin_anual 202', 'falta_por_defecto 347', 'periodico_sin_anual 115'])
    expect(r[0].texto).toBe('Presenta el 111 y no su resumen anual, el 190.')
    expect(r[0].norma).toBe('RD 439/2007 (Reglamento del IRPF), art. 108.2')
  })
  it('un anual sin su periódico, y el 347 con el SII', () => {
    const r = coherenciaModelos(['190', '303', '390', '347', '202', '200'], REGLAS, { tipo: 'company', sii: true })
    expect(r.map((x) => `${x.clave} ${x.modelo}`)).toEqual(['anual_sin_periodico 190', 'sobra_por_defecto 347'])
  })
  it('lo que sale del alta cuadra siempre', () => {
    for (const retiene of [true, false]) for (const alquila of [true, false]) for (const sii of [true, false]) {
      const p = modelosQuePresenta({ ...base, tipo: 'company', retiene, alquilaConRetencion: alquila }).modelos
      const todos = codigos(anadirAnuales(p, REGLAS, { tipo: 'company', sii }))
      expect(coherenciaModelos(todos, REGLAS, { tipo: 'company', sii }), JSON.stringify({ retiene, alquila, sii })).toEqual([])
    }
  })
})
