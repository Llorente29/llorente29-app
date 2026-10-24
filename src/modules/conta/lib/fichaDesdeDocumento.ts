// src/modules/conta/lib/fichaDesdeDocumento.ts
//
// D07b · La ficha del proveedor, completada desde el documento (Julio, 23/10).
// Si a la ficha le falta el NIF, la dirección o el nombre fiscal y el documento
// escaneado los trae, se proponen y se guardan al validar. Si el documento
// CONTRADICE la ficha, se avisa y no se cambia nada. Núcleo puro.

import { casaNif } from '@/modules/conta/documentos/paraValidar'
import { claveNombre } from '@/modules/conta/lib/importarPlan'

export interface FichaFiscal { nif: string | null; nombreFiscal: string | null; calle: string | null; codigoPostal: string | null; ciudad: string | null }
export interface LeidoDelDocumento { nif: string | null; nombre: string | null; direccion: string | null }

export interface CompletarFicha {
  /** Lo que se guardará en la ficha al validar (solo lo que le falta). */
  proponer: { taxId?: string; legalName?: string; fiscalStreet?: string; fiscalPostalCode?: string; fiscalCity?: string }
  /** Lo que se propone, dicho para la persona. */
  frases: string[]
  /** Lo que el documento dice distinto de la ficha: se avisa, no se cambia. */
  contradice: string[]
}

const limpio = (x: string | null | undefined): string | null => {
  const t = (x ?? '').replace(/\s+/g, ' ').trim()
  return t ? t : null
}

/** «Calle Mayor 3, 28013 Madrid» → calle, código postal y ciudad (lo que se pueda; el resto, null). */
export function partirDireccion(direccion: string | null): { calle: string | null; codigoPostal: string | null; ciudad: string | null } {
  const d = limpio(direccion)
  if (!d) return { calle: null, codigoPostal: null, ciudad: null }
  const m = d.match(/^(.*?)[,\s-]*\b((?:0[1-9]|[1-4]\d|5[0-2])\d{3})\b[,\s-]*(.*)$/)
  if (!m) return { calle: d, codigoPostal: null, ciudad: null }
  const calle = limpio(m[1]?.replace(/[,\s-]+$/, ''))
  // La ciudad: hasta la primera coma, sin la provincia entre paréntesis ni un guion suelto;
  // y si sale repetida («MADRID MADRID», la ciudad y la provincia), una vez.
  let ciudad = limpio(m[3]?.replace(/\(.*?\)/g, '').split(',')[0]?.replace(/[\s-]+$/, ''))
  const pal = ciudad?.split(' ') ?? []
  if (pal.length % 2 === 0 && pal.length > 0 && pal.slice(0, pal.length / 2).join(' ').toUpperCase() === pal.slice(pal.length / 2).join(' ').toUpperCase()) ciudad = pal.slice(0, pal.length / 2).join(' ')
  return { calle, codigoPostal: m[2], ciudad }
}

export function completarFicha(ficha: FichaFiscal, leido: LeidoDelDocumento): CompletarFicha {
  const r: CompletarFicha = { proponer: {}, frases: [], contradice: [] }
  const nif = limpio(leido.nif)?.toUpperCase().replace(/[\s.-]/g, '') ?? null
  if (nif) {
    if (!limpio(ficha.nif)) { r.proponer.taxId = nif; r.frases.push(`el NIF ${nif}`) }
    else if (casaNif(ficha.nif, nif) === 'distinto') r.contradice.push(`El NIF del documento (${nif}) no es el de su ficha (${ficha.nif}).`)
  }
  const nombre = limpio(leido.nombre)
  if (nombre) {
    if (!limpio(ficha.nombreFiscal)) { r.proponer.legalName = nombre; r.frases.push(`el nombre fiscal «${nombre}»`) }
    else if (claveNombre(nombre) && claveNombre(ficha.nombreFiscal!) && claveNombre(nombre) !== claveNombre(ficha.nombreFiscal!)) {
      r.contradice.push(`El nombre del documento («${nombre}») no es el nombre fiscal de su ficha («${ficha.nombreFiscal}»).`)
    }
  }
  const dir = partirDireccion(leido.direccion)
  if (dir.calle || dir.codigoPostal) {
    if (!limpio(ficha.calle) && !limpio(ficha.codigoPostal)) {
      if (dir.calle) r.proponer.fiscalStreet = dir.calle
      if (dir.codigoPostal) r.proponer.fiscalPostalCode = dir.codigoPostal
      if (dir.ciudad) r.proponer.fiscalCity = dir.ciudad
      r.frases.push(`la dirección «${[dir.calle, [dir.codigoPostal, dir.ciudad].filter(Boolean).join(' ')].filter(Boolean).join(', ')}»`)
    } else if (dir.codigoPostal && limpio(ficha.codigoPostal) && dir.codigoPostal !== limpio(ficha.codigoPostal)) {
      r.contradice.push(`La dirección del documento (${dir.codigoPostal}${dir.ciudad ? ` ${dir.ciudad}` : ''}) no es la de su ficha (${ficha.codigoPostal}${ficha.ciudad ? ` ${ficha.ciudad}` : ''}).`)
    }
  }
  return r
}

/** «el NIF X, el nombre fiscal «Y» y la dirección «Z»». */
export function enUnaFrase(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}
