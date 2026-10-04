// scripts/conta/lib/datosMaestros.mjs
//
// Agente de cumplimiento «Datos maestros e impuestos» (C00 §9.2): la revisión,
// como función PURA. No lee la base ni escribe nada: recibe lo que hay en la
// base (el volcado de scripts/conta/agente-datos-maestros.sql) y la referencia
// (docs/conta/referencia/serie.json, sacada de las fuentes oficiales con su
// fecha y su dirección) y devuelve lo que no cuadra, en palabras.
//
// Comprueba, de cada fila de serie:
//   1. que lleva su norma (`legal_ref`) y cuándo se comprobó (`verified_at`);
//   2. que no hay dos vigentes a la vez para el mismo concepto;
//   3. que lo que hay en la base es lo que dice la referencia, campo a campo;
//   4. que no falta ni sobra ninguna, y que los catálogos grandes tienen las
//      filas que trajo su fuente.
//
// Es .mjs y sin dependencias para que lo corra Node en GitHub Actions tal
// cual; las pruebas fijas (tests/conta/cumplimiento/datosMaestros.test.ts) lo
// importan igual.

/** Las tablas que se comparan fila a fila, con la clave de cada fila. */
export const TABLAS_FILA_A_FILA = {
  tax_rate: { clave: (f) => `${f.code}|${f.valid_from}`, nombre: 'Impuestos' },
  withholding_rate: { clave: (f) => `${f.code}|${f.valid_from}`, nombre: 'Retenciones' },
  payment_method: { clave: (f) => f.code, nombre: 'Formas de pago' },
  payment_term: { clave: (f) => f.code, nombre: 'Plazos de pago' },
  entry_text: { clave: (f) => f.code, nombre: 'Textos de apuntes' },
  expense_category: { clave: (f) => f.code, nombre: 'Tipos de gasto' },
  vat_scheme: { clave: (f) => f.code, nombre: 'Regímenes de IVA' },
  tax_form: { clave: (f) => f.code, nombre: 'Modelos de impuestos' },
  legal_form: { clave: (f) => f.code, nombre: 'Formas jurídicas' },
  vat_category_tax: { clave: (f) => `${f.category_code}|${f.tax_code}|${f.valid_from}`, nombre: 'Puente de categorías de IVA' },
}

/** Los catálogos grandes: se cuentan (sus filas salen enteras de su fuente). */
export const CATALOGOS = { country: 'Países', currency: 'Monedas', iae_heading: 'Epígrafes del IAE', cnae_code: 'Códigos CNAE-2025' }

/** Tablas con vigencia: no puede haber dos filas del mismo concepto vigentes a la vez. */
const CON_VIGENCIA = ['tax_rate', 'withholding_rate']

