// src/modules/conta/gestoria/pdfUnion.ts
//
// G01b · El ensayo de la unión de las fichas repetidas de Bitrix24, en PDF
// (Julio, 07/11). Lo genera el navegador con lo que devuelve la función
// (conta-bitrix-leer, acción «ensayo_union») y lo descarga quien está dentro
// de la cuenta: no se guarda en ningún sitio ni se registra (T11).
//
//   · Arriba: la empresa, la fecha y que es un ensayo (no se ha cambiado nada
//     en Sumied ni en Bitrix24); y el resumen: cuántos clientes resultan,
//     cuántas fichas se unen y cuántas fichas y clientes quedan en cada
//     situación.
//   · Clientes que se unen: por cada NIF repetido, sus fichas (nombre, id de
//     Bitrix24 y situación) y la situación con la que queda en Sumied.
//   · Fichas que entran sin NIF: nombre, id de Bitrix24, el NIF tal cual y el
//     motivo.
// Limpio y de oficina: una tabla por bloque, sin códigos UF_CRM.

import { jsPDF } from 'jspdf'
import type { EnsayoDeUnion } from '../../../../supabase/functions/conta-bitrix-leer/clientes'

export interface DatosEnsayo extends EnsayoDeUnion {
  empresa: string
  /** Cuándo se leyó Bitrix24 (ISO). */
  leido: string
  /** Si la unión ya está aplicada. */
  aplicada: boolean
}

const SITUACION: Record<string, string> = {
  activo: 'Activo', moroso: 'Moroso', solo_renta: 'Solo la renta', sin_clasificar: 'Sin clasificar', baja: 'De baja', sin_situacion: 'Sin situación en Bitrix24',
}
const enPalabras = (s: string | null) => SITUACION[s ?? 'sin_situacion'] ?? s ?? 'Sin situación en Bitrix24'
const MOTIVO = { nif_no_valido: 'No tiene formato de DNI, NIE ni CIF', nif_en_muchas: 'Sale en 10 fichas o más' } as const
const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** Las fuentes del PDF son Latin-1: fuera lo que no cabe (los «❌» de las opciones de Bitrix24, emojis…). */
export const limpio = (t: string | null | undefined) =>
  (t ?? '').replace(/[^ -ÿ€‘’“”«»–—…›‹]/g, '').replace(/\s+/g, ' ').trim()

/** «7 de noviembre de 2026, 11:40» en Madrid. */
export function fechaDelEnsayo(iso: string) {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
  return `${dia}, ${hora}`
}

/** El nombre del fichero: «Ensayo de la union de fichas · 2026-11-07.pdf» sin tildes. */
export const ficheroDelEnsayo = (iso: string) => `Ensayo de la union de fichas de Bitrix24 - ${iso.slice(0, 10)}.pdf`

interface Columna { titulo: string; peso: number; derecha?: boolean }

