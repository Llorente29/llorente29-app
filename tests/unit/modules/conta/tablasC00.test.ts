// Tablas generales del C00 (tarea 4): el registro, las vigencias y «Los que
// usas». La población es la REAL: las filas de serie que genera
// scripts/conta/serie.mjs desde las fuentes oficiales (docs/conta/referencia/
// serie.json), no ejemplos inventados (regla 31).
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TABLAS_GENERALES, agruparConceptos, definicion, leerListaEnteros, leerPorcentaje, textoPlazo, textoVigencia,
  valoresIniciales, type FilaGeneral,
} from '@/modules/conta/tablas/registro'
import { repartir, usoDeFila, type ContextoUso, type ProveedorParaUso } from '@/modules/conta/tablas/usadas'
import { codigoPropio, diaAnterior } from '@/modules/conta/services/tablasService'

const serie = JSON.parse(readFileSync('docs/conta/referencia/serie.json', 'utf8')) as {
  tablas: Record<string, { filas: Record<string, unknown>[] }>
}

const HOY = '2026-10-02'

function filasDe(tablaBd: string): FilaGeneral[] {
  return serie.tablas[tablaBd].filas.map((f, i) => ({
    id: `${tablaBd}-${i}`, tablaBd, code: String(f.code ?? f.alpha2), serie: true,
    datos: { ...f, is_system: true }, validFrom: (f.valid_from as string) ?? null, validTo: (f.valid_to as string) ?? null, ajuste: null,
  }))
}

const sinProveedores: ContextoUso = { territorio: 'peninsula_baleares', modelos: [], pais: 'ES', proveedores: [], hoy: HOY, digitos: 8 }
const prov = (p: Partial<ProveedorParaUso>): ProveedorParaUso => ({
  usualTaxRateIds: [], irpfPct: null, paymentMethod: null, paymentTermsDays: null, paymentFixedDays: [],
  expenseCategoryId: null, countryCode: 'ES', currency: 'EUR', ...p,
})

describe('el registro', () => {
  it('tiene las nueve tablas del encargo, en el orden de la maqueta', () => {
    expect(TABLAS_GENERALES.map((t) => t.titulo)).toEqual([
      'Impuestos', 'Retenciones', 'Formas de pago', 'Plazos de pago', 'Numeración de facturas',
      'Bancos y cajas', 'Tipos de gasto e ingreso', 'Textos de los apuntes', 'Países y monedas',
    ])
    expect(definicion('nada')).toBeNull()
  })

  it('cada fila de serie real vuelve igual por su formulario y pasa su validación', () => {
    for (const [tablaBd, clave] of [['tax_rate', 'impuestos'], ['withholding_rate', 'retenciones'], ['payment_method', 'formas-de-pago'], ['entry_text', 'textos-de-apuntes']] as const) {
      const def = definicion(clave)!
      for (const f of filasDe(tablaBd)) {
        const v = def.aValores(f)
        expect(def.validar(v), `${tablaBd} ${f.code}`).toEqual({})
        const base = def.aBase(v)
        for (const c of def.formulario) {
          if (c.tipo === 'opcionesBancos') continue
          const original = f.datos[c.clave]
          expect(base[c.clave] ?? null, `${tablaBd} ${f.code} ${c.clave}`).toEqual(original === undefined ? null : original)
        }
      }
    }
  })

  it('lo que pide un formulario vacío lo dice con palabras, campo a campo', () => {
    const def = definicion('impuestos')!
    const fallos = def.validar({})
    expect(fallos.name).toBe('Falta «nombre».')
    expect(fallos.rate).toBe('Falta «porcentaje».')
    expect(def.validar({ ...valoresIniciales(def, HOY), name: 'Mío', rate: '21,555' }).rate).toMatch(/dos decimales/)
    expect(definicion('bancos-y-cajas')!.validar({ kind: 'bank', name: 'Banco' }).iban).toBe('Una cuenta del banco lleva su IBAN.')
    expect(definicion('bancos-y-cajas')!.validar({ kind: 'bank', name: 'Banco', iban: 'ES00 0000' }).iban).toBeTruthy()
    expect(definicion('numeracion')!.validar({ code: 'f 1', name: 'x', doc_type: 'invoice', digits: '6', starts_at: '1' }).code).toBeTruthy()
  })

  it('lee porcentajes, listas de días y plazos como se escriben', () => {
    expect(leerPorcentaje('21')).toBe(21)
    expect(leerPorcentaje('5,2')).toBe(5.2)
    expect(leerPorcentaje('9.5 %')).toBe(9.5)
    expect(leerPorcentaje('101')).toBeNull()
    expect(leerListaEnteros('30, 60 y 90')).toEqual([30, 60, 90])
    expect(leerListaEnteros('30 días')).toBeNull()
    expect(textoPlazo([0], [])).toBe('Al contado')
    expect(textoPlazo([30, 60, 90], [])).toBe('30, 60 y 90 días')
    expect(textoPlazo([30], [5, 20])).toBe('30 días, pago los días 5 y 20 de cada mes')
  })
})

