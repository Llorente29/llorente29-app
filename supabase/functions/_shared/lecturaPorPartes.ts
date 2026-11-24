// supabase/functions/_shared/lecturaPorPartes.ts
//
// E10 (23/11) · LA FACTURA LARGA SE LEE ENTERA. ocr-albaran pide todo —cabecera y
// cada línea con su lote— en una sola respuesta de 8.192 como mucho. Una factura con
// muchas líneas (la mensual de un proveedor de carne: ~20 albaranes, ~34 líneas con
// lote y caducidad) no cabe y llega cortada (stop_reason «max_tokens»).
//
// Cuando llega cortada, y solo entonces, se lee en dos pasos:
//   1. La CABECERA, siempre corta: el prompt de siempre con «lines» vacío (proveedor,
//      NIF, destinatario, número, fechas, forma de pago, IBAN, bases, cuotas, recargo,
//      retención y total). Con eso la factura entra en Recibidas, se valida y va al
//      303 y al 347: lo que necesita la contabilidad no depende de las líneas.
//   2. Las LÍNEAS, página a página: cada trozo es una página (un PDF partido) o un
//      fichero (varias fotos), y pide solo las líneas de ese trozo con la misma forma
//      de línea de siempre. Se juntan en orden; una línea partida entre dos páginas
//      queda una sola. Si un trozo falla, faltan sus líneas y se dice cuántas.
// Lo que hoy se lee bien no pasa por aquí (Julio, regla 31: mismo cuerpo, misma sesión).
//
// Núcleo puro: sin red, sin base, sin Deno ni Node. La llamada al modelo se pasa
// (`llamar`), para que ocr-albaran y la lectura de prueba usen lo mismo.

import { buildPrompt, extractJson, type ParsedDoc } from './ocrAlbaranNucleo.ts'
import { PROMPT_FACTURA } from './lecturaFactura.ts'

export type LineaLeida = ParsedDoc['lines'][number] & { continues_previous?: boolean | null }

/** Lo que devuelve una llamada al modelo: el JSON leído, la respuesta entera, o el fallo. */
export type Respuesta = { parsed: ParsedDoc | null; raw: unknown } | { error: string; status: number }
export type Llamar = (bloques: unknown[], prompt: string) => Promise<Respuesta>

/** ¿Llegó cortada? La única señal: el modelo paró por el tope de la respuesta. */
export function esCortada(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { stop_reason?: unknown }).stop_reason === 'max_tokens'
}

// ── Los prompts ─────────────────────────────────────────────────────────────

/** Paso 1: lo de siempre (modo factura) con «lines» vacío, y cuántas líneas trae. */
export const PROMPT_SOLO_CABECERA =
  `\n\nESTA VEZ, SOLO LA CABECERA: el documento es largo. Deja "lines" VACÍO ([]) y no escribas ninguna línea.\n` +
  `Rellena todo lo demás igual que siempre ("document", "factura" con su "tax_breakdown" del pie y "confidence"), y\n` +
  `añade al MISMO objeto JSON dos claves: "lines_expected": <cuántas líneas de artículo trae el documento entero,\n` +
  `contando las de todos los albaranes, o null si no lo sabes> y "pages": <cuántas páginas tiene, o null>.`

export function promptCabecera(): string {
  return buildPrompt() + PROMPT_FACTURA + PROMPT_SOLO_CABECERA
}

/** Paso 2: las líneas de un trozo, con la misma forma de línea de siempre. */
export function promptLineas(t: Trozo, paginas: number | null): string {
  const que = t.desde === t.hasta ? `la página ${t.desde}` : `las páginas ${t.desde} a ${t.hasta}`
  return (
    buildPrompt() +
    `\n\nESTA VEZ, SOLO LAS LÍNEAS DE UN TROZO: te paso ${que}${paginas ? ` de un documento de ${paginas}` : ''}.\n` +
    `Responde ÚNICAMENTE {"lines": [ ... ]} con las líneas de artículo que aparecen en ESTE trozo, en el orden del papel,\n` +
    `cada una con la forma EXACTA de "lines" de arriba. No escribas "document" ni "confidence".\n` +
    `- Las líneas de TODOS los albaranes que haya en el trozo, una por cada artículo; las cabeceras de albarán, los\n` +
    `  subtotales y el cuadro de impuestos NO son líneas.\n` +
    `- Si arriba del trozo hay un RESTO de una línea que empezó en la página anterior (solo su lote o su caducidad,\n` +
    `  sin artículo ni importe), devuélvelo como primera línea con lo que veas y "continues_previous": true.\n` +
    `  Que un ALBARÁN siga de la página anterior NO es eso: sus líneas enteras van normales, sin esa clave.\n` +
    `- Si el trozo no trae ninguna línea de artículo, devuelve {"lines": []}.`
  )
}

