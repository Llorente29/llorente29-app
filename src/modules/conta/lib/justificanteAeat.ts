// src/modules/conta/lib/justificanteAeat.ts
//
// I01c · P1 · Leer un justificante de presentación de la AEAT (el PDF con texto
// que da la Sede al presentar un 303, 111, 115 o 202). Determinista: sin IA y
// sin adivinar. Recibe las celdas de texto de cada página (celdasPdf.ts, la
// misma lectura que el navegador y las pruebas).
//
// Lo que se lee y de dónde:
//   · la primera página: «Modelo NNN», «Presentación realizada el: dd-mm-aaaa a
//     las hh:mm:ss», «Código Seguro de Verificación» y «Número de justificante»;
//   · las siguientes (el impreso): el NIF del declarante, «Ejercicio», «Período»
//     y las casillas. En el impreso, cada casilla es su número y, a su derecha,
//     su importe («04 158.269,64 05 10,00 06 15.827,03»). Una casilla vacía va
//     seguida directamente de la siguiente, y no tiene importe.
//
// Los ORIGINALES que da Hacienda por su CSV del 111, el 115 y el 202 no ponen
// el valor pegado a su rótulo (estructura medida el 19/10, run 39296209103:
// clases y posiciones, sin un valor): «Ejercicio · 2026», o el valor en la línea
// de debajo; y el 115 numera sus casillas «1»…«5». Si la búsqueda de siempre no
// los encuentra, se buscan por posición (valorPorRotulo) y las casillas se leen
// por debajo de esa cabecera (filasVisuales). El 303, que sí los pone seguidos,
// va por el camino de siempre.
//
// Lo que no se lee no se rellena: falta y se dice. El resultado sale de la
// casilla del modelo (303 → [71], 111 → [30], 115 → [05]). En el 202, de la
// línea fija de la primera página «NRC: … IMPORTE: n,nn» (lo ingresado; Julio,
// 19/10), porque sus páginas del impreso pueden ser imagen, sin texto. Sin esa
// línea (sale a cero o a devolver) queda sin leer y la pantalla lo pide a mano.
// El NRC no se lee ni se guarda en ningún sitio: solo el importe de su línea.

import type { PaginaPdf } from '@/modules/conta/lib/lectorDiez'
import { eurosExactos } from '@/modules/conta/lib/formato'

export interface Justificante {
  modelo: string
  ejercicio: number
  periodo: string
  /** Fecha y hora de la presentación, en hora de Madrid: «2026-04-20T12:34:56». */
  presentada: string
  csv: string
  justificante: string | null
  /** NIF del declarante, sin espacios ni guiones. */
  nif: string
  /** «Expediente/Referencia (nº registro asignado)» de la primera página, si lo trae. */
  expediente?: string | null
  /** El presentador (la gestoría o quien lo presentó): su NIF y su nombre, si los trae. */
  presentador?: { nif: string; nombre: string } | null
  casillas: Record<string, number>
  /**
   * El resultado y de dónde sale: su casilla del impreso, o (casilla null) la
   * línea «NRC: … IMPORTE:» de la primera página, que es lo ingresado.
   */
  resultado: { casilla: string | null; importe: number } | null
}

/**
 * Por qué no se lee, para decirlo en una frase (impuestos/justificantes.ts,
 * fraseNoSeLee): no es un PDF, no tiene texto, es de un modelo que Sumied aún
 * no lee, no parece un justificante, o es de un modelo que sí lee y le falta
 * algo (datos de la presentación o las casillas).
 */
export type CausaLectura = 'no_pdf' | 'sin_texto' | 'modelo_ajeno' | 'no_es_justificante' | 'faltan_datos' | 'sin_casillas'

export type Lectura =
  | { ok: true; datos: Justificante; avisos: string[] }
  | { ok: false; motivo: string; parcial: Partial<Justificante>; causa?: CausaLectura }

