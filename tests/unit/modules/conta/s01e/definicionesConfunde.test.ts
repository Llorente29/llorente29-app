// tests/unit/modules/conta/s01e/definicionesConfunde.test.ts
//
// S01e · Lo que confundía en Ajustes y Definiciones (auditoría, PR 3):
//   · «Numeración · Aún no» en el índice con series ya creadas;
//   · el historial del plan con «supplier» y «(principal)» en inglés;
//   · el tipo de empresa en plural («Sociedades de responsabilidad limitada»);
//   · plan, tablas y analítica titulados «Ajustes» bajo «Contabilidad › Definiciones»;
//   · columnas pegadas en las tablas («600000002 proveedores», «DíasDónde lo usas»).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INDICE_AJUSTES, type EntradaAjustes } from '@/config/navegacion'
import { TITULO_DEFINICION, esDefinicion, resumenEntrada } from '@/modules/conta/ajustes/contextoAjustes'
import { formaEnSingular } from '@/modules/conta/ajustes/formaJuridica'
import { detalleEnPalabras } from '@/modules/conta/plan/detalleRegistro'
import { agruparConceptos, cuantosConceptos, definicion, resumenSeries, type FilaGeneral } from '@/modules/conta/tablas/registro'

const entrada = (id: string): EntradaAjustes => INDICE_AJUSTES.flatMap((g) => g.entradas).find((e) => e.id === id)!

describe('Numeración: el índice cuenta las series como su tabla', () => {
  const serie = (id: string): FilaGeneral => ({
    id, tablaBd: 'invoice_series', code: id, serie: false, datos: { code: id, name: id }, validFrom: null, validTo: null, ajuste: null,
  })
  it('ya no es un hueco: lleva a la tabla de Numeración de facturas', () => {
    expect(entrada('numeracion').hueco).toBeUndefined()
    expect(entrada('numeracion').ruta).toBe('ajustes/tablas/numeracion')
  })
  it('la cifra sale de la misma cuenta que el menú de las tablas', () => {
    const def = definicion('numeracion')!
    const filas = [serie('F'), serie('R')]
    expect(cuantosConceptos(def, filas, '2026-10-18')).toBe(agruparConceptos(filas, def.conVigencia, '2026-10-18').length)
    expect(resumenEntrada(entrada('numeracion'), null, null, '2026-10-18', cuantosConceptos(def, filas, '2026-10-18'))).toBe('2 series')
  })
  it('una, ninguna, y mientras no se sabe no dice nada (ni «aún no» ni «0»)', () => {
    expect(resumenSeries(1)).toBe('1 serie')
    expect(resumenSeries(0)).toBe('Ninguna serie todavía')
    expect(resumenEntrada(entrada('numeracion'), null, null, '2026-10-18', null)).toBe('')
  })
  it('lo que de verdad no tiene pantalla sigue diciendo «Aún no»', () => {
    expect(resumenEntrada(entrada('certificados'), null, null, '2026-10-18', 3)).toBe('Aún no')
  })
})

describe('El historial del plan, en español', () => {
  // La población real de company_account_log con nombres internos (tabla entera, 18/10):
  // solo «customer pasa de ninguna a N.» (6) y «supplier pasa de ninguna a N.» (2).
  it('lo que hay hoy en la base', () => {
    expect(detalleEnPalabras('customer pasa de ninguna a 43000001.')).toBe('Un cliente pasa de ninguna cuenta a 43000001.')
    expect(detalleEnPalabras('supplier pasa de ninguna a 40000002.')).toBe('Un proveedor pasa de ninguna cuenta a 40000002.')
  })
  it('lo que las funciones de la base pueden escribir', () => {
    expect(detalleEnPalabras('withholding_rate pasa de 47510000 a 47510001.')).toBe('Una retención pasa de 47510000 a 47510001.')
    expect(detalleEnPalabras('tax_rate deja de ir a 47200010 (soportado).')).toBe('Un tipo de IVA deja de ir a 47200010 (el IVA que pagas).')
    expect(detalleEnPalabras('supplier deja de ir a 40000002 (principal).')).toBe('Un proveedor deja de ir a 40000002.')
    expect(detalleEnPalabras('Se ha borrado un bank_account: deja de ir a 57200001 (principal).')).toBe('Se ha borrado un banco: deja de ir a 57200001.')
    expect(detalleEnPalabras('Se ha borrado un supplier: deja de ir a 62100001 (gasto).')).toBe('Se ha borrado un proveedor: deja de ir a 62100001 (su gasto).')
  })
  it('lo que ya está en español pasa tal cual', () => {
    for (const t of ['Ocultada 47200021 (propuesta de Folvy: sin uso).', 'Subcuenta 40000002 · Hermanos Ruiz, bajo la 4000.',
      'Plan de pymes activado con cuentas de 8 dígitos: 615 cuentas de serie, 3 subcuentas y 9 enlaces.']) {
      expect(detalleEnPalabras(t)).toBe(t)
    }
  })
})

