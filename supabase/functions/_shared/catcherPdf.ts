// supabase/functions/_shared/catcherPdf.ts
//
// E05 · El PDF de una factura de Catcher contra su Excel: el texto por
// posición (textoPorPosicion, el arreglo del #278) y lo que el PDF tiene que
// decir (comprobarPdf). Lo usan el front al subir la quincena y el servidor al
// volver a leer los PDF (conta-lote-releer): el mismo código en los dos sitios.

import { claveNumero } from './lecturaFactura.ts'
import type { Comprobacion, FacturaExcel } from './catcherTipos.ts'

/** Las formas en que un importe puede salir escrito en el PDF: 1.062,25 · 1062,25 · 1062.25 · 1,062.25. */
function formasImporte(x: number): string[] {
  // eslint-disable-next-line no-restricted-syntax -- x es un importe del Excel ya convertido a número (importe()), nunca null.
  const [ent, dec] = Math.abs(x).toFixed(2).split('.')
  const miles = (sep: string) => ent.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
  const signo = x < 0 ? '-' : ''
  return [...new Set([`${miles('.')},${dec}`, `${ent},${dec}`, `${ent}.${dec}`, `${miles(',')}.${dec}`])].map((s) => signo + s)
}
const plano = (s: string) => s.replace(/\s+/g, '')
const fechas = (iso: string | null) => {
  if (!iso) return []
  const [a, m, d] = iso.split('-')
  return [iso, `${d}/${m}/${a}`, `${d}-${m}-${a}`, `${+d}/${+m}/${a}`]
}

/**
 * El texto de una página de PDF por su POSICIÓN, línea a línea, como lo ve una
 * persona (lo mismo que pdftotext -layout), y no en el orden en que el PDF
 * dibuja sus trozos. En las facturas de los riders de Catcher, «Pedidos
 * entregados:» y su número son dos trozos que no se dibujan seguidos: unidos
 * en el orden de dibujo no quedaban juntos y pdf_pedidos fallaba en las 83 de
 * la 1.ª quincena de octubre aunque los números cuadraran.
 * `items`: los de getTextContent de pdfjs (str y transform: x = [4], y = [5]).
 */
export function textoPorPosicion(items: readonly { str?: string; transform?: readonly number[] }[]): string {
  const trozos = items
    .filter((x) => (x.str ?? '').trim() !== '')
    .map((x, i) => ({ str: x.str!, x: x.transform?.[4] ?? 0, y: x.transform?.[5] ?? 0, i }))
  // Más arriba primero (en PDF la y crece hacia arriba); en la misma línea, de izquierda a derecha.
  trozos.sort((a, b) => b.y - a.y || a.x - b.x || a.i - b.i)
  const lineas: { y: number; trozos: typeof trozos }[] = []
  for (const t of trozos) {
    const l = lineas.find((x) => Math.abs(x.y - t.y) <= 2)
    if (l) l.trozos.push(t)
    else lineas.push({ y: t.y, trozos: [t] })
  }
  return lineas.map((l) => l.trozos.sort((a, b) => a.x - b.x || a.i - b.i).map((t) => t.str).join(' ')).join('\n')
}

/** Lo que el PDF tiene que decir, comparado con lo que dice el Excel. `texto`: el del PDF (pdfjs). */
export function comprobarPdf(f: FacturaExcel, texto: string): Comprobacion[] {
  const t = plano(texto)
  const T = t.toUpperCase()
  const hay = (xs: string[]) => xs.some((x) => t.includes(plano(x)))
  const nif = f.emisor.nif
  return [
    { id: 'pdf_numero', ok: !!claveNumero(f.numero) && (claveNumero(texto) ?? '').includes(claveNumero(f.numero)!), texto: 'El PDF lleva el número de la factura.' },
    { id: 'pdf_nif', ok: !!nif && (T.replace(/[^A-Z0-9]/g, '').includes(nif)), texto: 'El PDF lleva el NIF o NIE del emisor.' },
    { id: 'pdf_base', ok: hay(formasImporte(f.base)), texto: 'La base del PDF es la del Excel.' },
    { id: 'pdf_cuota', ok: hay(formasImporte(f.cuota)), texto: 'El IVA del PDF es el del Excel.' },
    { id: 'pdf_total', ok: hay(formasImporte(f.total)), texto: 'El total del PDF es el del Excel.' },
    { id: 'pdf_fecha', ok: hay(fechas(f.fecha)), texto: 'La fecha del PDF es la del Excel.' },
    { id: 'pdf_ejercicio', ok: hay(fechas(f.desde)) && hay(fechas(f.hasta)), texto: 'El ejercicio del PDF es el del Excel.' },
    { id: 'pdf_pedidos', ok: f.pedidos == null || new RegExp(`PEDIDOSENTREGADOS:?${f.pedidos}(?!\\d)`).test(T), texto: 'Los pedidos entregados del PDF son los del Excel.' },
  ]
}
