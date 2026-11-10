// src/modules/conta/gestoria/portal/firma.ts
//
// GP · nº 19.1 · La prueba de una firma del portal, para la gestoría: quién la
// firmó, cuándo (hora de Madrid), desde dónde (la IP y el navegador) y a dónde
// fue el código. Lo mismo que lleva la última página del PDF firmado. Pura: la
// prueba tests/unit/modules/conta/portal/firma.test.ts.

export interface FirmaLeida {
  peticion_id: string
  firmada_at: string | null
  ip: string | null
  navegador: string | null
  destino: string
  pdf_ruta: string | null
  pdf_sha256: string | null
  quien: string | null
}

/** «Chrome en Android», «Safari en iPhone»…; si no se reconoce, nada (no se inventa). */
export function navegadorEnPalabras(ua: string | null | undefined): string | null {
  const u = ua ?? ''
  if (!u) return null
  const nav = /Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : null
  const so = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : null
  if (!nav && !so) return null
  return [nav, so].filter(Boolean).join(' en ')
}

/** «9 de noviembre de 2026 a las 10:14», en hora de Madrid. Compuesto a mano: cada ICU lo une distinto. */
function cuando(x: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(x)).map((q) => [q.type, q.value]))
  return `${p.day} de ${p.month} de ${p.year} a las ${p.hour}:${p.minute}`
}

/** «Firmado por Tomás Ruiz el 9 de noviembre de 2026 a las 10:14 desde 192.0.2.1 (Chrome en Android). Código enviado a t•••@ejemplo.invalid.» */
export function pruebaDeFirma(f: FirmaLeida): string | null {
  if (!f.firmada_at) return null
  const nav = navegadorEnPalabras(f.navegador)
  const desde = f.ip ? ` desde ${f.ip}${nav ? ` (${nav})` : ''}` : nav ? ` desde ${nav}` : ''
  return `Firmado por ${f.quien ?? 'la persona del portal'} el ${cuando(f.firmada_at)}${desde}. Código enviado a ${f.destino}.`
}
