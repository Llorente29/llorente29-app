// src/modules/conta/lib/verifactu/estado.ts
//
// V03 · Entrega 2 · LO QUE SE VE DE VERIFACTU, sin React (tableros 25, 26 y 27):
//   · la columna «Hacienda» de Facturas y su etiqueta, de verifactu_factura_estado;
//   · las cuatro cifras de arriba: emitidas en el mes, las que Hacienda tiene,
//     las que hay que mirar y las que se están enviando (con por qué tardan);
//   · por qué la rechazó Hacienda, en palabras de la calle, y qué se hace;
//   · «Cómo va con Hacienda»: la línea de tiempo de una factura;
//   · desde cuándo obliga (sociedad o persona) y los otros programas.
// La base decide (la cola, el reenvío, el candado); esto solo lo cuenta.

export type EstadoHacienda = 'pendiente' | 'enviando' | 'correcto' | 'aceptado_con_errores' | 'incorrecto' | 'no_se_envia'
export type ModoVerifactu = 'apagado' | 'pruebas' | 'real'

export interface EstadoFactura {
  invoiceId: string
  estado: EstadoHacienda
  entorno: 'pruebas' | 'real' | null
  codigo: number | null
  descripcion: string | null
  generado: string | null
  respondido: string | null
  intentos: number
  proximoIntento: string | null
  urlQr: string | null
}

/** La etiqueta de la columna «Hacienda» (tablero 26): texto suelto o chip, y su tono. */
export function etiquetaHacienda(e: Pick<EstadoFactura, 'estado' | 'codigo'> | null): { texto: string; tono: 'seguro' | 'duda' | 'falta' | 'neutro'; chip: boolean } {
  if (!e) return { texto: '—', tono: 'neutro', chip: false }
  switch (e.estado) {
    case 'correcto': return { texto: '✓ Recibida', tono: 'seguro', chip: false }
    case 'aceptado_con_errores': return { texto: 'Recibida con un aviso', tono: 'duda', chip: true }
    case 'incorrecto': return { texto: esDeUnDato(e.codigo) ? 'Rechazada · falta un dato' : 'Rechazada', tono: 'falta', chip: true }
    case 'pendiente':
    case 'enviando': return { texto: 'Enviando…', tono: 'neutro', chip: true }
    case 'no_se_envia': return { texto: 'No se envía', tono: 'neutro', chip: false }
  }
}

/** Los 1xxx de la lista oficial son errores de un campo del registro (un dato que falta o no vale). */
const esDeUnDato = (codigo: number | null) => codigo !== null && codigo >= 1100 && codigo < 2000

/** Por qué está «Enviando…» (tablero 26: «Hacienda pide esperar entre envíos»). */
export function porQueEnviando(e: Pick<EstadoFactura, 'intentos' | 'proximoIntento'>, ahora: Date): string {
  const proximo = e.proximoIntento ? new Date(e.proximoIntento) : null
  if (e.intentos > 0 && proximo && proximo > ahora) {
    const min = Math.max(1, Math.round((proximo.getTime() - ahora.getTime()) / 60000))
    return `sin conexión con Hacienda: se reenvía sola en ${min} min`
  }
  return 'Hacienda pide esperar unos segundos entre envíos: sale sola'
}

export interface CifrasHacienda {
  emitidas: { n: number; total: number }
  laTiene: number
  mirar: number
  enviando: { n: number; apoyo: string }
}

/**
 * Las cuatro cifras del tablero 26, sobre las emitidas del mes (las de Sumied,
 * con su estado). «Hacienda las tiene» cuenta también las recibidas con un
 * aviso; «Necesita que la mires», las rechazadas.
 */
export function cifrasHacienda(facturas: readonly { id: string; total: number }[], estados: ReadonlyMap<string, EstadoFactura>, ahora: Date): CifrasHacienda {
  let laTiene = 0, mirar = 0, total = 0
  const enviando: EstadoFactura[] = []
  for (const f of facturas) {
    total += Math.round(f.total * 100)
    const e = estados.get(f.id)
    if (!e) continue
    if (e.estado === 'correcto' || e.estado === 'aceptado_con_errores') laTiene++
    else if (e.estado === 'incorrecto') mirar++
    else if (e.estado === 'pendiente' || e.estado === 'enviando') enviando.push(e)
  }
  const reintento = enviando.find((e) => e.intentos > 0)
  return {
    emitidas: { n: facturas.length, total: total / 100 },
    laTiene, mirar,
    enviando: { n: enviando.length, apoyo: enviando.length === 0 ? 'ninguna esperando' : porQueEnviando(reintento ?? enviando[0], ahora) },
  }
}

/** 1195: «Al menos uno de los dos campos OperacionExenta o CalificacionOperacion deben estar informados». */
export const CODIGOS_TIPO_VENTA: readonly number[] = [1195]
/** Un NIF o un nombre que Hacienda no reconoce: 1109, 1110 y 4107 (no está en el censo), 1121 (el ID), 1123 y 4109 (formato), 1189 (sin destinatario), 1222 (el ID de IDOtro). */
export const CODIGOS_NIF: readonly number[] = [1109, 1110, 1121, 1123, 1189, 1222, 4107, 4109]