// ── Los trozos ──────────────────────────────────────────────────────────────

/** Un trozo: unas páginas (de 1 en adelante) y lo que se le pasa al modelo. */
export type Trozo = { desde: number; hasta: number }

/** Lo leído de un trozo: sus líneas, o null si falló (no contestó, llegó cortado o sin JSON). */
export type TrozoLeido = Trozo & { lineas: LineaLeida[] | null; porque?: string | null }

const vacio = (v: unknown) => v === null || v === undefined || v === ''
/** Une dos lecturas de la misma línea: lo que una no trae lo pone la otra. */
export function unir(a: LineaLeida, b: LineaLeida): LineaLeida {
  const r = { ...a } as Record<string, unknown>
  for (const [k, v] of Object.entries(b)) if (k !== 'continues_previous' && vacio(r[k]) && !vacio(v)) r[k] = v
  delete r.continues_previous
  return r as LineaLeida
}

/**
 * Junta los trozos en el orden de sus páginas. Una línea partida entre dos páginas (el
 * trozo de la segunda viene marcado «continues_previous») queda una sola, con lo de las
 * dos. Solo por esa marca: dos líneas iguales de dos albaranes seguidos (el mismo
 * artículo, la misma cantidad) son dos líneas, aunque caigan en el borde de una página.
 */
export function juntarTrozos(trozos: readonly TrozoLeido[]): { lineas: LineaLeida[]; fallidos: Trozo[] } {
  const lineas: LineaLeida[] = []
  const fallidos: Trozo[] = []
  let anteriorLeido = false
  for (const t of [...trozos].sort((a, b) => a.desde - b.desde)) {
    if (!t.lineas) { fallidos.push({ desde: t.desde, hasta: t.hasta }); anteriorLeido = false; continue }
    t.lineas.forEach((l, i) => {
      const ultima = lineas[lineas.length - 1]
      // Solo un TROZO de línea (sin su importe o sin su texto) se junta con la anterior. Una línea entera
      // marcada «continues_previous» (el modelo lo pone cuando sigue el ALBARÁN de la página anterior) es
      // su propia línea: juntarla la perdería.
      const trozo = l.continues_previous === true && (vacio(l.line_amount) || vacio(l.raw_text))
      if (i === 0 && anteriorLeido && ultima && trozo) {
        lineas[lineas.length - 1] = unir(ultima, l)
        return
      }
      if (i === 0 && trozo && vacio(l.raw_text) && vacio(l.line_amount)) return // un resto sin su línea (la anterior no se leyó)
      const limpia = { ...l }
      delete limpia.continues_previous
      lineas.push(limpia)
    })
    anteriorLeido = true
  }
  return { lineas, fallidos }
}

// ── La suma de las líneas contra las bases ──────────────────────────────────

const cent = (n: number) => Math.round(n * 100)

/** Σ líneas contra la base de la cabecera, al céntimo. Null si no hay con qué. */
export function cuadreLineas(lineas: readonly LineaLeida[], base: number | null): { suman: number; base: number; cuadra: boolean } | null {
  const con = lineas.filter((l) => typeof l.line_amount === 'number' && Number.isFinite(l.line_amount))
  if (base === null || !Number.isFinite(base) || con.length === 0) return null
  const suman = con.reduce((s, l) => s + cent(l.line_amount as number), 0)
  return { suman: suman / 100, base, cuadra: suman === cent(base) }
}

/** La base de la cabecera: la suma de las bases del cuadro de impuestos o, sin él, tax_base_total. */
export function baseDeLaCabecera(p: { document?: { tax_base_total?: number | null } | null; factura?: { tax_breakdown?: { base: number | null }[] | null } | null } | null): number | null {
  const tipos = (p?.factura?.tax_breakdown ?? []).filter((t) => typeof t.base === 'number')
  if (tipos.length) return tipos.reduce((s, t) => s + cent(t.base as number), 0) / 100
  const b = p?.document?.tax_base_total
  return typeof b === 'number' && Number.isFinite(b) ? b : null
}

// ── El estado de las líneas, como se guarda en la sesión (validation.lineas) ──

export type EstadoLineas = {
  /** «leyendo»: la cabecera ya está y las líneas aún no; «completas»; «faltan»: algún trozo no se ha leído. */
  estado: 'leyendo' | 'completas' | 'faltan'
  leidas: number
  /** Las que dice la cabecera que trae (puede no saberlo). */
  esperadas: number | null
  paginas: number | null
  /** Las páginas que no se han podido leer (para «Leer las que faltan»). */
  sin_leer: number[]
  /** Cuántas líneas salieron de cada página leída, en orden (para juntar al leer las que faltan). */
  por_pagina: { pagina: number; lineas: number }[]
  cuadre: { suman: number; base: number; cuadra: boolean } | null
  /** Cuándo empezó a leerlas (una que se queda «leyendo» mucho rato, faltan). */
  desde: string
  /** E10b · No se han leído porque la empresa no recibe la mercancía con Folvy (las líneas son de Folvy). */
  sin_folvy?: boolean
}

