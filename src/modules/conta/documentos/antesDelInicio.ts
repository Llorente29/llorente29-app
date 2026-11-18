// src/modules/conta/documentos/antesDelInicio.ts
//
// N03 · Una factura de antes del día en que la empresa empezó en Sumied: Sumied para y
// pregunta (Julio, 17/11). Lo que la pantalla dice, sin React ni red. El texto de la
// ventana es el aprobado por Julio: no se cambia ni una palabra.
//
//   **Esta factura es del 14/10/2026, y esta empresa empezó en Sumied el 01/11/2026.**
//   ¿Ya estaba contabilizada en ERP10?
//   [Sí, ya estaba] · [No, es nueva]
//
// El programa sale del de la empresa (la base: _conta_programa_de_antes): «ERP10», «Diez»;
// con otro, o sin programa, «en el programa de antes».

/** Lo que devuelve conta_recibida_antes_del_inicio (0955). */
export interface AntesDelInicio {
  /** Hay que preguntar: de antes del inicio, sin respuesta, sin asiento y sin traída gemela. */
  preguntar: boolean
  /** La fecha de la factura (AAAA-MM-DD). */
  fecha: string | null
  /** El día en que la empresa empezó en Sumied (AAAA-MM-DD), o nulo. */
  diaInicio: string | null
  /** «ERP10», «Diez» o nulo (el programa de antes). */
  programa: string | null
  respuesta: 'ya_estaba' | 'es_nueva' | null
  respondidaPor: string | null
  /** Cuándo se contestó (ISO). */
  respondidaEl: string | null
  tieneAsiento: boolean
  /** La gemela que ya vino con lo traído (mismo NIF y número). */
  traida: { id: string; numero: string | null; fecha: string | null } | null
}

/** De la base a la pantalla. Nada que no venga se inventa. */
export function deLaBase(x: unknown): AntesDelInicio {
  const o = (x ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  const t = (o.traida ?? null) as Record<string, unknown> | null
  const r = s(o.respuesta)
  return {
    preguntar: o.preguntar === true,
    fecha: s(o.fecha)?.slice(0, 10) ?? null,
    diaInicio: s(o.dia_inicio)?.slice(0, 10) ?? null,
    programa: s(o.programa),
    respuesta: r === 'ya_estaba' || r === 'es_nueva' ? r : null,
    respondidaPor: s(o.respondida_por),
    respondidaEl: s(o.respondida_el),
    tieneAsiento: o.tiene_asiento === true,
    traida: t && s(t.id) ? { id: String(t.id), numero: s(t.numero), fecha: s(t.fecha)?.slice(0, 10) ?? null } : null,
  }
}

/** 14/10/2026: las fechas como las escribe la gente. */
export const fechaDeGente = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

/** «en ERP10», «en Diez» o «en el programa de antes». */
export const enElPrograma = (programa: string | null): string => (programa ? `en ${programa}` : 'en el programa de antes')

/** La ventana, palabra por palabra. */
export function laPregunta(a: Pick<AntesDelInicio, 'fecha' | 'diaInicio' | 'programa'>): { negrita: string; pregunta: string; si: string; no: string } {
  return {
    negrita: `Esta factura es del ${fechaDeGente(a.fecha)}, y esta empresa empezó en Sumied el ${fechaDeGente(a.diaInicio)}.`,
    pregunta: `¿Ya estaba contabilizada ${enElPrograma(a.programa)}?`,
    si: 'Sí, ya estaba',
    no: 'No, es nueva',
  }
}

/** La etiqueta de la lista (gris: informa, no avisa). */
export const etiquetaYaContabilizada = (programa: string | null | undefined): string => `Ya contabilizada ${enElPrograma(programa ?? null)}`

/** «Sí, ya estaba» (la base da el mismo texto; esto es por si no lo da). */
export const hechoYaEstaba = (programa: string | null): string => `Hecho. No se contabiliza: ya estaba ${enElPrograma(programa)}.`

/** «No, es nueva», ya contabilizada: la fecha del asiento y la de la factura, que no cambia. */
export const hechoEsNueva = (fechaAsiento: string, fechaFactura: string | null): string =>
  `Contabilizada el ${fechaDeGente(fechaAsiento)}. La fecha de la factura sigue siendo el ${fechaDeGente(fechaFactura)}.`

/** Ya vino con lo traído: no se pregunta, se dice cuál es. */
export const yaVinoTraida = (programa: string | null): string =>
  `Esta factura ya está: vino con lo traído de ${programa ?? 'el programa de antes'}`

/** La marca de la ficha: quién lo dijo y cuándo. */
export function marcaDeLaFicha(a: Pick<AntesDelInicio, 'programa' | 'respondidaPor' | 'respondidaEl'>): string {
  const cuando = a.respondidaEl ? fechaDeGente(new Date(a.respondidaEl).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })) : ''
  const quien = [a.respondidaPor, cuando].filter(Boolean).join(', ')
  return `${etiquetaYaContabilizada(a.programa)}: no se contabiliza en Sumied${quien ? ` (${quien})` : ''}.`
}