/** Por qué la rechazó Hacienda, en palabras de la calle (tablero 27), y si se arregla aquí. */
export function porQueRechazo(codigo: number | null, descripcion: string | null): { titulo: string; texto: string; tipoVenta: boolean } {
  // Los códigos, de la lista oficial (docs/conta/v03/aeat/errores.properties): una prueba ata cada uno a su texto.
  if (codigo !== null && CODIGOS_TIPO_VENTA.includes(codigo)) {
    return { titulo: 'Falta decir qué tipo de venta es', texto: 'La factura va sin IVA, y Hacienda necesita saber por qué no lo lleva.', tipoVenta: true }
  }
  if (codigo === 3000) return { titulo: 'Hacienda ya la tenía', texto: 'Ese número de factura ya estaba registrado.', tipoVenta: false }
  if (codigo !== null && CODIGOS_NIF.includes(codigo)) {
    return { titulo: 'Un dato del cliente o de tu empresa no cuadra', texto: 'Hacienda no reconoce un NIF o un nombre. Si es del cliente, la factura se corrige con una rectificativa.', tipoVenta: false }
  }
  return { titulo: 'Hacienda no la ha aceptado', texto: descripcion ? `Dice: «${descripcion}».` : 'No ha dicho por qué.', tipoVenta: false }
}

/** Un registro de la factura, como lo lee la línea de tiempo. */
export interface RegistroLeido {
  id: string
  tipo: 'alta' | 'anulacion'
  subsanacion: boolean
  estado: Exclude<EstadoHacienda, 'no_se_envia'>
  generado: string
  enviado: string | null
  respondido: string | null
  codigo: number | null
  descripcion: string | null
}

export interface PasoHacienda { texto: string; cuando: string | null; tono: 'ok' | 'falta' | 'espera' }

/** «Cómo va con Hacienda» (tablero 27): cada paso con su hora, y lo que falta. */
export function lineaDeTiempo(emitida: string | null, registros: readonly RegistroLeido[]): PasoHacienda[] {
  const pasos: PasoHacienda[] = [{ texto: 'Emitida y comprobada por Sumied', cuando: emitida, tono: 'ok' }]
  const orden = [...registros].sort((a, b) => a.generado.localeCompare(b.generado))
  for (const r of orden) {
    const que = r.tipo === 'anulacion' ? 'Anulación' : r.subsanacion ? 'Reenvío' : 'Enviada a Hacienda'
    if (r.estado === 'pendiente' || r.estado === 'enviando') {
      pasos.push({ texto: `${que}: esperando su turno`, cuando: r.generado, tono: 'espera' })
      continue
    }
    pasos.push({ texto: que, cuando: r.enviado ?? r.generado, tono: 'ok' })
    if (r.estado === 'incorrecto') pasos.push({ texto: `Rechazada: ${porQueRechazo(r.codigo, r.descripcion).titulo.toLowerCase()}`, cuando: r.respondido, tono: 'falta' })
    else pasos.push({ texto: r.estado === 'correcto' ? 'Hacienda la tiene' : 'Hacienda la tiene, con un aviso', cuando: r.respondido, tono: 'ok' })
  }
  const ultima = orden.filter((r) => r.tipo === 'alta').at(-1)
  if (ultima?.estado === 'incorrecto') pasos.push({ texto: 'Reenvío', cuando: null, tono: 'espera' })
  return pasos
}

/**
 * Desde cuándo obliga Verifactu (RD 254/2025): las sociedades (Impuesto sobre
 * Sociedades), el 1 de enero de 2027; el resto (autónomos), el 1 de julio.
 * Por el NIF: una letra delante es una entidad.
 */
export function obligaDesde(nif: string | null): { quien: 'sociedad' | 'persona'; desde: string; texto: string } {
  const sociedad = /^[ABCDEFGHJNPQRSUVW]/i.test((nif ?? '').trim())
  return sociedad
    ? { quien: 'sociedad', desde: '2027-01-01', texto: '1 de enero de 2027' }
    : { quien: 'persona', desde: '2027-07-01', texto: '1 de julio de 2027' }
}

/** Los otros programas con los que se factura (tablero 25), y si cumplen. */
export const OTROS_PROGRAMAS = [
  { id: 'tpv', nombre: 'Un TPV o caja registradora', cumple: 'mira' as const },
  { id: 'tienda', nombre: 'Una tienda online', cumple: 'mira' as const },
  { id: 'excel', nombre: 'Excel, Word o a mano', cumple: 'no' as const },
  { id: 'otro', nombre: 'Otro programa de facturación', cumple: 'mira' as const },
]

/** El aviso de los otros programas, o null si no hay nada que avisar. */
export function avisoOtrosProgramas(elegidos: readonly string[]): { tono: 'falta' | 'duda'; texto: string } | null {
  if (elegidos.includes('excel')) {
    return { tono: 'falta', texto: 'Una factura en Excel, en Word o a mano no cumple desde 2027: hazlas en Sumied (o en un programa que cumpla).' }
  }
  if (elegidos.length) {
    return { tono: 'duda', texto: 'Ese programa también tiene que cumplir Verifactu: pide a quien te lo vende su declaración responsable. Si no la tiene, factura con Sumied.' }
  }
  return null
}
