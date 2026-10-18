// src/modules/conta/lib/recibidaAMano.ts
//
// S01d · «Nueva recibida a mano» (Julio: «crear una recibida a mano»), lo que
// se decide sin base y sin pantalla, para probarlo en la unitaria:
//   · leer un importe escrito en español («1.234,56»);
//   · la cuota de una base a un tipo y el total (base + cuota), al céntimo;
//   · comprobar lo escrito antes de guardar, con un fallo por campo en
//     lenguaje normal;
//   · lo que se dice al guardar y al fallar (regla 8: con contenido).
//
// S01e (Julio, 18/10: «Foodint necesita su analítica por local»): pide el
// local, con «Común» como una opción más. Sin elegir no se guarda; en una
// empresa sin el eje de local no se pregunta y queda común, como antes.
//
// La cuota se calcula igual que el asiento (cuotaIva de lib/libro): si la
// persona la cambia, se guarda la suya y se avisa de que el asiento propuesto
// saldrá con base × tipo y dirá la diferencia con el total.

import { cent, cuotaIva, deCent } from '@/modules/conta/lib/libro'
import { leerImporte } from '@/modules/conta/lib/lectorCsvBanco'
import { eurosExactos, porcentaje } from '@/modules/conta/lib/formato'

/** El valor del selector de local que significa «Común» (de todos los locales; el informe lo reparte). */
export const LOCAL_COMUN = 'comun'

/** Los tipos que se ofrecen si la base no da los suyos (los de IVA vigentes en España, y sin IVA). */
export const TIPOS_DE_SERIE: readonly number[] = [21, 10, 4, 0]

/** Lo escrito en el formulario, tal cual (los importes como texto). */
export interface BorradorRecibida {
  proveedorId: string
  numero: string
  /** AAAA-MM-DD, o '' si no se ha puesto. */
  fecha: string
  base: string
  /** El tipo elegido, como texto del selector («21»). */
  tipo: string
  /** '' = la calculada. */
  cuota: string
  /** El local: su id, LOCAL_COMUN, o '' sin elegir. */
  local: string
}

/** Lo que se guarda, ya comprobado. */
export interface RecibidaComprobada {
  proveedorId: string
  numero: string
  fecha: string
  base: number
  tipo: number
  cuota: number
  total: number
  /** El local de la factura; null = común. */
  localId: string | null
}

export type CampoRecibida = 'proveedor' | 'numero' | 'fecha' | 'local' | 'base' | 'tipo' | 'cuota'

export interface Comprobacion {
  errores: Partial<Record<CampoRecibida, string>>
  /** Lo que no impide guardar pero hay que decir (la cuota cambiada a mano). */
  aviso: string | null
  /** Null mientras haya algún error. */
  datos: RecibidaComprobada | null
}

/**
 * Un importe escrito en español, en euros: «1.234,56», «1234,5», «12», «1234.56».
 * Null si no es un importe o trae más de dos decimales tras la coma («1,234»:
 * en español eso no son mil doscientos, y adivinarlo es peor que preguntar).
 */
export function leerImporteEs(texto: string): number | null {
  const t = texto.trim()
  if (t === '') return null
  if (/,\d{3,}$/.test(t.replace(/[€\s]/g, ''))) return null
  const c = leerImporte(t)
  return c === null ? null : deCent(c)
}

/** La cuota de una base a un tipo, al céntimo (la misma regla que el asiento). */
export function cuotaDe(base: number, tipo: number): number {
  return cuotaIva(base, tipo)
}

/** Base + cuota, al céntimo (sin errores de coma flotante). */
export function totalDe(base: number, cuota: number): number {
  return deCent(cent(base) + cent(cuota))
}

/** ¿Es una fecha AAAA-MM-DD que existe? */
function fechaValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

const fechaEs = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * Comprueba lo escrito. `tipos` son los que se ofrecen; `hoy`, AAAA-MM-DD en
 * Madrid; `conLocal`, si la empresa lleva el eje de local (entonces hay que
 * elegirlo, y «Común» vale).
 */
