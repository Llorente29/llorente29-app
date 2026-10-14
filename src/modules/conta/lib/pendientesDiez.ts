// src/modules/conta/lib/pendientesDiez.ts
//
// C06b · Respuesta 7 de Julio (14/10): a Diez sin esperar a Cegid. Lo que va
// sin su PDF queda «PDF pendiente en Diez», y Libros › Pendientes de adjuntar
// en Diez dice cuántos, de cuándo es el más antiguo, cómo encontrar cada uno en
// Diez, y los baja todos en un zip con el nombre de su referencia en Diez.
// Puro: lo usan la pantalla y sus pruebas.

/** Una factura que está en Diez sin su PDF. */
export interface PendienteDiez {
  entryId: string
  /** El asiento de Folvy. */
  concepto: string
  fecha: string
  serieFolvy: number
  numeroFolvy: number | null
  /** Su sitio en Diez: ejercicio, serie y documento (asiento de Diez). */
  ejercicio: string
  serie: string
  documento: number
  /** El número de factura que lleva en Diez (UBR-…). */
  factura: string | null
  enviadoEn: string | null
  /** El PDF guardado en Folvy. */
  ruta: string
  nombrePdf: string
}

/** Cómo se busca en Diez: el asiento (serie/documento del ejercicio) y su número de factura. */
export const referenciaDiez = (p: Pick<PendienteDiez, 'ejercicio' | 'serie' | 'documento'>) => `${p.serie}/${p.documento} (${p.ejercicio})`

/** El nombre del PDF dentro del zip: su referencia en Diez, sin barras («2026-1-1801.pdf»). */
export const nombreEnZip = (p: Pick<PendienteDiez, 'ejercicio' | 'serie' | 'documento'>) =>
  `${p.ejercicio}-${String(p.serie).replace(/[^A-Za-z0-9]+/g, '_')}-${p.documento}.pdf`

/** Cuántos y de qué fecha es el más antiguo (por la fecha del asiento). */
export function resumenPendientes(xs: readonly Pick<PendienteDiez, 'fecha'>[]): { n: number; masAntiguo: string | null } {
  if (!xs.length) return { n: 0, masAntiguo: null }
  return { n: xs.length, masAntiguo: xs.map((x) => x.fecha).sort()[0] }
}

/** La frase de cabecera, con contenido (regla 8): nunca «0, sin pendientes» si hay filas. */
export function fraseResumen(xs: readonly Pick<PendienteDiez, 'fecha'>[], ddmmaa: (f: string) => string): string {
  const r = resumenPendientes(xs)
  if (!r.n) return 'Nada pendiente: todas las facturas que están en Diez tienen su PDF adjunto.'
  return `${r.n} ${r.n === 1 ? 'factura está' : 'facturas están'} en Diez sin su PDF. La más antigua, del ${ddmmaa(r.masAntiguo!)}.`
}

/** Ordenadas para trabajar: la más antigua primero (y, a igual fecha, por su documento en Diez). */
export const ordenPendientes = <T extends Pick<PendienteDiez, 'fecha' | 'documento'>>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.documento - b.documento)
