// src/modules/conta/lib/traer/sumasDeErp10.ts
//
// X14 · 2 (Julio, 25/11) · El sumas y saldos de ERP10, de su fichero, para compararlo en la base con lo traído en prueba,
// cuenta a cuenta, debe y haber (conta_traer_poner_sumas). Con la conexión, el sumas y saldos se calculaba sumando los
// mismos asientos leídos: no comparaba nada. Puro: sin base y sin red.

import type { FicheroExcel } from './excel'
import { leerCarga } from './index'
import type { DatosDeLaCarga } from './paraLaBase'

export type SumasDelFichero = { sumas: DatosDeLaCarga['sumas']; cuentas: number } | { porque: string }

/** Lee un fichero soltado: si es el sumas y saldos de ERP10, sus cuentas en céntimos; si no, por qué no. */
export function sumasDelFichero(f: FicheroExcel): SumasDelFichero {
  const c = leerCarga([f])
  const fi = c.ficheros.find((x) => x.tipo === 'sumas_saldos')
  if (!fi || fi.origen !== 'fichero' || !c.sumas) {
    return { porque: `«${f.nombre}» no es el sumas y saldos de ERP10 (el del ejercicio, en Excel). No se ha comparado nada.` }
  }
  const sumas = c.sumas.filas.map((x) => ({ cuenta: x.subcuenta, nombre: x.nombre, debe: x.debe, haber: x.haber }))
  if (!sumas.length) return { porque: `«${f.nombre}» no trae ninguna cuenta. No se ha comparado nada.` }
  return { sumas, cuentas: sumas.length }
}