export function comprobarRecibida(b: BorradorRecibida, tipos: readonly number[], hoy: string, conLocal: boolean): Comprobacion {
  const errores: Partial<Record<CampoRecibida, string>> = {}
  if (!b.proveedorId) errores.proveedor = 'Elige el proveedor. Si no está, dalo de alta primero.'
  const numero = b.numero.trim()
  if (!numero) errores.numero = 'Escribe el número de la factura, tal como viene en ella.'
  else if (numero.length > 60) errores.numero = 'El número es demasiado largo (como mucho 60 caracteres).'
  if (!b.fecha) errores.fecha = 'Pon la fecha de expedición de la factura.'
  else if (!fechaValida(b.fecha)) errores.fecha = 'Esa fecha no existe: escríbela como dd/mm/aaaa.'
  else if (b.fecha > hoy) errores.fecha = `La fecha es posterior a hoy (${fechaEs(hoy)}): una factura recibida no puede ser del futuro.`
  if (conLocal && !b.local) errores.local = 'Elige el local de la factura, o «Común» si es de todos.'
  const localId = !conLocal || !b.local || b.local === LOCAL_COMUN ? null : b.local

  const base = leerImporteEs(b.base)
  if (b.base.trim() === '') errores.base = 'Escribe la base imponible.'
  else if (base === null) errores.base = 'La base no es un importe: escríbela así, 1.234,56.'
  else if (base <= 0) errores.base = 'La base tiene que ser mayor que 0. Un abono no se da de alta aquí.'

  const tipo = b.tipo === '' ? null : Number(b.tipo)
  if (tipo === null || !Number.isFinite(tipo) || !tipos.includes(tipo)) errores.tipo = 'Elige el tipo de IVA de la factura.'

  let cuota: number | null = null
  let aviso: string | null = null
  if (base !== null && base > 0 && tipo !== null && tipos.includes(tipo)) {
    const calculada = cuotaDe(base, tipo)
    if (b.cuota.trim() === '') cuota = calculada
    else {
      cuota = leerImporteEs(b.cuota)
      if (cuota === null) errores.cuota = 'La cuota no es un importe: escríbela así, 259,26.'
      else if (cuota < 0) errores.cuota = 'La cuota no puede ser negativa.'
      else if (tipo === 0 && cuota !== 0) errores.cuota = 'Sin IVA (0 %), la cuota es 0.'
      else if (cent(cuota) !== cent(calculada)) {
        aviso = `La cuota de la base al ${porcentaje(tipo)} es ${eurosExactos(calculada)}; has puesto ${eurosExactos(cuota)}. Se guarda la tuya, y el asiento propuesto saldrá con ${eurosExactos(calculada)} y te dirá la diferencia con el total.`
      }
    }
  } else if (b.cuota.trim() !== '' && leerImporteEs(b.cuota) === null) {
    errores.cuota = 'La cuota no es un importe: escríbela así, 259,26.'
  }

  if (Object.keys(errores).length > 0 || base === null || tipo === null || cuota === null) return { errores, aviso, datos: null }
  return { errores, aviso, datos: { proveedorId: b.proveedorId, numero, fecha: b.fecha, base, tipo, cuota, total: totalDe(base, cuota), localId } }
}

/** Regla 8: lo que se dice al guardar, con contenido. */
export function textoGuardada(numero: string, proveedor: string): string {
  return `Factura ${numero} de ${proveedor} guardada. Revísala y apúntala.`
}

/**
 * El fallo de la base, en lenguaje normal. La repetida (el disparador
 * tg_supplier_invoice_no_repetida: mismo proveedor, número y total, 23505) y
 * el permiso (42501) se dicen con sus palabras; lo demás, con el prefijo y el
 * texto que ya trae (errorBase cambia lo técnico por una frase normal).
 */
export function textoDeFallo(e: { code?: string | null; message: string }, numero: string, proveedor: string, otro: (m: string) => string = (m) => m): string {
  if (e.code === '23505' || /^Repetida/i.test(e.message)) {
    return `No se ha guardado: ya tienes la factura ${numero} de ${proveedor} con el mismo total. No entra dos veces; búscala en Documentos › Facturas recibidas. Si es otra, revisa el número.`
  }
  if (e.code === '42501') return 'No se ha guardado: no tienes permiso para dar de alta facturas en esta cuenta.'
  return `No se ha guardado la factura: ${otro(e.message)}`
}