/** Tablas cuyas filas de serie llevan norma y fecha de comprobación en la base. */
const CON_NORMA = ['tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'entry_text', 'expense_category', 'vat_scheme', 'tax_form', 'legal_form']

/** Lo que guarda la referencia y no es un dato de la base: las pruebas del texto y notas del generador. */
const NO_SON_DATOS = new Set(['pruebas', 'desdeAuto', 'desde_por', 'fuenteOrden', 'literal', 'pgc'])

const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/** Igualdad de valores tal como salen de la base (json de psql) y de la referencia. */
export function mismo(a, b) {
  if (vacio(a) && vacio(b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [], y = Array.isArray(b) ? b : []
    return x.length === y.length && x.every((v, i) => mismo(v, y[i]))
  }
  const n = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null)
  if (n(a) !== null && n(b) !== null) return n(a) === n(b)
  return String(a) === String(b)
}

const texto = (v) => (vacio(v) ? 'nada' : Array.isArray(v) ? `[${v.join(', ')}]` : String(v))

/** Lo que la referencia espera que haya en la base para una fila. */
function esperado(tabla, f) {
  const out = {}
  for (const [k, v] of Object.entries(f)) if (!NO_SON_DATOS.has(k)) out[k] = v
  // Los tipos de gasto guardan la cuenta del PGC dentro de su norma.
  if (tabla === 'expense_category' && f.pgc) out.legal_ref = `RD 1514/2007, cuadro de cuentas, ${f.pgc}`
  return out
}

/**
 * @param {{ tablas: Record<string, object[]>, recuentos: Record<string, number> }} bd  el volcado de la base
 * @param {{ tablas: Record<string, { filas: object[] | number }> }} ref  docs/conta/referencia/serie.json
 * @param {string} hoy  AAAA-MM-DD
 * @returns {{ tabla: string, fila: string | null, tipo: string, detalle: string }[]}
 */
export function revisar(bd, ref, hoy) {
  const out = []
  const hallazgo = (tabla, fila, tipo, detalle) => out.push({ tabla, fila, tipo, detalle })

  for (const [tabla, def] of Object.entries(TABLAS_FILA_A_FILA)) {
    const filasRef = ref.tablas[tabla]?.filas
    const filasBd = bd.tablas[tabla] ?? []
    if (!Array.isArray(filasRef)) { hallazgo(tabla, null, 'sin_referencia', `${def.nombre}: la referencia no trae sus filas.`); continue }
    const enBd = new Map(filasBd.map((f) => [def.clave(f), f]))
    const enRef = new Map(filasRef.map((f) => [def.clave(f), f]))

    // 1. Norma y fecha de comprobación.
    if (CON_NORMA.includes(tabla)) {
      for (const f of filasBd) {
        if (vacio(f.legal_ref)) hallazgo(tabla, def.clave(f), 'sin_norma', `${def.nombre} · ${f.code}: no dice de qué norma sale.`)
        if (vacio(f.verified_at)) hallazgo(tabla, def.clave(f), 'sin_fecha', `${def.nombre} · ${f.code}: no dice cuándo se comprobó contra la fuente.`)
      }
    }

    // 2. Dos vigentes a la vez para el mismo concepto.
    if (CON_VIGENCIA.includes(tabla)) {
      const porConcepto = new Map()
      for (const f of filasBd) porConcepto.set(f.code, [...(porConcepto.get(f.code) ?? []), f])
      for (const [code, fs] of porConcepto) {
        const orden = [...fs].sort((a, b) => String(a.valid_from).localeCompare(String(b.valid_from)))
        for (let i = 1; i < orden.length; i++) {
          const ant = orden[i - 1], act = orden[i]
          if (vacio(ant.valid_to) || String(ant.valid_to) >= String(act.valid_from)) {
            hallazgo(tabla, code, 'solape', `${def.nombre} · ${code}: la fila desde ${ant.valid_from} y la desde ${act.valid_from} valen a la vez (la primera ${vacio(ant.valid_to) ? 'no se cierra' : `se cierra el ${ant.valid_to}`}).`)
          }
        }
        const vigentes = fs.filter((f) => String(f.valid_from) <= hoy && (vacio(f.valid_to) || String(f.valid_to) >= hoy))
        if (vigentes.length > 1) hallazgo(tabla, code, 'solape', `${def.nombre} · ${code}: hoy valen ${vigentes.length} filas a la vez.`)
      }
    }

    // 3 y 4. Lo de la base frente a la referencia.
    for (const [k, fr] of enRef) {
      const fb = enBd.get(k)
      if (!fb) { hallazgo(tabla, k, 'falta', `${def.nombre} · ${k}: está en la fuente oficial y no en la base.`); continue }
      for (const [campo, valor] of Object.entries(esperado(tabla, fr))) {
        if (!(campo in fb)) continue
        if (!mismo(fb[campo], valor)) {
          hallazgo(tabla, k, 'distinto', `${def.nombre} · ${k} · ${campo}: la base dice ${texto(fb[campo])} y la fuente, ${texto(valor)}.`)
        }
      }
    }
    for (const k of enBd.keys()) {
      if (!enRef.has(k)) hallazgo(tabla, k, 'sobra', `${def.nombre} · ${k}: está en la base como fila de serie y no sale de ninguna fuente.`)
    }
  }

  for (const [tabla, nombre] of Object.entries(CATALOGOS)) {
    const esperadas = ref.tablas[tabla]?.filas
    const hay = bd.recuentos?.[tabla]
    if (typeof esperadas !== 'number') { hallazgo(tabla, null, 'sin_referencia', `${nombre}: la referencia no dice cuántas filas trae la fuente.`); continue }
    if (hay !== esperadas) hallazgo(tabla, null, 'recuento', `${nombre}: la fuente trae ${esperadas} y en la base hay ${hay ?? 'ninguna'}.`)
  }
  return out
}

const TITULO = {
  sin_norma: 'Sin norma', sin_fecha: 'Sin fecha de comprobación', solape: 'Dos a la vez', falta: 'Falta en la base',
  sobra: 'Sobra en la base', distinto: 'No coincide con la fuente', recuento: 'Catálogo incompleto', sin_referencia: 'Sin referencia',
}

/** El informe, en lenguaje normal (Markdown). */
export function informe(hallazgos, { donde, hoy, referencia, filasMiradas }) {
  const l = [`# Datos maestros e impuestos · ${hoy}`, '']
  l.push(`Revisadas ${filasMiradas} filas de serie en ${donde}, contra \`docs/conta/referencia/serie.json\` (sacada de las fuentes oficiales descargadas el ${referencia}).`, '')
  if (hallazgos.length === 0) {
    l.push('**Todo cuadra.** Cada fila lleva su norma y su fecha de comprobación, no hay dos vigentes a la vez para el mismo concepto y los valores son los de la fuente.')
    return l.join('\n') + '\n'
  }
  l.push(`**${hallazgos.length === 1 ? 'Hay una cosa' : `Hay ${hallazgos.length} cosas`} que no cuadra${hallazgos.length === 1 ? '' : 'n'}.** No se ha cambiado nada: esto es un aviso.`, '')
  const porTipo = new Map()
  for (const h of hallazgos) porTipo.set(h.tipo, [...(porTipo.get(h.tipo) ?? []), h])
  for (const [tipo, hs] of porTipo) {
    l.push(`## ${TITULO[tipo] ?? tipo} · ${hs.length}`, '')
    for (const h of hs) l.push(`- ${h.detalle}`)
    l.push('')
  }
  return l.join('\n')
}
