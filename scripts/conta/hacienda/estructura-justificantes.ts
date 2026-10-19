// scripts/conta/hacienda/estructura-justificantes.ts
//
// I01c · La ESTRUCTURA de los justificantes originales del 111, el 115 y el 202
// (ver la cabecera de .github/workflows/aeat-estructura-justificantes.yml).
// Julio, 19/10: «trae de Hacienda el original de uno de cada modelo y saca solo
// la estructura: rótulos, orden y posiciones, nunca valores, CSV ni NIF».
//
// Recibe los CSV en la variable CSV_ESTRUCTURA (tres, separados por espacios).
// Por cada uno: comprueba el formato (sin forma, no se llama: la AEAT tiene un
// tope diario de intentos fallidos), hace UNA petición GET sin certificado a la
// dirección de cotejo por CSV de producción y, si llega un PDF, lo lee con el
// mismo celdasPdf del navegador y dice cómo es cada línea.
//
// Lo que sale es SOLO «@@ clave número» (salida-segura.mjs), y la clave la
// escribe este código. Cada palabra de cada línea sale como su CLASE, nunca
// como su texto:
//   · un rótulo conocido de los impresos de la AEAT, por su nombre fijo de la
//     lista ROTULOS de aquí abajo («ejercicio», «periodo», «modelo»…), con «_dp»
//     si lleva dos puntos detrás;
//   · un dato, por su forma (con «v» delante si choca con un rótulo): imp (importe con céntimos), n1…n3 (entero corto:
//     una casilla o un número de personas, sin decir cuál), n2c (dos cifras con
//     cero delante: «01»), n4 (cuatro cifras: un año), per (1T, 2P, 0A…), vnif,
//     vcsv (16 letras y cifras), ndig (10 a 22 cifras: un justificante o un NRC),
//     fec (fecha), hor (hora), mix (letras y cifras mezcladas: un expediente);
//   · cualquier otra palabra, «pal» (un nombre, una dirección o un rótulo que
//     no está en la lista: no se distingue a propósito, y su texto no sale).
// El valor de cada clave es la posición x de la palabra (o la y de la línea).
// Nada más: ni el CSV, ni el NIF, ni una cifra, ni un nombre. El PDF vive en
// memoria y se va con el proceso.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { URL_CSV_AEAT, limpiarCsv, csvValido } from '../../../supabase/functions/_shared/hacienda/justificanteCsv.ts'
import { celdasPdf, type PdfJs } from '../../../src/modules/conta/lib/celdasPdf.ts'
import { leerJustificante, lineas } from '../../../src/modules/conta/lib/justificanteAeat.ts'

const sal = (clave: string, valor: number | boolean) => console.log(`@@ ${clave} ${typeof valor === 'boolean' ? Number(valor) : Math.round(valor)}`)
const seccion = (titulo: string) => console.log(`@@ # ${titulo}`)

/**
 * Los rótulos que se nombran. Son palabras de los impresos y de la página de
 * presentación de la AEAT, en minúsculas y sin acentos: nunca un dato.
 */