describe('las vigencias', () => {
  it('con los impuestos reales: un concepto por code; el que ya no vale se ve con su fecha de fin', () => {
    const filas = filasDe('tax_rate')
    const conceptos = agruparConceptos(filas, true, HOY)
    expect(conceptos).toHaveLength(new Set(filas.map((f) => f.code)).size)
    const basicos = conceptos.find((c) => c.fila.code === 'iva_basicos_4t2024')!
    expect(textoVigencia(basicos.fila, HOY)).toBe('Hasta 31/12/2024')
    const general = conceptos.find((c) => c.fila.code === 'iva_general')!
    expect(textoVigencia(general.fila, HOY)).toBe('Desde 01/09/2012')
  })

  it('un cambio de porcentaje es otra fila: la que vale hoy manda y la vieja va al historial', () => {
    const [general] = filasDe('tax_rate').filter((f) => f.code === 'iva_general')
    const viejo: FilaGeneral = { ...general, id: 'viejo', datos: { ...general.datos, rate: 18 }, validFrom: '2010-07-01', validTo: '2012-08-31' }
    const [c] = agruparConceptos([viejo, general], true, HOY)
    expect(c.fila.id).toBe(general.id)
    expect(c.historial.map((h) => h.id)).toEqual(['viejo'])
    expect(agruparConceptos([viejo, general], true, '2011-01-01')[0].fila.id).toBe('viejo')
  })

  it('el día anterior cruza meses y años', () => {
    expect(diaAnterior('2025-01-01')).toBe('2024-12-31')
    expect(diaAnterior('2024-03-01')).toBe('2024-02-29')
  })
})

