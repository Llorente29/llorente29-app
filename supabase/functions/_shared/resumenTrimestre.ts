// supabase/functions/_shared/resumenTrimestre.ts
//
// P01 · «Enviar resumen a los clientes»: lo que no necesita red, para probarlo
// (tests/unit/modules/conta/p01/resumenTrimestre.test.ts, contra la respuesta
// REAL de conta_despacho_trimestre en staging). Lo usa conta-asesoria
// (acción «resumen») y la plantilla resumen_trimestre de send-email.
//
// Sin dependencias: corre igual en Deno y en vitest.

/** Lo que trae conta_despacho_trimestre de cada modelo (solo lo que usa el resumen). */
export interface ModeloDelTrimestre {
  modelo: string
  nombre: string
  periodo: string
  cadencia: string
  estado: string
  resultado: string | null
  importe: number | null
  plazo_suyo: string | null
  presentada: string | null
}

/** Lo que trae conta_despacho_trimestre de cada cliente (solo lo que usa el resumen). */
export interface ClienteDelTrimestre {
  empresa: string
  nombre: string
  razon_social: string | null
  modelos: ModeloDelTrimestre[]
  a_ingresar: number | null
  a_compensar: number | null
  siguiente_paso: string | null
}

/** Una fila del correo: todo ya en texto, para que la plantilla solo escape y pinte. */
export interface FilaResumen {
  modelo: string
  estado: string
  importe: string
  plazo: string
}

/** Los datos de la plantilla resumen_trimestre (send-email). */
export interface DatosResumen {
  asesoria: string
  cliente: string
  trimestre: string
  filas: FilaResumen[]
  aIngresar: string | null
  aCompensar: string | null
  siguiente: string | null
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «3.er trimestre 2026», como la pantalla. */
export function nombreDelTrimestre(ejercicio: number, periodo: string): string {
  const n = Number(periodo.replace(/\D/g, ''))
  const ord = n === 1 ? '1.er' : n === 2 ? '2.º' : n === 3 ? '3.er' : '4.º'
  return `${ord} trimestre ${ejercicio}`
}

/** «2026-10-20» → «20/10». */
export function ddmm(fecha: string | null | undefined): string {
  if (!fecha) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  return m ? `${m[3]}/${m[2]}` : '—'
}

/** 4902.1 → «4.902,10 €» (es-ES, siempre dos decimales; sin Intl para que salga igual en todas partes). */
export function euros(n: number): string {
  const [ent, dec] = Math.abs(n).toFixed(2).split('.')
  return `${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec} €`
}

/** El periodo de un modelo, para quien no sabe de impuestos: los mensuales, su mes; el 202, su pago. */
function periodoDe(m: ModeloDelTrimestre): string {
  if (m.cadencia === 'monthly' && /^\d{2}$/.test(m.periodo)) return ` de ${MESES[Number(m.periodo) - 1] ?? m.periodo}`
  if (m.modelo === '202') return m.periodo === '1P' ? ' (1.er pago)' : m.periodo === '2P' ? ' (2.º pago)' : m.periodo === '3P' ? ' (3.er pago)' : ''
  return ''
}

/** El estado, en palabras del cliente (no las de la asesoría). */
export function estadoParaElCliente(m: ModeloDelTrimestre): string {
  switch (m.estado) {
    case 'presentado': {
      const f = m.presentada ? ddmm(m.presentada) : null
      return f && f !== '—' ? `Presentado el ${f}` : 'Presentado'
    }
    case 'listo': return 'Revisado; lo presentamos en plazo'
    case 'por_calcular': return 'Aún sin calcular'
    default: return 'Lo estamos revisando'
  }
}

/** El importe con lo que significa: a ingresar, a compensar, a devolver o sin importe. */
export function importeParaElCliente(m: ModeloDelTrimestre): string {
  if (m.importe === null || m.importe === undefined || m.resultado === null) return '—'
  switch (m.resultado) {
    case 'to_pay': return `${euros(m.importe)} a ingresar`
    case 'to_offset': return `${euros(m.importe)} a compensar`
    case 'to_refund': return `${euros(m.importe)} a devolver`
    case 'zero': return 'Sin importe'
    default: return euros(m.importe)
  }
}

/** Los datos del correo de UN cliente. */
export function datosDelResumen(asesoria: string, ejercicio: number, periodo: string, c: ClienteDelTrimestre): DatosResumen {
  return {
    asesoria,
    cliente: (c.razon_social ?? '').trim() || c.nombre,
    trimestre: nombreDelTrimestre(ejercicio, periodo),
    filas: c.modelos.map((m) => ({
      modelo: `${m.modelo} · ${m.nombre}${periodoDe(m)}`,
      estado: estadoParaElCliente(m),
      importe: importeParaElCliente(m),
      plazo: m.estado === 'presentado' ? '—' : ddmm(m.plazo_suyo),
    })),
    aIngresar: c.a_ingresar !== null && c.a_ingresar !== undefined && c.a_ingresar > 0 ? euros(c.a_ingresar) : null,
    aCompensar: c.a_compensar !== null && c.a_compensar !== undefined && c.a_compensar > 0 ? euros(c.a_compensar) : null,
    siguiente: (c.siguiente_paso ?? '').trim() || null,
  }
}

/** Cómo acabó el envío de cada cliente. */
export type Resultado =
  | { cliente: string; como: 'enviado'; a: number }
  | { cliente: string; como: 'sin_correo' }
  | { cliente: string; como: 'cerrado'; motivo: string }
  | { cliente: string; como: 'fallo'; motivo: string }

const y = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)
const clientes = (n: number) => `${n} ${n === 1 ? 'cliente' : 'clientes'}`