const ROTULOS = new Set([
  'modelo', 'ejercicio', 'periodo', 'nif', 'presentacion', 'realizada', 'el', 'a', 'las', 'de', 'del', 'la', 'los', 'en', 'y', 'o', 'por',
  'codigo', 'seguro', 'verificacion', 'numero', 'justificante', 'expediente', 'referencia', 'registro', 'asignado', 'presentador',
  'nrc', 'importe', 'resultado', 'ingresar', 'liquidacion', 'declarante', 'identificacion', 'apellidos', 'nombre', 'razon', 'social',
  'devengo', 'casilla', 'total', 'suma', 'retenciones', 'ingresos', 'cuenta', 'rendimientos', 'trabajo', 'actividades', 'economicas',
  'dinerarios', 'especie', 'premios', 'ganancias', 'patrimoniales', 'aprovechamientos', 'forestales', 'contraprestaciones', 'cesion',
  'derechos', 'imagen', 'arrendamiento', 'inmuebles', 'urbanos', 'perceptores', 'base', 'bases', 'complementaria', 'declaracion',
  'anterior', 'fecha', 'hora', 'pago', 'pagos', 'fraccionado', 'fraccionados', 'sociedades', 'cuota', 'cuotas', 'deducir', 'deduccion',
  'impuesto', 'renta', 'personas', 'fisicas', 'no', 'residentes', 'establecimiento', 'permanente', 'trimestral', 'mensual', 'anual',
  'agencia', 'tributaria', 'aeat', 'sede', 'electronica', 'copia', 'pagina', 'domiciliacion', 'iban', 'entidad', 'colaboradora',
  'negativa', 'sin', 'actividad', 'cero', 'ingreso', 'devolucion', 'compensar', 'tipo', 'modalidad', 'porcentaje', 'periodos',
  'pendientes', 'aplicadas', 'atribuible', 'administracion', 'estado', 'regimen', 'general', 'tributacion', 'grupo', 'fiscal',
  'datos', 'adicionales', 'csv', 'fiscales', 'inicio', 'fin', 'cnae', 'importes', 'integra', 'positiva', 'previa', 'minorada',
  'bonificaciones', 'retencion', 'retenido', 'retenciones', 'efectuadas', 'practicadas', 'cuentas', 'anticipos', 'dinerarias',
  'especies', 'valoracion', 'ingresada', 'ingresado', 'autoliquidacion', 'sustitutiva', 'documento', 'electronico',
])

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** La clase de una palabra. Nunca devuelve su texto, salvo que sea un rótulo de la lista. */
export function clase(t: string): string {
  const crudo = t.trim()
  const dp = /:$/.test(crudo) ? '_dp' : ''
  const w = crudo.replace(/^[[(«"']+|[\])».,;:"']+$/g, '')
  if (!w) return 'sig'
  if (/^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/.test(w)) return 'imp'
  if (/^\d{2}[-/.]\d{2}[-/.]\d{4}$/.test(w)) return 'fec'
  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(w)) return 'hor'
  if (/^[1-4]T$|^[1-3]P$|^0A$/i.test(w)) return 'per'
  if (/^0\d$/.test(w)) return 'n2c'
  if (/^\d{1,3}$/.test(w)) return `n${w.length}`
  if (/^\d{4}$/.test(w)) return 'n4'
  if (/^\d{10,22}$/.test(w)) return 'ndig'
  if (/^([ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])$/i.test(w)) return 'vnif'
  if (/^[A-Z0-9]{16}$/i.test(w) && /[A-Z]/i.test(w) && /\d/.test(w)) return 'vcsv'
  if (/\d/.test(w) && /[A-Z]/i.test(w)) return 'mix'
  if (/^\d+$/.test(w)) return 'nlargo'
  const r = sinAcentos(w).toLowerCase()
  if (ROTULOS.has(r)) return r + dp
  return 'pal'
}

const ESPERA_MS = 30_000

async function pedir(csv: string): Promise<{ status: number; tipo: string; bytes: Uint8Array } | null> {
  // Solo para la prueba local de este script: un servidor en 127.0.0.1. Nada más.
  const local = process.env.CONSULTA_LOCAL ?? ''
  if (local && !/^http:\/\/127\.0\.0\.1:\d+\//.test(local)) return null
  try {
    const r = await fetch((local || URL_CSV_AEAT) + encodeURIComponent(csv), {
      redirect: 'manual', signal: AbortSignal.timeout(ESPERA_MS), headers: { 'User-Agent': 'Sumied/1.0 (cotejo por CSV)' },
    })
    return { status: r.status, tipo: (r.headers.get('content-type') ?? '').toLowerCase(), bytes: new Uint8Array(await r.arrayBuffer()) }
  } catch {
    return null
  }
}

async function main() {
  const csvs = String(process.env.CSV_ESTRUCTURA ?? '').split(/[\s,;]+/).map(limpiarCsv).filter(Boolean)
  sal('csv.recibidos', csvs.length)
  // Uno de cada modelo: tres, distintos y con forma. Si no, no se llama a nadie.
  if (csvs.length !== 3 || new Set(csvs).size !== 3) { sal('csv.no_son_tres_distintos', true); process.exit(1) }
  if (!csvs.every(csvValido)) { sal('csv.alguno_sin_forma', true); process.exit(1) }

  for (const [i, csv] of csvs.entries()) {
    const d = `d${i + 1}`
    seccion(d)
    const r = await pedir(csv) // UNA petición por CSV, sin reintentos ni redirecciones
    if (!r) { sal(`${d}.responde`, false); continue }
    sal(`${d}.http`, r.status)
    const esPdf = r.bytes.length > 4 && String.fromCharCode(...r.bytes.slice(0, 4)) === '%PDF'
    sal(`${d}.es_pdf`, esPdf)
    if (!esPdf) continue
    sal(`${d}.kb`, r.bytes.length / 1024)
    const paginas = await celdasPdf(pdfjs as unknown as PdfJs, r.bytes.slice().buffer as ArrayBuffer)
    const lectura = leerJustificante(paginas)
    const p = lectura.ok ? lectura.datos : lectura.parcial
    // El modelo no es un dato de nadie: 111, 115 o 202.
    if (p.modelo && /^\d{3}$/.test(p.modelo)) sal(`${d}.modelo`, Number(p.modelo))
    sal(`${d}.lee.ok`, lectura.ok)
    for (const k of ['modelo', 'ejercicio', 'periodo', 'presentada', 'csv', 'nif', 'justificante', 'expediente', 'presentador'] as const) {
      sal(`${d}.lee.${k}`, p[k] != null)
    }
    sal(`${d}.lee.casillas`, Object.keys(p.casillas ?? {}).length)
    sal(`${d}.lee.resultado`, p.resultado != null)
    sal(`${d}.paginas`, paginas.length)
    for (const [n, pg] of paginas.entries()) {
      const ls = lineas(pg)
      sal(`${d}.p${n + 1}.lineas`, ls.length)
      for (const [j, l] of ls.entries()) {
        const pre = `${d}.p${n + 1}.l${String(j + 1).padStart(2, '0')}`
        sal(`${pre}.y`, l.y)
        // Las palabras seguidas de clase «pal» se juntan en una: pal3 = tres palabras.
        let t = 0
        for (let k = 0; k < l.tokens.length; k++) {
          const c = clase(l.tokens[k].texto)
          let nombre = c
          if (c === 'pal') {
            let m = 1
            while (k + m < l.tokens.length && clase(l.tokens[k + m].texto) === 'pal') m++
            nombre = `pal${m}`
            const x = l.tokens[k].x
            k += m - 1
            sal(`${pre}.t${String(++t).padStart(2, '0')}.${nombre}`, x)
            continue
          }
          sal(`${pre}.t${String(++t).padStart(2, '0')}.${nombre}`, l.tokens[k].x)
        }
      }
    }
  }
}

await main()
