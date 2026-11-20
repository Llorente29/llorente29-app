// src/modules/conta/erp10/salidaSola.ts
//
// X10f (20/11) · Lo validado sale solo a ERP10. Lo que la pantalla dice de cada asiento, puro:
//   · la línea de la ficha (verde «En ERP10 · asiento N», gris «Saliendo a ERP10…», ámbar «No ha
//     salido a ERP10: …» con «Volver a intentarlo»), junto al estado de la factura;
//   · lo que se avisa al intentar cambiar o anular algo que ya está en ERP10;
//   · la lista de hoy de «Salida a ERP10», con lo que no ha salido arriba y «Cómo salió».
// Palabras de la calle (encargo X10f · 5): ni «API» ni «token» ni «cola».

export type EnvioDeUnAsiento = {
  estado: 'enviando' | 'en_erp10' | 'no_pudo'
  serie: string | null
  documento: number | null
  motivo: string | null
  intentos: number
  como: 'sola' | 'a_mano' | 'excel' | null
}

export type DatosLinea = {
  /** El asiento está validado (solo lo validado sale). */
  validado: boolean
  fecha: string
  envio: EnvioDeUnAsiento | null
  /** La salida a ERP10 de la empresa (null: no tiene). */
  salida: { encendida: boolean; desde: string } | null
  /** Salió con el Excel (su partida en la salida de Sumied), con el número de ERP10 si se sabe. */
  conElExcel: { documento: number | null } | null
  /** La primera salida de la empresa, igualada después: a partir de ahí, sale sola. */
  pruebaHecha: boolean
}

export type Linea = { tono: 'verde' | 'gris' | 'ambar'; texto: string; reintentar: boolean; vigilar: boolean }

const sinPunto = (x: string) => x.trim().replace(/\.$/, '')

/** La línea de la ficha, o null si este asiento no va a ERP10 (no está validado o la empresa no tiene salida). */
export function lineaErp10(d: DatosLinea): Linea | null {
  if (!d.validado) return null
  const v = d.envio
  if (v?.estado === 'en_erp10') return { tono: 'verde', texto: `En ERP10 · asiento ${v.documento}`, reintentar: false, vigilar: false }
  if (d.conElExcel) return { tono: 'verde', texto: d.conElExcel.documento ? `En ERP10 · asiento ${d.conElExcel.documento}` : 'En ERP10 · salió con el Excel', reintentar: false, vigilar: false }
  if (v?.estado === 'enviando') return { tono: 'gris', texto: 'Saliendo a ERP10…', reintentar: false, vigilar: true }
  if (v?.estado === 'no_pudo') {
    const otraVez = v.como !== 'excel' && v.intentos < 3
    return { tono: 'ambar', texto: `No ha salido a ERP10: ${sinPunto(v.motivo ?? 'sin motivo')}.${otraVez ? ' Se vuelve a intentar sola en unos minutos.' : ''}`, reintentar: true, vigilar: otraVez }
  }
  if (!d.salida || d.fecha < d.salida.desde) return null
  if (!d.salida.encendida) return { tono: 'gris', texto: 'La salida a ERP10 está apagada: sale cuando se encienda.', reintentar: false, vigilar: false }
  if (!d.pruebaHecha) return { tono: 'gris', texto: 'Por salir a ERP10: la primera de la empresa sale a mano, desde «Salida a ERP10», para probar.', reintentar: false, vigilar: false }
  return { tono: 'gris', texto: 'Saliendo a ERP10…', reintentar: false, vigilar: true }
}

/** Al intentar anular o cambiar algo que ya está en ERP10: lo que se dice (o null si no está). */
export function avisoYaEnErp10(d: Pick<DatosLinea, 'envio' | 'conElExcel'>): string | null {
  const n = d.envio?.estado === 'en_erp10' ? d.envio.documento : d.conElExcel ? d.conElExcel.documento : undefined
  if (n === undefined) return null
  return `Ya está en ERP10${n ? ` (asiento ${n})` : ''}. Lo que cambies o anules aquí no cambia ERP10: allí sigue el de antes, y hay que corregirlo a mano.`
}

// ── La lista de hoy en «Salida a ERP10» ─────────────────────────────────────────────

export type SalidoHoy = {
  entryId: string; numero: string; concepto: string
  estado: 'enviando' | 'en_erp10' | 'no_pudo'
  documento: number | null; motivo: string | null; intentos: number
  como: 'sola' | 'a_mano' | 'excel' | null
  /** Cuándo cambió por última vez (ISO). */
  cuando: string
}

/**
 * Una fila de conta_erp10_envio tal como la da la base, con su asiento embebido (`journal_entry(series, number,
 * concept)`, por la clave ajena entry_id): lo que enseña la lista de hoy. Sin asiento embebido, «—».
 */
export function aSalidoHoy(x: Record<string, unknown>): SalidoHoy {
  const je = (x.journal_entry ?? null) as Record<string, unknown> | null
  const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  return {
    entryId: String(x.entry_id), numero: je && je.series != null ? `${je.series}/${je.number ?? '—'}` : '—', concepto: txt(je?.concept) ?? '',
    estado: x.estado as SalidoHoy['estado'], documento: x.erp10_documento == null ? null : Number(x.erp10_documento), motivo: txt(x.motivo),
    intentos: Number(x.intentos ?? 1), como: (x.como as SalidoHoy['como']) ?? null, cuando: txt(x.cambiado_en) ?? '',
  }
}

export type FilaHoy = { entryId: string; hora: string; numero: string; concepto: string; tono: 'verde' | 'gris' | 'ambar'; estado: string; como: string }

/** La hora en Madrid; sin hora (o una que no lo es), «—»: una fila rara nunca tumba la pantalla. */
const hora = (iso: string | null | undefined) => {
  const d = new Date(iso ?? '')
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(d)
}

/** Lo que no ha salido, arriba (lo más reciente primero); después lo de hoy, de lo más reciente a lo más antiguo. Nada se esconde (regla 7). */
export function listaDeHoy(xs: readonly SalidoHoy[]): FilaHoy[] {
  const orden = (x: SalidoHoy) => (x.estado === 'no_pudo' ? 0 : x.estado === 'enviando' ? 1 : 2)
  return [...xs].sort((a, b) => orden(a) - orden(b) || String(b.cuando ?? '').localeCompare(String(a.cuando ?? ''))).map((x) => ({
    entryId: x.entryId, hora: hora(x.cuando), numero: x.numero, concepto: x.concepto,
    tono: x.estado === 'en_erp10' ? 'verde' : x.estado === 'no_pudo' ? 'ambar' : 'gris',
    estado: x.estado === 'en_erp10' ? `En ERP10 · asiento ${x.documento}` : x.estado === 'enviando' ? 'Saliendo a ERP10…' : `No ha salido: ${sinPunto(x.motivo ?? 'sin motivo')}`,
    como: x.como === 'sola' ? 'Sola' : x.como === 'a_mano' ? 'A mano' : x.como === 'excel' ? 'Con el Excel' : '—',
  }))
}

/** La frase de la barra de abajo: lo que lleva más de una hora validado sin salir (o null si no hay nada). */
export function fraseAtascados(n: number): { fuerte: string; resto: string } | null {
  if (n <= 0) return null
  return { fuerte: `${n} ${n === 1 ? 'asiento' : 'asientos'}`, resto: `${n === 1 ? 'lleva' : 'llevan'} más de una hora sin salir a ERP10` }
}
