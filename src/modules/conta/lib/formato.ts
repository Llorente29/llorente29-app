// src/modules/conta/lib/formato.ts
//
// Cómo se escriben los números y las fechas en las pantallas de contabilidad,
// igual que en las maquetas aprobadas: «1.283,15 €», «18.420 €», «24 oct»,
// «24/09».
//
// No se usa Intl para los importes a propósito: en es-ES, Intl NO pone el
// punto de miles en las cifras de cuatro dígitos («1283,15 €», regla de CLDR
// de agrupar a partir de 10.000), y la maqueta lo pone siempre.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']

function miles(entero: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/**
 * Importe en euros. Sin céntimos si es redondo («18.420 €»); con dos si los
 * tiene («1.283,15 €»). `null` no es cero: quien llama decide qué decir.
 */
export function euros(n: number): string {
  const negativo = n < 0
  const centimos = Math.round(Math.abs(n) * 100)
  const entero = Math.floor(centimos / 100)
  const resto = centimos % 100
  const cuerpo = resto === 0 ? miles(String(entero)) : `${miles(String(entero))},${String(resto).padStart(2, '0')}`
  return `${negativo ? '−' : ''}${cuerpo} €`
}

/** Importe siempre con dos decimales, para listas de facturas («964,40 €»). */
export function eurosExactos(n: number): string {
  const negativo = n < 0
  const centimos = Math.round(Math.abs(n) * 100)
  const entero = Math.floor(centimos / 100)
  const resto = centimos % 100
  return `${negativo ? '−' : ''}${miles(String(entero))},${String(resto).padStart(2, '0')} €`
}

/** 'YYYY-MM-DD' → «24 oct». */
export function diaMes(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MESES[m - 1]}`
}

/** 'YYYY-MM-DD' → «24/09». */
export function diaMesCorto(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}

/** 'YYYY-MM-DD' (o timestamp) → «24/09/2026». */
export function fechaLarga(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** Porcentajes de IVA: [10, 21] → «10 % y 21 %». */
export function listaPorcentajes(ps: number[]): string {
  const t = ps.map((p) => `${String(p).replace('.', ',')} %`)
  if (t.length <= 1) return t.join('')
  return `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}`
}

/** Hoy en Madrid, 'YYYY-MM-DD' (regla 4: la hora de servicio es la de Madrid). */
export function hoyEnMadrid(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(ahora)
}

/** Iniciales para el cuadrado de la cabecera: «Hermanos Ruiz» → «HR». */
export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p))
  if (palabras.length === 0) return '?'
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase()
  return (palabras[0][0] + palabras[1][0]).toUpperCase()
}