/**
 * La frase que ve la asesoría al terminar (regla 8: con contenido, no un
 * «hecho»). Un cliente «cerrado» es uno que el freno de send-email ha parado
 * (cerrado del todo, o abierto solo para la prueba de Julio). `fuera`: los
 * elegidos que ya no salen en el trimestre (sin permiso): no se nombran,
 * porque quien pide ya no los puede ver.
 */
export function mensajeDelEnvio(resultados: Resultado[], fuera = 0): { ok: boolean; mensaje: string } {
  const enviados = resultados.filter((r) => r.como === 'enviado')
  const sin = resultados.filter((r) => r.como === 'sin_correo').map((r) => r.cliente)
  const cerrados = resultados.filter((r): r is Extract<Resultado, { como: 'cerrado' }> => r.como === 'cerrado')
  const fallos = resultados.filter((r): r is Extract<Resultado, { como: 'fallo' }> => r.como === 'fallo')
  const partes: string[] = []
  if (enviados.length === 0 && cerrados.length > 0) {
    partes.push(`${cerrados[0].motivo} Cuando se abra, cada cliente elegido recibirá el resumen de su trimestre y sus respuestas llegarán a tu correo.`)
  } else {
    partes.push(enviados.length > 0 ? `Mandado el resumen a ${clientes(enviados.length)}: ${y(enviados.map((r) => r.cliente))}.` : 'No se ha mandado ningún resumen.')
    if (cerrados.length > 0) partes.push(`Cerrado todavía para ${y(cerrados.map((r) => r.cliente))}: ${cerrados[0].motivo}`)
  }
  if (sin.length > 0) partes.push(`Sin nadie a quien mandárselo (su cuenta no tiene administración con correo): ${y(sin)}.`)
  if (fuera > 0) partes.push(`${fuera === 1 ? 'Uno de los elegidos ya no te da' : `${fuera} de los elegidos ya no te dan`} permiso o no está en este trimestre: a ${fuera === 1 ? 'ese' : 'esos'} no se les ha mandado.`)
  if (fallos.length > 0) partes.push(`No ha salido: ${fallos.map((f) => `${f.cliente} (${f.motivo})`).join('; ')}.`)
  return { ok: enviados.length > 0 && sin.length + fuera + fallos.length + cerrados.length === 0, mensaje: partes.join(' ') }
}

/** Lo que pide la pantalla, validado. */
export interface PedidoResumen { cuenta: string; ejercicio: number; periodo: string; empresas: string[]; hoy: string | null }
export function leerResumen(b: Record<string, unknown> | null): { ok: true; p: PedidoResumen } | { ok: false; mensaje: string } {
  const cuenta = String(b?.cuenta ?? '')
  const ejercicio = Number(b?.ejercicio)
  const periodo = String(b?.periodo ?? '')
  const empresas = Array.isArray(b?.empresas) ? (b!.empresas as unknown[]).map(String) : []
  const hoy = typeof b?.hoy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.hoy) ? b.hoy : null
  if (!/^[0-9a-f-]{36}$/i.test(cuenta)) return { ok: false, mensaje: 'Falta la cuenta de la asesoría.' }
  if (!Number.isInteger(ejercicio) || ejercicio < 2000 || ejercicio > 2100 || !/^[1-4]T$/.test(periodo)) return { ok: false, mensaje: 'Elige un trimestre: 1T, 2T, 3T o 4T de un año.' }
  if (empresas.length === 0) return { ok: false, mensaje: 'Elige al menos un cliente.' }
  if (empresas.length > 200) return { ok: false, mensaje: 'Como mucho 200 clientes de una vez.' }
  if (empresas.some((e) => !/^[0-9a-f-]{36}$/i.test(e))) return { ok: false, mensaje: 'Algún cliente no es válido.' }
  return { ok: true, p: { cuenta, ejercicio, periodo, empresas: [...new Set(empresas)], hoy } }
}