/**
 * E10b · ¿Se leen las líneas de una factura larga? Solo si su empresa recibe la mercancía con Folvy
 * (company_purchase_setting.receives_goods, lo mismo que dice conta_recibe_mercancia): las líneas de
 * artículo, con su lote y su caducidad, son de Folvy (compras, inventario, coste). A Sumied le basta la
 * cabecera. Sin empresa o sin el ajuste, no (como conta_recibe_mercancia: sin fila, no).
 */
export function seLeenLasLineas(recibeMercancia: boolean | null | undefined): boolean {
  return recibeMercancia === true
}

/** E10b · Lo que se guarda cuando no se leen: sin leer ninguna, por no usar Folvy; «Leer las que faltan» las lee todas. */
export function lineasSinLeer(x: { esperadas: number | null; paginas: number | null; desde: string }): EstadoLineas {
  return { estado: 'faltan', leidas: 0, esperadas: x.esperadas, paginas: x.paginas, sin_leer: [], por_pagina: [], cuadre: null, desde: x.desde, sin_folvy: true }
}

export function estadoLineas(x: { trozos: readonly TrozoLeido[]; esperadas: number | null; paginas: number | null; base: number | null; desde: string }): { lineas: LineaLeida[]; estado: EstadoLineas } {
  const { lineas, fallidos } = juntarTrozos(x.trozos)
  const sinLeer = fallidos.flatMap((t) => Array.from({ length: t.hasta - t.desde + 1 }, (_, i) => t.desde + i))
  // Cuántas quedan de cada página: se cuentan tras juntar (la partida es de la página donde empieza).
  const porPagina: EstadoLineas['por_pagina'] = []
  const ordenados = [...x.trozos].filter((t) => t.lineas).sort((a, b) => a.desde - b.desde)
  let usadas = 0
  for (const t of ordenados) {
    const parcial = juntarTrozos(x.trozos.filter((u) => u.lineas && u.desde <= t.desde)).lineas.length
    porPagina.push({ pagina: t.desde, lineas: parcial - usadas })
    usadas = parcial
  }
  // Faltan si una página no se ha leído, o si hay menos de las que dice la cabecera Y la suma no da
  // la base: con la suma al céntimo, un recuento de la cabecera que no coincide es del recuento.
  const cuadre = cuadreLineas(lineas, x.base)
  const faltan = sinLeer.length > 0 || (x.esperadas !== null && lineas.length < x.esperadas && !cuadre?.cuadra)
  return {
    lineas,
    estado: {
      estado: faltan ? 'faltan' : 'completas',
      leidas: lineas.length,
      esperadas: x.esperadas,
      paginas: x.paginas,
      sin_leer: sinLeer,
      por_pagina: porPagina,
      cuadre,
      desde: x.desde,
    },
  }
}

/** Una lectura que lleva «leyendo» más de esto se da por parada: faltan sus líneas. */
export const LEYENDO_COMO_MUCHO_MS = 10 * 60 * 1000

/** Lo que se ve de las líneas, con el reloj: «leyendo» que se ha quedado parada cuenta como «faltan». */
export function estadoVisto(e: EstadoLineas | null | undefined, ahora = Date.now()): EstadoLineas | null {
  if (!e) return null
  if (e.estado === 'leyendo' && ahora - Date.parse(e.desde) > LEYENDO_COMO_MUCHO_MS) return { ...e, estado: 'faltan' }
  return e
}

// ── El orquestador ──────────────────────────────────────────────────────────

/** Paso 1: la cabecera. Devuelve lo leído sin líneas, cuántas trae y cuántas páginas, o el fallo. */
export async function leerCabecera(llamar: Llamar, bloques: unknown[]): Promise<{ parsed: ParsedDoc | null; raw: unknown; esperadas: number | null; paginas: number | null } | { error: string; status: number }> {
  const r = await llamar(bloques, promptCabecera())
  if ('error' in r) return r
  const p = r.parsed as (ParsedDoc & { lines_expected?: unknown; pages?: unknown }) | null
  const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)
  const esperadas = n(p?.lines_expected)
  const paginas = n(p?.pages)
  if (p) { delete p.lines_expected; delete p.pages; p.lines = [] }
  return { parsed: p, raw: r.raw, esperadas, paginas }
}