/** Los modelos que se leen, con la casilla del resultado (el 202 va por rótulo). */
export const MODELOS_JUSTIFICANTE: Record<string, { nombre: string; resultado: string | null }> = {
  '303': { nombre: 'IVA', resultado: '71' },
  '111': { nombre: 'Retenciones', resultado: '30' },
  '115': { nombre: 'Alquiler', resultado: '05' },
  '202': { nombre: 'Pago a cuenta de sociedades', resultado: null },
}

/** Casillas que llevan un número entero (personas), no un importe con céntimos. */
const ENTERAS: Record<string, ReadonlySet<string>> = {
  '111': new Set(['01', '04', '07', '10', '13', '16', '19', '22', '25']),
  '115': new Set(['01']),
  // S02 · El 190: la [01] es el número de percepciones (un registro por perceptor y clave).
  '190': new Set(['01']),
  // S02 · El 180: la [01] es el número de arrendadores.
  '180': new Set(['01']),
}

/** Si una casilla cuenta personas (perceptores), no euros: «3», no «3,00 €». */
export const esCasillaDePersonas = (modelo: string, caja: string): boolean => ENTERAS[modelo]?.has(caja) ?? false

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const IMPORTE = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/
const CASILLA = /^\[?(\d{2,3})\]?$/
const CASILLA_UNA_CIFRA = /^\[?(\d{1,3})\]?$/
const PERIODO = /^([1-4]T|0[1-9]|1[0-2]|0A|[1-3]P)$/i
const NIF = /\b([ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/

/** «1.234,56» → 1234.56; «-2.134,18» → −2134.18. */
export function importeDe(t: string): number {
  return Number(t.replace(/\./g, '').replace(',', '.'))
}

interface Token { texto: string; x: number }
interface Linea { y: number; tokens: Token[]; texto: string }

/** Las celdas de una página en líneas (de arriba abajo) y cada línea en palabras (de izquierda a derecha). */
export function lineas(p: PaginaPdf): Linea[] {
  const celdas = [...p.celdas].filter((c) => c.texto.trim()).sort((a, b) => b.y - a.y || a.x - b.x)
  const out: { y: number; celdas: typeof celdas }[] = []
  for (const c of celdas) {
    const l = out.find((x) => Math.abs(x.y - c.y) <= 2.5)
    if (l) l.celdas.push(c)
    else out.push({ y: c.y, celdas: [c] })
  }
  return out
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const tokens = l.celdas.sort((a, b) => a.x - b.x)
        .flatMap((c) => c.texto.trim().split(/\s+/).map((t, i) => ({ texto: t, x: c.x + i * 0.01 })))
      return { y: l.y, tokens, texto: tokens.map((t) => t.texto).join(' ') }
    })
}

/**
 * Las casillas de las líneas del impreso: un número de 2 o 3 cifras seguido de
 * un importe es esa casilla con ese importe. Un número seguido de otro número
 * de casilla es una casilla vacía. Las de personas aceptan un entero.
 * unaCifra: el original del 115 numera sus casillas «1»…«5» (sin el cero): se
 * aceptan y se guardan como «01»…«05».
 */
export function casillasDe(ls: Linea[], modelo: string, avisos: string[], unaCifra = false): Record<string, number> {
  const enteras = ENTERAS[modelo] ?? new Set<string>()
  const out: Record<string, number> = {}
  for (const l of ls) {
    const t = l.tokens
    for (let i = 0; i < t.length - 1; i++) {
      const m = (unaCifra ? CASILLA_UNA_CIFRA : CASILLA).exec(t[i].texto)
      if (!m) continue
      const caja = m[1].padStart(2, '0')
      const sig = t[i + 1].texto
      let valor: number | null = null
      if (IMPORTE.test(sig)) valor = importeDe(sig)
      else if (enteras.has(caja) && /^\d+$/.test(sig) && !esCasillaSiguiente(caja, sig, t[i + 2]?.texto)) valor = Number(sig)
      if (valor === null) continue
      if (caja in out && out[caja] !== valor) avisos.push(`La casilla [${caja}] sale dos veces con importes distintos: se toma la primera.`)
      if (!(caja in out)) out[caja] = valor
      i++
    }
  }
  return out
}

