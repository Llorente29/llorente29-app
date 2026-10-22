// src/modules/conta/diseno/valores.ts
//
// S01 · Lo que deciden los campos sin pintar, para probarlo sin navegador.

import { leerImporte } from '@/modules/conta/lib/lectorCsvBanco'
import { euros, eurosExactos } from '@/modules/conta/lib/formato'

/**
 * La subcuenta con punto, como en todos los programas de contabilidad: «43.12»
 * se rellena con ceros hasta los dígitos del plan → «43000012». Sin punto, o
 * si no cabe, se deja tal cual (lo dirá quien valide la subcuenta).
 */
export function expandirSubcuenta(texto: string, digitos = 8): string {
  const t = texto.replace(/\s/g, '')
  const m = /^(\d+)\.(\d*)$/.exec(t)
  if (!m) return t
  const [, izq, der] = m
  if (izq.length + der.length > digitos) return t
  return izq + '0'.repeat(digitos - izq.length - der.length) + der
}

/** Lo escrito en un campo de importe, en euros; null si no es un importe. Acepta «1.234,56», «1234.56», «−12,5». */
export function importeDeTexto(texto: string): number | null {
  const c = leerImporte(texto)
  return c === null ? null : c / 100
}

/** Cómo queda escrito un importe al salir del campo: «1.234,56», sin el «€» (lo dice la etiqueta). */
export function textoDeImporte(n: number): string {
  return eurosExactos(n).replace(/\s€$/, '')
}

// ── Lo que deciden los componentes sin pintar ──────────────────────────

export type VarianteBoton = 'principal' | 'secundario' | 'enlace' | 'fantasma'

/** Las clases de un botón: las comparten <button> y <a>, y las prueba la unitaria. */
export function clasesBoton({ variante = 'secundario', grande = false, ancho = false }: { variante?: VarianteBoton; grande?: boolean; ancho?: boolean }): string {
  return ['s-boton', `s-boton-${variante}`, grande ? 's-boton-grande' : '', ancho ? 's-boton-ancho' : ''].filter(Boolean).join(' ')
}

export interface OpcionSelector { valor: string; texto: string }

/**
 * Las opciones que se pintan. Si lo guardado ya no está en la lista que se
 * ofrece, sale igual y lo dice (regla 30: la lista con la que se elige no es
 * la lista con la que se lee); si no, el select lo enseñaría como otra cosa.
 */
export function opcionesConGuardado(valor: string, opciones: readonly OpcionSelector[], textoGuardado?: string): OpcionSelector[] {
  if (valor === '' || opciones.some((o) => o.valor === valor)) return [...opciones]
  return [{ valor, texto: `${textoGuardado ?? valor} (ya no se ofrece)` }, ...opciones]
}

export type TonoChip = 'seguro' | 'duda' | 'falta' | 'neutro' | 'accion' | 'oscuro' | 'propuesto'

/**
 * El tono de un estado de los de antes (lib/diario: verde, ámbar, azul, gris),
 * para que las pantallas que pasen al esqueleto no cambien de color al cambiar
 * de pieza.
 */
export function tonoDeEstado(t: 'verde' | 'ambar' | 'azul' | 'neutro' | 'gris' | 'rojo'): TonoChip {
  return t === 'verde' ? 'seguro' : t === 'ambar' ? 'duda' : t === 'rojo' ? 'falta' : t === 'azul' ? 'accion' : 'neutro'
}

/** Un importe como en las maquetas; null sale «—» (o `vacio`), nunca cero. */
export function textoCifra(valor: number | null, o: { exacta?: boolean; lado?: 'D' | 'H'; vacio?: string } = {}): string {
  const { exacta = true, lado, vacio = '—' } = o
  if (valor === null || !Number.isFinite(valor)) return vacio
  const t = exacta ? eurosExactos(valor) : euros(valor)
  return lado ? `${t.replace(/\s€$/, '')} ${lado}` : t
}
