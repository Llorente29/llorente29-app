// src/modules/conta/libro/apuntesAsiento.tsx
//
// Asientos · los apuntes de un asiento del libro, en la tabla común del asiento
// (diseno/plantillas, TablaAsiento): sus líneas, sus columnas de más y lo que va
// debajo del nombre. Lo comparten el asiento abierto (AsientoPage) y sus apuntes
// al desplegar la fila en el libro (LibroDiarioPage), para que los dos enseñen
// lo mismo de cada línea.
//
// Solo funciones (sin componentes), para que el refresco en caliente no se queje
// de un fichero que mezcla los dos.

import type { ReactNode } from 'react'
import { textoDeImporte } from '@/modules/conta/diseno'
import type { ColumnaAsiento, LineaAsientoVista } from '@/modules/conta/diseno/plantillas'
import { Chip } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { modeloYPeriodo } from '@/modules/conta/lib/libro'
import { marcaNegativoDiez, pastillasDeLinea, type ApunteDiario } from '@/modules/conta/lib/diario'

/** Una línea de la tabla común del asiento, con su apunte detrás (para sus columnas y sus acciones). */
export type LineaApunte = LineaAsientoVista & { apunte: ApunteDiario }

/** Cada apunte, como línea de la tabla: su número de cuenta, su nombre de uso y su importe en el debe o en el haber. */
export function lineasDeApuntes(apuntes: readonly ApunteDiario[]): LineaApunte[] {
  return apuntes.map((l) => ({
    id: l.posicion, codigo: l.cuenta, nombre: l.nombreCuenta, apunte: l,
    debe: l.debe ? textoDeImporte(l.debe) : null, haber: l.haber ? textoDeImporte(l.haber) : null,
  }))
}

/** El libro de IVA de la línea (journal_line.vat_book), en palabras. */
export const LIBRO_IVA: Readonly<Record<string, string>> = {
  issued: 'libro de expedidas', received: 'libro de recibidas', investment: 'bienes de inversión', not_subject: 'no sujeto',
}

/** «10 % sobre 100,00 € · libro de recibidas». */
export function textoIva(iva: NonNullable<ApunteDiario['iva']>): string {
  const libro = LIBRO_IVA[iva.libro]
  return `${iva.tipo ?? ''} % sobre ${eurosExactos(iva.base)}${libro ? ` · ${libro}` : ''}`
}

/** «111 sobre 500,00 €» (la que nace) o «Pago del 111 · 3T 2026» (S01d). */
export const textoRetencion = (r: NonNullable<ApunteDiario['retencion']>): string =>
  r.periodo ? `Pago del ${modeloYPeriodo(r.modelo, r.periodo)}` : `${r.modelo} sobre ${eurosExactos(r.base)}`

const chips = (l: ApunteDiario, eje: 'local' | 'marca') => pastillasDeLinea(l, { local: eje === 'local', marca: eje === 'marca' })

/**
 * Las columnas de más: el local (o «Común») y la marca (o «X · cedida», en
 * ámbar), solo con su eje encendido (S01, Definiciones › Analítica); el IVA
 * (tipo, base y libro) y la retención. Cada una sale si alguna línea la lleva:
 * una columna vacía en todas las líneas no dice nada (no se esconde ninguna
 * línea: solo se ahorra una columna en blanco).
 */
export function columnasApuntes(apuntes: readonly ApunteDiario[], ejes: { local: boolean; marca: boolean }): ColumnaAsiento<LineaApunte>[] {
  const r: ColumnaAsiento<LineaApunte>[] = []
  const pinta = (l: ApunteDiario, eje: 'local' | 'marca') => chips(l, eje).map((p) => <Chip key={p.texto} tono={p.tono}>{p.texto}</Chip>)
  if (ejes.local && apuntes.some((l) => chips(l, 'local').length > 0)) r.push({ id: 'local', titulo: 'Local', celda: (x) => pinta(x.apunte, 'local') })
  if (ejes.marca && apuntes.some((l) => chips(l, 'marca').length > 0)) r.push({ id: 'marca', titulo: 'Marca', celda: (x) => pinta(x.apunte, 'marca') })
  if (apuntes.some((l) => l.iva)) r.push({ id: 'iva', titulo: 'IVA', celda: ({ apunte: { iva } }) => (iva ? textoIva(iva) : null) })
  if (apuntes.some((l) => l.retencion)) r.push({ id: 'retencion', titulo: 'Retención', celda: ({ apunte: { retencion } }) => (retencion ? textoRetencion(retencion) : null) })
  return r
}

/** Debajo del nombre: «En Diez iba en negativo (en el …)», en ámbar, y el concepto de la línea. */
export function apoyoApunte(l: ApunteDiario): ReactNode {
  const negativo = marcaNegativoDiez(l)
  if (!negativo && !l.concepto) return null
  return <>{negativo && <Chip tono="ambar">{negativo}</Chip>}{l.concepto && <span className="s-asiento-concepto">{l.concepto}</span>}</>
}