/**
 * «10 11 12»: el 11 es la casilla de al lado (vacías las dos), no 11 personas.
 * Un entero de 2 o 3 cifras entre la casilla y la siguiente, en orden creciente,
 * es otra casilla; «01 12 02» sí son 12 personas (el 12 no va entre el 01 y el 02).
 */
function esCasillaSiguiente(caja: string, sig: string, despues: string | undefined): boolean {
  if (!CASILLA.test(sig)) return false
  const n = Number(sig)
  if (n <= Number(caja)) return false
  const d = despues ? CASILLA.exec(despues) : null
  return !despues || (d !== null && n < Number(d[1]))
}

/**
 * El valor de un rótulo del impreso por su POSICIÓN, como vienen los
 * originales del 111, el 115 y el 202 (estructura medida el 19/10, run
 * 39296209103: clases y posiciones, sin un valor, CSV ni NIF):
 *   · 115 y 202: «Ejercicio · 2026» en la misma línea, con un signo en medio;
 *   · 111: «Ejercicio · Período ·» en una línea y «2026 1T» en la de debajo,
 *     a 4 puntos, cada valor a la derecha de su rótulo.
 * Devuelve el primero que casa, con la página y la altura del rótulo.
 */
export function valorPorRotulo(paginas: Linea[][], rotulo: RegExp, valor: RegExp): { texto: string; pagina: number; y: number } | null {
  const limpio = (t: string) => t.replace(/^[[(«"']+|[\])».,;:"']+$/g, '')
  const esSigno = (t: string) => limpio(t) === '' || /^[·.…:=\-–—/]+$/.test(t)
  for (const [p, ls] of paginas.entries()) {
    for (const [i, l] of ls.entries()) {
      for (const [k, t] of l.tokens.entries()) {
        if (!rotulo.test(sinAcentos(t.texto))) continue
        let j = k + 1
        while (j < l.tokens.length && esSigno(l.tokens[j].texto)) j++
        if (j < l.tokens.length && valor.test(limpio(l.tokens[j].texto))) return { texto: limpio(l.tokens[j].texto), pagina: p, y: l.y }
        for (let d = i + 1; d < ls.length && l.y - ls[d].y <= 8; d++) {
          const c = ls[d].tokens.filter((x) => x.x >= t.x - 20 && valor.test(limpio(x.texto))).sort((a, b) => a.x - b.x)[0]
          if (c) return { texto: limpio(c.texto), pagina: p, y: l.y }
        }
      }
    }
  }
  return null
}

/** Las líneas a 4 puntos o menos de la primera de su grupo, juntas en una fila (el 115 pone el importe 3 puntos por debajo de su casilla). */
export function filasVisuales(ls: Linea[]): Linea[] {
  const out: Linea[] = []
  for (const l of ls) {
    const f = out[out.length - 1]
    if (f && f.y - l.y <= 4) {
      f.tokens = [...f.tokens, ...l.tokens].sort((a, b) => a.x - b.x)
      f.texto = f.tokens.map((t) => t.texto).join(' ')
    } else out.push({ ...l, tokens: [...l.tokens] })
  }
  return out
}

/** El resultado del 202: la última casilla con importe en la línea «A ingresar» (o «Resultado»). */
function resultadoPorRotulo(ls: Linea[], casillas: Record<string, number>): { casilla: string; importe: number } | null {
  for (const rotulo of [/a ingresar/i, /resultado/i]) {
    const l = [...ls].reverse().find((x) => rotulo.test(sinAcentos(x.texto)))
    if (!l) continue
    for (let i = l.tokens.length - 2; i >= 0; i--) {
      const m = CASILLA.exec(l.tokens[i].texto)
      if (m && m[1] in casillas && IMPORTE.test(l.tokens[i + 1].texto)) return { casilla: m[1], importe: casillas[m[1]] }
    }
  }
  return null
}

/** El importe de la línea «NRC: … IMPORTE: n,nn» de la primera página. Del NRC, nada. */
function importeNrc(primera: Linea[]): number | null {
  for (const l of primera) {
    if (!/\bNRC\b/i.test(l.texto)) continue
    const m = /IMPORTE:?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})/i.exec(l.texto)
    if (m) return importeDe(m[1])
  }
  return null
}

export function leerJustificante(paginas: readonly PaginaPdf[]): Lectura {
  const avisos: string[] = []
  const porPagina = paginas.map(lineas)
  const primera = porPagina[0] ?? []
  // Las páginas del impreso pueden ser imagen (el 202): entonces lo que haya, de la primera.
  const impresoImagen = porPagina.length > 1 && porPagina.slice(1).every((p) => p.length === 0)
  const restoPaginas = porPagina.length > 1 && !impresoImagen ? porPagina.slice(1) : [primera]
  const resto = restoPaginas.flat()
  const texto1 = sinAcentos(primera.map((l) => l.texto).join('\n'))
  const textoTodo = sinAcentos(porPagina.flat().map((l) => l.texto).join('\n'))
  const textoResto = sinAcentos(resto.map((l) => l.texto).join('\n'))

  const parcial: Partial<Justificante> = {}
  const modelo = /Modelo:?\s*(\d{3})\b/i.exec(texto1)?.[1] ?? /Modelo:?\s*(\d{3})\b/i.exec(textoTodo)?.[1]
  if (modelo) parcial.modelo = modelo
  const f = /Presentacion realizada el:?\s*(\d{2})[-/](\d{2})[-/](\d{4})\s+a\s+las\s+(\d{2}):(\d{2})(?::(\d{2}))?/i.exec(textoTodo)
  if (f) parcial.presentada = `${f[3]}-${f[2]}-${f[1]}T${f[4]}:${f[5]}:${f[6] ?? '00'}`
  const csv = /Codigo Seguro de Verificacion:?\s*([A-Z0-9]{16})\b/i.exec(textoTodo)?.[1]
  if (csv) parcial.csv = csv.toUpperCase()
  const just = /Numero(?: de)? justificante:?\s*(\d{10,16})\b/i.exec(textoTodo)?.[1]
  parcial.justificante = just ?? null
  const exp = /Expediente(?:\s*\/\s*Referencia)?(?:\s*\([^)]*\))?:?\s*([A-Z0-9][A-Z0-9-]{5,})/i.exec(texto1)?.[1]
  parcial.expediente = exp ?? null
  const pres = /Presentador:?\s*([A-Z0-9]{9})\s+([^\n]+)/i.exec(texto1)
  // En el original del 111, el 115 y el 202 el nombre va en la línea de debajo, tras su rótulo.
  parcial.presentador = pres
    ? { nif: pres[1].toUpperCase(), nombre: pres[2].replace(/^\s*Apellidos y nombre\s*(?:\/|o)?\s*Razon social:?\s*/i, '').trim().replace(/\s+/g, ' ') }
    : null
  // El NIF del declarante: del impreso, y nunca de la línea del presentador (la gestoría).
  const nif = NIF.exec(resto.map((l) => sinAcentos(l.texto)).filter((t) => !/presentador|colaborador|representante/i.test(t)).join('\n')
    .replace(/(?<=[A-Z0-9])[-.](?=[A-Z0-9])/g, ''))?.[1]
  if (nif) parcial.nif = nif
  let ej = /Ejercicio:?\s*(\d{4})\b/i.exec(textoResto)?.[1] ?? /Ejercicio:?\s*(\d{4})\b/i.exec(textoTodo)?.[1]
  let per = /Periodo:?\s*([1-4]T|0[1-9]|1[0-2]|0A|[1-3]P)\b/i.exec(textoResto)?.[1] ?? /Periodo:?\s*([1-4]T|0[1-9]|1[0-2]|0A|[1-3]P)\b/i.exec(textoTodo)?.[1]
  // Si no van seguidos (los originales del 111, el 115 y el 202), por su posición. Y entonces
  // las casillas se leen por debajo de esa cabecera (encima hay una tira de cifras).
  let cabecera: { pagina: number; y: number } | null = null
  if (!ej) {
    const v = valorPorRotulo(restoPaginas, /^ejercicio:?$/i, /^\d{4}$/)
    if (v) { ej = v.texto; cabecera = v }
  }
  if (!per) {
    const v = valorPorRotulo(restoPaginas, /^periodo:?$/i, PERIODO)
    if (v) { per = v.texto; cabecera = cabecera ?? v }
  }
  if (ej) parcial.ejercicio = Number(ej)
  if (per) parcial.periodo = per.toUpperCase()
  const nrc = importeNrc(primera)
  if (nrc !== null) parcial.resultado = { casilla: null, importe: nrc }

  const faltan: string[] = []
  if (!parcial.modelo) faltan.push('el modelo')
  else if (!(parcial.modelo in MODELOS_JUSTIFICANTE)) {
    return { ok: false, causa: 'modelo_ajeno', motivo: `Es un justificante del modelo ${parcial.modelo}, y Sumied de momento lee el 303, el 111, el 115 y el 202.`, parcial }
  }
  if (!parcial.ejercicio) faltan.push('el ejercicio')
  if (!parcial.periodo) faltan.push('el periodo')
  if (!parcial.presentada) faltan.push('la fecha de presentación')
  if (!parcial.csv) faltan.push('el Código Seguro de Verificación')
  if (!parcial.nif) faltan.push('el NIF del declarante')
  if (faltan.length) {
    const sinTexto = porPagina.every((p) => p.length === 0)
    return {
      ok: false, parcial,
      causa: sinTexto ? 'sin_texto' : !parcial.modelo ? 'no_es_justificante' : 'faltan_datos',
      motivo: sinTexto
        ? 'El PDF no tiene texto (parece escaneado o una foto): Sumied solo lee el justificante que descarga la Sede.'
        : impresoImagen
          ? `Las páginas del impreso son imagen: se lee la presentación${nrc !== null ? ' y el importe' : ''}, pero no ${faltan.join(', ').replace(/, ([^,]*)$/, ' ni $1')}. Complétalo a mano.`
          : `No se encuentra ${faltan.join(', ').replace(/, ([^,]*)$/, ' ni $1')}. ¿Es el justificante de presentación de la Sede?`,
    }
  }

  const es202 = parcial.modelo === '202'
  const debajo = cabecera
    ? restoPaginas.flatMap((p, i) => (i < cabecera!.pagina ? [] : i === cabecera!.pagina ? p.filter((l) => l.y < cabecera!.y) : p))
    : null
  const casillas = impresoImagen ? {}
    : debajo ? casillasDe(filasVisuales(debajo), parcial.modelo!, avisos, parcial.modelo === '115')
    : casillasDe(resto, parcial.modelo!, avisos)
  // El 202 se guarda con su resultado aunque el impreso sea imagen; los demás necesitan sus casillas.
  if (!Object.keys(casillas).length && !(es202 && nrc !== null)) {
    return { ok: false, causa: 'sin_casillas', parcial: { ...parcial, casillas }, motivo: 'Se lee la presentación, pero no las casillas del impreso: escríbelas a mano.' }
  }
  const cfg = MODELOS_JUSTIFICANTE[parcial.modelo!]
  const deCasilla = cfg.resultado
    ? (cfg.resultado in casillas ? { casilla: cfg.resultado, importe: casillas[cfg.resultado] } : null)
    : resultadoPorRotulo(resto, casillas)
  // En el 202 manda la línea del NRC; en los demás, la casilla, y el NRC la comprueba.
  const resultado = es202 ? (nrc !== null ? { casilla: null, importe: nrc } : deCasilla) : deCasilla ?? (nrc !== null ? { casilla: null, importe: nrc } : null)
  if (nrc !== null && deCasilla && Math.abs(deCasilla.importe - nrc) >= 0.005) {
    avisos.push(`El importe ingresado (${eurosExactos(nrc)}) no es el de la casilla [${deCasilla.casilla}] (${eurosExactos(deCasilla.importe)}): mira el justificante.`)
  }
  if (!resultado) {
    avisos.push(es202 ? 'No se encuentra el importe ingresado (la línea del NRC): si salió a cero o a devolver, escríbelo antes de guardar.'
      : `No se encuentra el resultado (casilla [${cfg.resultado}]): escríbelo antes de guardar.`)
  }
  return { ok: true, avisos, datos: { ...(parcial as Justificante), casillas, resultado } }
}

/** «IVA del trimestre · 1T 2026», «Retenciones · 2T 2026», «Pago a cuenta de sociedades · 1.er pago 2026». */
export function tituloJustificante(j: Pick<Justificante, 'modelo' | 'ejercicio' | 'periodo'>): string {
  const n = j.modelo === '303' ? (/^\d{2}$/.test(j.periodo) ? 'IVA del mes' : 'IVA del trimestre') : MODELOS_JUSTIFICANTE[j.modelo]?.nombre ?? `Modelo ${j.modelo}`
  const p = /^[1-3]P$/.test(j.periodo) ? `${j.periodo[0]}.${j.periodo[0] === '2' ? 'º' : 'er'} pago` : j.periodo
  return `${n} · ${p} ${j.ejercicio}`
}

/**
 * El CSV de un PDF, también de un justificante REIMPRESO («Microsoft Print to
 * PDF»: el impreso queda como dibujo y como texto solo los valores, pero el CSV
 * se conserva). Primero, el del rótulo «Código Seguro de Verificación»; si no
 * hay rótulo, los códigos de 16 letras y cifras (con alguna de cada), y el que
 * más se repite: el CSV va en la primera página y al pie de cada página del
 * impreso. Si empatan varios, se devuelven todos y se elige a mano.
 */
export function csvDelPdf(paginas: readonly PaginaPdf[]): { csv: string | null; candidatos: string[] } {
  const ls = paginas.flatMap(lineas)
  const todo = sinAcentos(ls.map((l) => l.texto).join('\n'))
  const rotulado = /Codigo Seguro de Verificacion:?\s*([A-Z0-9]{16})\b/i.exec(todo)?.[1]
  if (rotulado) return { csv: rotulado.toUpperCase(), candidatos: [rotulado.toUpperCase()] }
  const cuenta = new Map<string, number>()
  for (const t of todo.split(/[\s:;,()]+/)) {
    const u = t.toUpperCase()
    if (/^[A-Z0-9]{16}$/.test(u) && /[A-Z]/.test(u) && /\d/.test(u)) cuenta.set(u, (cuenta.get(u) ?? 0) + 1)
  }
  if (!cuenta.size) return { csv: null, candidatos: [] }
  const max = Math.max(...cuenta.values())
  const mejores = [...cuenta].filter(([, n]) => n === max).map(([k]) => k).sort()
  return { csv: mejores.length === 1 ? mejores[0] : null, candidatos: mejores }
}

/** Un CSV de Hacienda: 16 letras y cifras. Se limpia antes de comprobarlo (espacios, minúsculas). */
export function limpiarCsv(t: string): string {
  return t.replace(/[\s-]/g, '').toUpperCase()
}
export const csvValido = (t: string): boolean => /^[A-Z0-9]{16}$/.test(limpiarCsv(t))