describe('El tipo de empresa, en singular', () => {
  // Contra el catálogo de verdad: las filas que siembra la migración de legal_form.
  const sql = readFileSync('supabase/migrations/20261003T0130_c00_valores_de_serie.sql', 'utf8')
  const catalogo = [...sql.matchAll(/\('(nif_[a-z])', '([^']+)', '(company|other|self_employed)'/g)].map((m) => ({ code: m[1], nombre: m[2] }))
  it('el catálogo es el que se cree (15 claves de la Orden)', () => {
    expect(catalogo).toHaveLength(15)
  })
  it('cada clave sale en singular, nunca «Sociedades…» ni otro plural de la Orden', () => {
    for (const f of catalogo) {
      const s = formaEnSingular(f.code, f.nombre)!
      expect(s, f.code).not.toBe(f.nombre)
      expect(s, f.code).not.toMatch(/^(Sociedades|Comunidades|Asociaciones|Corporaciones|Organismos|Congregaciones|Órganos|Uniones|Otros)\b/)
    }
    expect(formaEnSingular('nif_b', 'Sociedades de responsabilidad limitada')).toBe('Sociedad de responsabilidad limitada')
  })
  it('lo que no conoce sale como venga, y sin código nada', () => {
    expect(formaEnSingular('persona_fisica', 'Persona física (autónomo)')).toBe('Persona física (autónomo)')
    expect(formaEnSingular(null)).toBeNull()
  })
})

describe('Definiciones se llama Definiciones', () => {
  it('plan, tablas y analítica, con su título; lo de Ajustes, no', () => {
    expect(TITULO_DEFINICION).toEqual({ plan: 'Plan contable', tablas: 'Tablas generales', analitica: 'Analítica' })
    for (const e of ['plan', 'tablas', 'analitica']) expect(esDefinicion(e)).toBe(true)
    for (const e of ['empresa', 'impuestos', 'folvy', 'numeracion', null]) expect(esDefinicion(e)).toBe(false)
  })
  it('las páginas no repiten el título que ya pone el marco', () => {
    for (const f of ['src/modules/conta/pages/PlanContablePage.tsx', 'src/modules/conta/pages/TablasGeneralesPage.tsx', 'src/modules/conta/pages/QueVaACadaSitioPage.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/cx-ajustes-panel-titulo">(Plan contable|Tablas generales|Qué va a cada sitio)</)
    }
    expect(readFileSync('src/modules/conta/analitica/AnaliticaPage.tsx', 'utf8')).not.toMatch(/cx-oculto">Analítica/)
  })
})

describe('Las columnas de las tablas no se pegan', () => {
  const css = readFileSync('src/modules/conta/estilo/componentes.css', 'utf8')
  const regla = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? ''
  it('filas y cabecera llevan hueco entre columnas', () => {
    for (const sel of ['.cx-rejilla-fila', '.cx-rejilla-cabeza']) expect(regla(sel), sel).toMatch(/column-gap: [1-9]\d*px/)
  })
  it('la línea de resumen del índice de Ajustes no se corta con «…»', () => {
    expect(regla('.cx-ajustes-enlace-apoyo')).not.toMatch(/ellipsis|nowrap/)
  })
})
