// src/lib/fechas.ts
//
// EL DÍA DEL NEGOCIO. Todo lo que hay en la base está en UTC (`sold_at`,
// `set_at`…) y todo lo que se enseña se lee en hora de Madrid. Convertir es la
// regla 4 del proyecto, y estaba escrita suelta en cada sitio que la necesitaba.
//
// LA CONSTANTE DEL HUSO VIVE AQUÍ Y EN NINGÚN OTRO SITIO. Hoy es Madrid fijo;
// la fuente correcta es `accounts.timezone`, que ya existe y ya usa
// `sales_dashboard`. Está en un solo fichero a propósito: el día que haya un
// cliente fuera de España eso es un cambio, no una búsqueda. Frente 5 en
// claude/folvy_frentes_abiertos.md.
//
// ── POR QUÉ NO VALE EL ATAJO EVIDENTE ──────────────────────────────────────
// `new Date('2026-09-01')` se interpreta como UTC y en Madrid retrocede al día
// anterior. Y `new Date(2026, 8, 1)` da la medianoche del NAVEGADOR, que en un
// portátil fuera de España no es la medianoche del negocio. Las dos formas
// fáciles están mal, y las dos fallan en silencio: devuelven una fecha
// perfectamente válida que es de otro día.

export const ZONA_NEGOCIO = 'Europe/Madrid'

const DIA_MS = 86_400_000

/** El día del calendario del negocio, como 'YYYY-MM-DD'. */
export function diaNatural(d: Date): string {
  // 'sv-SE' da exactamente 'YYYY-MM-DD', que es lo que hace falta para restar.
  return d.toLocaleDateString('sv-SE', { timeZone: ZONA_NEGOCIO })
}

/** 'YYYY-MM-DD' → el mediodía UTC de ese día. Se restan DÍAS, no instantes. */
function aMedioDiaUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 12)
}

/**
 * Días naturales completos entre dos instantes, contados en el día del negocio.
 *
 * Se restan los días reinterpretados a MEDIODÍA UTC para que los cambios de
 * hora no metan ni quiten uno: entre dos mediodías hay siempre 24 h justas,
 * entre dos medianoches no —la noche del cambio tiene 23 o 25—.
 */
export function diasNaturalesEntre(desde: Date, hasta: Date): number {
  return Math.round((aMedioDiaUtc(diaNatural(hasta)) - aMedioDiaUtc(diaNatural(desde))) / DIA_MS)
}

/**
 * Desfase del huso del negocio respecto a UTC, en ms, EN ESE INSTANTE.
 * Se calcula formateando el instante en la zona y releyéndolo como si fuera
 * UTC: la diferencia con el original es el desfase. No hace falta librería.
 */
function desfase(instante: number): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_NEGOCIO, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instante))
  const p: Record<string, string> = {}
  for (const x of partes) p[x.type] = x.value
  const comoSiFueraUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  )
  return comoSiFueraUtc - instante
}

/** El instante UTC de la medianoche del negocio de un 'YYYY-MM-DD'. */
function medianocheDelNegocio(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const comoSiUtc = Date.UTC(y, m - 1, d, 0, 0, 0)
  // Primera aproximación con el desfase de ese día…
  const primera = comoSiUtc - desfase(comoSiUtc)
  // …y segunda pasada, porque el desfase pudo cambiar justo esa madrugada (la
  // noche del cambio de hora es exactamente el caso que rompe la primera).
  return new Date(comoSiUtc - desfase(primera))
}

/** El día natural del negocio que contiene `d`, como rango [desde, hasta). */
export function diaDelNegocio(d: Date): { desde: Date; hasta: Date; ymd: string } {
  const ymd = diaNatural(d)
  const desde = medianocheDelNegocio(ymd)
  // El día SIGUIENTE, no «+24 h»: la noche del cambio de hora dura 23 o 25.
  const siguiente = diaNatural(new Date(desde.getTime() + 36 * 3600_000))
  return { desde, hasta: medianocheDelNegocio(siguiente), ymd }
}

/** El mismo día de la semana anterior, como rango del negocio. */
export function diaEspejo(d: Date): { desde: Date; hasta: Date; ymd: string } {
  return diaDelNegocio(new Date(d.getTime() - 7 * DIA_MS))
}

/** El día natural anterior al de `d`. */
export function diaAnterior(d: Date): { desde: Date; hasta: Date; ymd: string } {
  return diaDelNegocio(new Date(diaDelNegocio(d).desde.getTime() - 12 * 3600_000))
}

/** El lunes de la semana del negocio que contiene `d`, como 'YYYY-MM-DD'. */
export function lunesDeLaSemana(d: Date): string {
  const ymd = diaNatural(d)
  const [y, m, dd] = ymd.split('-').map(Number)
  // Se opera sobre un UTC "plano" construido con las partes del día del
  // negocio: así el día de la semana es el de Madrid, no el del navegador.
  const plano = new Date(Date.UTC(y, m - 1, dd))
  const dow = plano.getUTCDay()            // 0 domingo … 6 sábado
  const alLunes = dow === 0 ? 6 : dow - 1  // el domingo pertenece a la semana que acaba
  plano.setUTCDate(plano.getUTCDate() - alLunes)
  return plano.toISOString().slice(0, 10)
}

/** Semanas enteras entre dos lunes 'YYYY-MM-DD'. */
export function semanasEntre(lunesA: string, lunesB: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((t(lunesB) - t(lunesA)) / (7 * 86_400_000))
}
