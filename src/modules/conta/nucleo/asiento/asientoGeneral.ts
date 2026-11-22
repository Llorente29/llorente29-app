// src/modules/conta/nucleo/asiento/asientoGeneral.ts
//
// K12 · Lo que decide el asiento general (maqueta nucleo_19, como ERP10), sin pantalla. Se prueba sin navegador
// (tests/unit/modules/conta/k12/asientoGeneral.test.ts).
//   · Los apuntes van uno por fila; se escriben en la línea de abajo (la que se edita) y Intro la sube a la lista.
//   · La línea nueva trae el concepto, el local, la marca y la plataforma de la de antes, y en su lado lo que falta para
//     cuadrar (en ámbar: lo propone Sumied).
//   · Totales: debe, haber y descuadre. Con descuadre no se graba: la casilla del descuadre va en ámbar, sin frase.

import { importeMano } from '@/modules/conta/lib/diario'
import { cifra } from '@/modules/conta/nucleo/ficha/textos'
import { sumaDeControl } from '@/modules/conta/nucleo/piezas/logica'

/** Un apunte como se escribe: los importes, como texto («1.210,00»). */
export interface ApunteEd {
  cuentaId: string | null; codigo: string; concepto: string
  local: string | null; marca: string | null; plataforma: string | null
  debe: string; haber: string
}

export const apunteVacio = (concepto = ''): ApunteEd => ({ cuentaId: null, codigo: '', concepto, local: null, marca: null, plataforma: null, debe: '', haber: '' })

export const totalesDe = (apuntes: readonly ApunteEd[]) =>
  sumaDeControl(apuntes.map((a) => ({ debe: importeMano(a.debe) || 0, haber: importeMano(a.haber) || 0 })))

/** Lo que le falta a una línea para subir a la lista (vacío: sube). */
export function problemasDeLaLinea(a: ApunteEd): string[] {
  const r: string[] = []
  if (!a.cuentaId) r.push('la subcuenta')
  const d = a.debe.trim() ? importeMano(a.debe) : 0
  const h = a.haber.trim() ? importeMano(a.haber) : 0
  if (Number.isNaN(d) || Number.isNaN(h) || d < 0 || h < 0) r.push('un importe que sea un número')
  else if ((d === 0) === (h === 0)) r.push('un importe, al debe o al haber')
  return r
}

/**
 * Sube la línea que se edita: en su sitio si se estaba cambiando una (`en`), o al final. Devuelve la lista y la línea
 * nueva que queda abajo: con el concepto, el local, la marca y la plataforma de la que sube y, en su lado, lo que falta
 * para cuadrar (`propuesto`: el lado que puso Sumied, en ámbar).
 */
export function subirLinea(apuntes: readonly ApunteEd[], linea: ApunteEd, en: number | null):
  { apuntes: ApunteEd[]; nueva: ApunteEd; propuesto: 'debe' | 'haber' | null } {
  const lista = en === null ? [...apuntes, linea] : apuntes.map((a, i) => (i === en ? linea : a))
  const nueva: ApunteEd = { ...apunteVacio(linea.concepto), local: linea.local, marca: linea.marca, plataforma: linea.plataforma }
  const t = totalesDe(lista)
  if (t.descuadre === 0) return { apuntes: lista, nueva, propuesto: null }
  const lado = t.descuadre > 0 ? 'haber' as const : 'debe' as const
  return { apuntes: lista, nueva: { ...nueva, [lado]: cifra(Math.abs(t.descuadre)) }, propuesto: lado }
}

/** La línea de abajo está vacía (sin subcuenta ni importe escritos por la persona). */
export const lineaVacia = (a: ApunteEd, propuesto: 'debe' | 'haber' | null): boolean =>
  !a.cuentaId && !a.codigo.trim() && (propuesto === 'debe' || !a.debe.trim()) && (propuesto === 'haber' || !a.haber.trim())

/** Lo que impide grabar el asiento (vacío: se graba). El descuadre no lleva frase: lo dice la casilla en ámbar. */
export function porQueNoSeGraba(c: { fecha: string; concepto: string }, apuntes: readonly ApunteEd[]): ('fecha' | 'concepto' | 'apuntes' | 'descuadre')[] {
  const r: ('fecha' | 'concepto' | 'apuntes' | 'descuadre')[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) r.push('fecha')
  if (!c.concepto.trim()) r.push('concepto')
  if (apuntes.length < 2 || apuntes.some((a) => problemasDeLaLinea(a).length)) r.push('apuntes')
  const t = totalesDe(apuntes)
  if (!t.cuadra) r.push('descuadre')
  return r
}

/** Los apuntes, como los guarda la base. */
export const aLineas = (apuntes: readonly ApunteEd[]) => apuntes.map((a) => ({
  cuentaId: a.cuentaId!, codigo: a.codigo, concepto: a.concepto,
  debe: Math.round((importeMano(a.debe) || 0) * 100) / 100, haber: Math.round((importeMano(a.haber) || 0) * 100) / 100,
  local: a.local, marca: a.marca, plataforma: a.plataforma,
}))

/** De la base a la pantalla. */
export const deLineas = (lineas: readonly { cuentaId: string; codigo: string; concepto: string; debe: number; haber: number; local: string | null; marca: string | null; plataforma: string | null }[]): ApunteEd[] =>
  lineas.map((l) => ({ cuentaId: l.cuentaId, codigo: l.codigo, concepto: l.concepto, local: l.local, marca: l.marca, plataforma: l.plataforma, debe: l.debe ? cifra(l.debe) : '', haber: l.haber ? cifra(l.haber) : '' }))
