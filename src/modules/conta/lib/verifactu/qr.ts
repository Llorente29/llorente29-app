// src/modules/conta/lib/verifactu/qr.ts
//
// V03 · E1 · LA URL DEL CÓDIGO «QR» DE LA FACTURA, como la describe la AEAT.
//
// Fuente: «Detalle de las especificaciones técnicas del código QR de la factura»,
// v0.5.0 (10/12/2025), §2–§6 y §10; Orden HAC/1177/2024, art. 20 y 21.
//
//   · Solo cuatro parámetros: nif, numserie, fecha (DD-MM-AAAA) e importe
//     (punto y dos decimales). Nunca «formato» en el QR.
//   · Los valores, con «URL encoding» en UTF-8 (un «&» de la serie va como %26).
//   · numserie: como mucho 60 caracteres, ASCII imprimible (32–126).
//   · Entre 30×30 y 40×40 mm, corrección de errores M, al menos 2 mm en blanco.
//   · Encima, «QR tributario:»; debajo, «VERI*FACTU» (o la frase larga).

export type EntornoAeat = 'pruebas' | 'real'

export const URL_COTEJO: Record<EntornoAeat, string> = {
  pruebas: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
  real: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
}

export const QR_MM = { minimo: 30, maximo: 40, elegido: 32, margenMinimo: 2 } as const
export const QR_CORRECCION = 'M' as const
export const QR_ENCIMA = 'QR tributario:'
export const QR_DEBAJO = 'VERI*FACTU'
export const QR_DEBAJO_LARGA = 'Factura verificable en la sede electrónica de la AEAT'

export interface DatosQr {
  nif: string
  numSerie: string
  /** DD-MM-AAAA */
  fecha: string
  /** Con punto y dos decimales, como en el registro: «241.40». */
  importe: string
}

/** Los códigos de error de validación de la URL (§10), para decirlos antes de imprimir. */
export class QrNoValido extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.codigo = codigo
    this.name = 'QrNoValido'
  }
}

const NIF = /^[0-9A-Z]{9}$/
const FECHA = /^\d{2}-\d{2}-\d{4}$/
const IMPORTE = /^-?\d{1,12}(\.\d{1,2})?$/
const IMPRIMIBLE = /^[\x20-\x7E]+$/

export function urlQr(d: DatosQr, entorno: EntornoAeat): string {
  const nif = d.nif.trim().toUpperCase()
  const serie = d.numSerie.trim()
  if (!nif) throw new QrNoValido('1001', 'Falta el NIF de quien emite la factura.')
  if (!serie) throw new QrNoValido('1002', 'Falta el número de la factura.')
  if (!d.fecha) throw new QrNoValido('1003', 'Falta la fecha de la factura.')
  if (!d.importe) throw new QrNoValido('1004', 'Falta el importe de la factura.')
  if (!NIF.test(nif)) throw new QrNoValido('2001', 'El NIF de quien emite no tiene el formato de un NIF.')
  if (serie.length > 60) throw new QrNoValido('2002', 'El número de la factura tiene más de 60 caracteres.')
  if (!IMPRIMIBLE.test(serie)) throw new QrNoValido('2003', 'El número de la factura lleva caracteres que Hacienda no admite.')
  if (!FECHA.test(d.fecha)) throw new QrNoValido('2004', 'La fecha tiene que ir como DD-MM-AAAA.')
  if (!IMPORTE.test(d.importe)) {
    const entera = d.importe.replace(/^-/, '').split('.')[0] ?? ''
    if (entera.length > 12) throw new QrNoValido('2006', 'El importe es demasiado grande para el QR.')
    throw new QrNoValido('2005', 'El importe tiene que ir con punto y dos decimales.')
  }
  const q = (s: string) => encodeURIComponent(s)
  return `${URL_COTEJO[entorno]}?nif=${q(nif)}&numserie=${q(serie)}&fecha=${q(d.fecha)}&importe=${q(d.importe)}`
}