/** El PDF entero. Devuelve el documento (para descargarlo o probarlo). */
export function pdfDelEnsayo(d: DatosEnsayo): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const m = 14
  const util = ancho - 2 * m
  let y = 18
  const tinta = () => doc.setTextColor(14, 26, 43)
  const gris = () => doc.setTextColor(91, 102, 120)

  const pie = () => {
    const n = doc.getNumberOfPages()
    for (let i = 1; i <= n; i++) {
      doc.setPage(i)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); gris()
      doc.text(`${limpio(d.empresa)} · Ensayo de la unión de fichas de Bitrix24 · ${fechaDelEnsayo(d.leido)}`, m, alto - 8)
      doc.text(`Página ${i} de ${n}`, ancho - m, alto - 8, { align: 'right' })
    }
  }
  const nueva = () => { doc.addPage(); y = 18 }
  const cabe = (h: number) => { if (y + h > alto - 16) nueva() }

  // Cabecera.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); tinta()
  doc.text(limpio(d.empresa), m, y); y += 7
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
  doc.text('Ensayo de la unión de fichas repetidas de Bitrix24', m, y); y += 5.5
  doc.setFontSize(9); gris()
  doc.text(`Leído de Bitrix24 el ${fechaDelEnsayo(d.leido)}`, m, y); y += 7

  // Es un ensayo.
  const aviso = d.aplicada
    ? 'ENSAYO. La unión ya está aplicada; este documento solo enseña lo que hace con las fichas de hoy. No cambia nada en Sumied ni en Bitrix24.'
    : 'ENSAYO. No se ha cambiado nada en Sumied ni en Bitrix24. Es lo que pasará cuando se aplique la unión en Ajustes > Cobros > Bitrix24.'
  // La letra, antes de partir el texto: si no, se mide con otra y se sale del recuadro.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
  const lineasAviso = doc.splitTextToSize(aviso, util - 8) as string[]
  const hAviso = lineasAviso.length * 4.4 + 6
  doc.setFillColor(255, 247, 230); doc.setDrawColor(230, 180, 90); doc.roundedRect(m, y, util, hAviso, 1.5, 1.5, 'FD')
  doc.setTextColor(122, 72, 0)
  doc.text(lineasAviso, m + 4, y + 5.5); y += hAviso + 8

  // Una tabla con cabecera, filas que parten el texto largo y cabecera repetida en cada página.
  const tabla = (titulo: string, apoyo: string | null, cols: Columna[], filas: string[][], separar?: (i: number) => boolean) => {
    const suma = cols.reduce((a, c) => a + c.peso, 0)
    const w = cols.map((c) => (util * c.peso) / suma)
    cabe(22)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); tinta(); doc.text(titulo, m, y); y += 5
    if (apoyo) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); gris(); const l = doc.splitTextToSize(apoyo, util) as string[]; doc.text(l, m, y); y += l.length * 3.8 + 1.5 }
    const cabeza = () => {
      doc.setFillColor(243, 245, 248); doc.rect(m, y - 3.8, util, 6.2, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); tinta()
      let x = m
      cols.forEach((c, i) => { doc.text(c.titulo, c.derecha ? x + w[i] - 2 : x + 2, y, { align: c.derecha ? 'right' : 'left' }); x += w[i] })
      y += 5
    }
    cabeza()
    if (!filas.length) { doc.setFont('helvetica', 'italic'); doc.setFontSize(9); gris(); doc.text('Ninguna.', m + 2, y + 1); y += 9; return }
    filas.forEach((f, n) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      const partes = f.map((t, i) => doc.splitTextToSize(limpio(t), w[i] - 4) as string[])
      const h = Math.max(...partes.map((p) => p.length)) * 3.9 + 2.2
      if (y + h > alto - 16) { nueva(); cabeza() }
      if (separar?.(n) && n > 0) { doc.setDrawColor(200, 207, 217); doc.line(m, y - 3.6, m + util, y - 3.6) }
      else { doc.setDrawColor(232, 236, 241); doc.line(m, y - 3.6, m + util, y - 3.6) }
      tinta()
      let x = m
      partes.forEach((p, i) => { doc.text(p, cols[i].derecha ? x + w[i] - 2 : x + 2, y, { align: cols[i].derecha ? 'right' : 'left' }); x += w[i] })
      y += h
    })
    y += 6
  }

  // 1 · El resumen.
  const r = d.resumen
  tabla('Resumen', null, [{ titulo: 'Qué', peso: 3 }, { titulo: 'Cuántos', peso: 1, derecha: true }], [
    ['Fichas leídas de Bitrix24', miles(r.fichas)],
    ['Clientes que resultan en Sumied', miles(r.clientes)],
    ['Clientes con varias fichas (se unen)', miles(r.clientesUnidos)],
    ['Fichas que se unen', miles(r.fichasUnidas)],
    ['Clientes de Sumied ya creados por separado que se juntan (se retiran, archivados)', miles(d.seJuntan ?? 0)],
    ['Fichas que entran sin NIF: formato no válido', miles(r.sinNifPorFormato)],
    ['Fichas que entran sin NIF: su NIF sale en 10 fichas o más', miles(r.sinNifPorMuchas)],
  ])
  tabla('Cada situación', 'La de un cliente es la más viva de sus fichas: activo, moroso, solo la renta, sin clasificar y de baja, por este orden.',
    [{ titulo: 'Situación', peso: 3 }, { titulo: 'Fichas', peso: 1, derecha: true }, { titulo: 'Clientes', peso: 1, derecha: true }],
    ['activo', 'moroso', 'solo_renta', 'sin_clasificar', 'baja', 'sin_situacion'].map((k) =>
      [enPalabras(k), miles(r.fichasPorSituacion[k] ?? 0), miles(r.clientesPorSituacion[k] ?? 0)]))

  // 2 · Los clientes que se unen.
  const filasUnidos: string[][] = []
  const inicio = new Set<number>()
  for (const u of d.unidos) {
    inicio.add(filasUnidos.length)
    u.fichas.forEach((f, i) => filasUnidos.push([
      i === 0 ? u.nif : '', f.nombre, f.bitrixId,
      f.situacion === 'sin_clasificar' && f.situacionTexto ? `Sin clasificar («${f.situacionTexto}»)` : enPalabras(f.situacion),
      i === 0 ? enPalabras(u.situacion) : '',
      i === 0 ? (u.clientesHoy >= 2 ? `${u.clientesHoy} clientes: se juntan` : u.clientesHoy === 1 ? '1 cliente' : 'Nuevo') : '',
    ]))
  }
  tabla(`Clientes que se unen (${miles(d.unidos.length)})`, 'Cada NIF repetido es un solo cliente en Sumied, con todas sus fichas de Bitrix24 enlazadas. Si hoy ya son varios clientes, se juntan: lo de la gestoría y el cobro pasa al que queda y el otro se archiva, con su rastro.',
    [{ titulo: 'NIF', peso: 1.3 }, { titulo: 'Ficha en Bitrix24', peso: 3 }, { titulo: 'Id', peso: 0.7 }, { titulo: 'Situación de la ficha', peso: 1.8 }, { titulo: 'Queda en Sumied', peso: 1.4 }, { titulo: 'Hoy en Sumied', peso: 1.4 }],
    filasUnidos, (i) => inicio.has(i))

  // 3 · Las fichas que entran sin NIF.
  tabla(`Fichas que entran sin NIF (${miles(d.sinNif.length)})`, 'Su NIF no se usa: cada una entra como un cliente aparte, sin NIF, y sale en «Pendiente de revisar».',
    [{ titulo: 'Ficha en Bitrix24', peso: 3.2 }, { titulo: 'Id', peso: 0.8 }, { titulo: 'NIF tal cual', peso: 1.6 }, { titulo: 'Motivo', peso: 2.4 }],
    d.sinNif.map((f) => [f.nombre, f.bitrixId, f.nifEnBitrix ?? '', f.motivo === 'nif_en_muchas' ? `${MOTIVO.nif_en_muchas} (${f.fichasConSuNif})` : MOTIVO.nif_no_valido]))

  pie()
  return doc
}

/** Lo descarga en el navegador. */
export function descargarEnsayo(d: DatosEnsayo) {
  pdfDelEnsayo(d).save(ficheroDelEnsayo(d.leido))
}