/** Paso 2: las líneas de cada trozo (como mucho `aLaVez` llamadas a la vez). */
export async function leerTrozos(llamar: Llamar, trozos: readonly (Trozo & { bloques: unknown[] })[], paginas: number | null, aLaVez = 3): Promise<TrozoLeido[]> {
  const out: TrozoLeido[] = new Array(trozos.length)
  let siguiente = 0
  const uno = async () => {
    while (siguiente < trozos.length) {
      const i = siguiente++
      const t = trozos[i]
      let lineas: LineaLeida[] | null = null
      let porque: string | null = null
      try {
        const r = await llamar(t.bloques, promptLineas(t, paginas))
        if ('error' in r) porque = `http ${r.status}`
        else if (esCortada(r.raw)) porque = 'cortada'
        else if (!r.parsed || !Array.isArray((r.parsed as { lines?: unknown }).lines)) porque = 'sin líneas'
        else lineas = (r.parsed as { lines: LineaLeida[] }).lines
      } catch (e) {
        porque = String(e).slice(0, 120)
      }
      out[i] = { desde: t.desde, hasta: t.hasta, lineas, porque }
    }
  }
  await Promise.all(Array.from({ length: Math.min(aLaVez, trozos.length) }, uno))
  return out
}

/**
 * «Leer las que faltan»: lo que ya había, repartido por páginas con `por_pagina`, más
 * lo leído ahora de las páginas que faltaban. Devuelve los trozos para juntar.
 */
export function trozosDeLoQueHabia(lineas: readonly LineaLeida[], porPagina: readonly { pagina: number; lineas: number }[]): TrozoLeido[] {
  const out: TrozoLeido[] = []
  let i = 0
  for (const p of porPagina) {
    out.push({ desde: p.pagina, hasta: p.pagina, lineas: lineas.slice(i, i + p.lineas) })
    i += p.lineas
  }
  return out
}

export { extractJson }

// ── Los trozos de los ficheros ──────────────────────────────────────────────

/** Un fichero de la lectura: sus bytes y su tipo. */
export type Fichero = { bytes: Uint8Array; mime: string }

/**
 * Los trozos de una lectura, una página cada uno: cada PDF se parte en sus páginas
 * (`partirPdf`) y cada foto es una página; se numeran seguidas. Con `solo`, solo esas
 * páginas (las que faltan). Devuelve los trozos con su bloque para el modelo y cuántas
 * páginas hay en total.
 */
export async function trozosDeLosFicheros(ficheros: readonly Fichero[], partirPdf: (b: Uint8Array) => Promise<Uint8Array[]>, aB64: (b: Uint8Array) => string, solo?: readonly number[] | null):
  Promise<{ trozos: (Trozo & { bloques: unknown[] })[]; paginas: number }> {
  const trozos: (Trozo & { bloques: unknown[] })[] = []
  let n = 0
  for (const f of ficheros) {
    const esPdf = f.mime === 'application/pdf'
    const partes = esPdf ? await partirPdf(f.bytes) : [f.bytes]
    for (const p of partes) {
      n++
      if (solo && !solo.includes(n)) continue
      const bloque = esPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: aB64(p) } }
        : { type: 'image', source: { type: 'base64', media_type: f.mime, data: aB64(p) } }
      trozos.push({ desde: n, hasta: n, bloques: [bloque] })
    }
  }
  return { trozos, paginas: n }
}

/**
 * Paso 2 entero: parte, lee cada trozo y junta (con lo que ya había, si es «Leer las que
 * faltan»). Devuelve las líneas y su estado para guardar en la sesión.
 */
export async function leerLasLineas(x: {
  llamar: Llamar
  ficheros: readonly Fichero[]
  partirPdf: (b: Uint8Array) => Promise<Uint8Array[]>
  aB64: (b: Uint8Array) => string
  esperadas: number | null
  base: number | null
  desde: string
  /** «Leer las que faltan»: las páginas que faltaban y lo que ya se había leído. */
  faltan?: { paginas: readonly number[]; lineas: readonly LineaLeida[]; porPagina: readonly { pagina: number; lineas: number }[] } | null
  aLaVez?: number
}): Promise<{ lineas: LineaLeida[]; estado: EstadoLineas }> {
  const { trozos, paginas } = await trozosDeLosFicheros(x.ficheros, x.partirPdf, x.aB64, x.faltan?.paginas ?? null)
  const leidos = await leerTrozos(x.llamar, trozos, paginas, x.aLaVez ?? 3)
  const previos = x.faltan ? trozosDeLoQueHabia(x.faltan.lineas, x.faltan.porPagina) : []
  return estadoLineas({ trozos: [...previos, ...leidos], esperadas: x.esperadas, paginas, base: x.base, desde: x.desde })
}