describe('«Los que usas» (D5: ordena y etiqueta, nunca quita)', () => {
  it('con los impuestos reales y una empresa de península: usa los tres tipos que valen hoy', () => {
    const def = definicion('impuestos')!
    const conceptos = agruparConceptos(filasDe('tax_rate'), true, HOY)
    const r = repartir(def.id, conceptos, sinProveedores, () => 0)
    expect(r.usas.map((c) => c.fila.code).sort()).toEqual(['iva_general', 'iva_reducido', 'iva_superreducido'])
    expect(r.usas.length + r.demas.length).toBe(conceptos.length)
    expect(r.demas.map((c) => c.fila.code)).toContain('iva_basicos_4t2024')
    expect(r.demas.map((c) => c.fila.code)).toContain('igic_general')
  })

  it('cuenta proveedores por su IVA habitual, pero no confunde el 21 % normal con el de la UE', () => {
    // C01b: el proveedor apunta la FILA (usual_tax_rate_ids), no el porcentaje.
    const filas = filasDe('tax_rate')
    const de = (code: string) => filas.find((f) => f.code === code)!.id
    const ctx = { ...sinProveedores, proveedores: [
      prov({ usualTaxRateIds: [de('iva_general'), de('iva_reducido')] }), prov({ usualTaxRateIds: [de('iva_general')] }), prov({ usualTaxRateIds: [de('exento')] }),
    ] }
    const uso = (code: string) => usoDeFila('impuestos', filas.find((f) => f.code === code)!, ctx)
    expect(uso('iva_general')).toEqual({ usada: true, donde: '2 proveedores' })
    expect(uso('iva_reducido')).toEqual({ usada: true, donde: '1 proveedor' })
    expect(uso('exento')).toEqual({ usada: true, donde: '1 proveedor' })
    expect(uso('ue_compra').usada).toBe(false)
    expect(uso('isp').usada).toBe(false)
  })

  it('en Canarias usa el IGIC, no el IVA', () => {
    const ctx = { ...sinProveedores, territorio: 'canarias' }
    const r = repartir('impuestos', agruparConceptos(filasDe('tax_rate'), true, HOY), ctx, () => 0)
    expect(r.usas.every((c) => String(c.fila.code).startsWith('igic'))).toBe(true)
    expect(r.usas.length).toBe(7)
  })

  it('retenciones: por proveedor o por el modelo que presenta la empresa', () => {
    const filas = filasDe('withholding_rate')
    const alquiler = filas.find((f) => f.code === 'alquiler')!
    expect(usoDeFila('retenciones', alquiler, sinProveedores).usada).toBe(false)
    expect(usoDeFila('retenciones', alquiler, { ...sinProveedores, modelos: ['115'] })).toEqual({ usada: true, donde: 'Presentas el 115' })
    const prof = filas.find((f) => f.code === 'profesional')!
    expect(usoDeFila('retenciones', prof, { ...sinProveedores, proveedores: [prov({ irpfPct: 15 })] }).donde).toBe('1 proveedor')
  })

  it('una fila oculta sigue en la pantalla, en «Los demás», con su etiqueta', () => {
    const filas = filasDe('tax_rate').map((f) => (f.code === 'iva_general' ? { ...f, ajuste: { hidden: true, pgc_hint: null, pgc_input_hint: null, pgc_output_hint: null } } : f))
    const conceptos = agruparConceptos(filas, true, HOY)
    const r = repartir('impuestos', conceptos, sinProveedores, () => 0)
    const general = r.demas.find((c) => c.fila.code === 'iva_general')
    expect(general?.oculta).toBe(true)
    expect(r.usas.length + r.demas.length).toBe(conceptos.length)
  })

  it('países y monedas: el suyo y los de sus proveedores', () => {
    // Los 275 países reales, tal como los inserta la migración de valores de serie.
    const sql = readFileSync('supabase/migrations/20261003T0130_c00_valores_de_serie.sql', 'utf8')
    const bloque = sql.slice(sql.indexOf('insert into public.country'))
    const paises: FilaGeneral[] = [...bloque.slice(0, bloque.indexOf(';')).matchAll(/\('([A-Z]{2})', '([A-Z]{3})', '([^']*)'/g)]
      .map(([, a2, a3, nombre]) => ({ id: a2, tablaBd: 'country', code: a2, serie: true, datos: { alpha2: a2, alpha3: a3, name_es: nombre }, validFrom: null, validTo: null, ajuste: null }))
    expect(paises.length).toBeGreaterThan(250)
    const ctx = { ...sinProveedores, proveedores: [prov({ countryCode: 'PT' })] }
    const r = repartir('paises-y-monedas', paises.map((fila) => ({ fila, historial: [] })), ctx, () => 0)
    expect(r.usas.map((c) => c.fila.code).sort()).toEqual(['ES', 'PT'])
    expect(r.usas.length + r.demas.length).toBe(paises.length)
  })
})

describe('regla 40: lo que el registro y el servicio nombran entre comillas existe en las migraciones', () => {
  const sql = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
  const definicionDe = (t: string): string => {
    const partes: string[] = []
    const re = new RegExp(`create table if not exists public\\.${t} \\(([\\s\\S]*?)\\n\\);`, 'gi')
    for (const m of sql.matchAll(re)) partes.push(m[1])
    const alter = new RegExp(`alter table public\\.${t}\\b([\\s\\S]*?);`, 'gi')
    for (const m of sql.matchAll(alter)) partes.push(m[1])
    return partes.join('\n')
  }
  for (const def of TABLAS_GENERALES) {
    for (const t of def.tablasBd) {
      it(`${def.id}: ${t} y las columnas de su formulario`, () => {
        const cuerpo = definicionDe(t)
        expect(cuerpo, `no encuentro ${t}`).not.toBe('')
        if (t !== def.tablasBd[0]) return
        for (const c of def.formulario) expect(cuerpo, `${t}.${c.clave}`).toMatch(new RegExp(`\\b${c.clave}\\b`))
        for (const c of def.cuentasEditables) expect(cuerpo, `${t}.${c.clave}`).toMatch(new RegExp(`\\b${c.clave}\\b`))
      })
    }
  }
  it('general_row_setting acepta la clave de cada tabla con filas de serie', () => {
    const cuerpo = definicionDe('general_row_setting')
    for (const def of TABLAS_GENERALES) if (def.claveAjuste) expect(cuerpo).toContain(`'${def.claveAjuste}'`)
  })
  it('las columnas del proveedor que lee «Los que usas» existen', () => {
    const cuerpo = definicionDe('supplier')
    for (const c of ['usual_vat_rates', 'irpf_withholding_pct', 'payment_method', 'payment_terms_days', 'payment_fixed_days', 'expense_category_id', 'country_code', 'currency']) {
      expect(cuerpo, `supplier.${c}`).toMatch(new RegExp(`\\b${c}\\b`))
    }
  })
  it('el código de una fila propia es único y legible', () => {
    expect(codigoPropio('IVA del gestor', 'abc123')).toBe('propio_iva_del_gestor_abc123')
    expect(codigoPropio('¡Ñandú! 10 %', 'x')).toBe('propio_nandu_10_x')
  })
})
