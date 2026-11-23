// src/modules/conta/nucleo/bancos/conciliar.ts
//
// E05 · Bancos del núcleo: confirmar y deshacer, LO MISMO que la pantalla de hoy
// (regla 31; encargo E05 · 2). La pantalla de hoy lo hace dentro de su componente
// (bancos/Movimientos.tsx: confirmarPropuesta y deshacer; X28: sin «confirmar varios») y las
// reglas comunes no dejan tocarla; aquí está, para la pantalla nueva, con las
// MISMAS llamadas al motor (services/bancosService · nucleo: confirmar, deshacer,
// conciliarPendientes) y en el mismo orden:
//   · una propuesta calculada con otro motor no se acepta: se vuelve a calcular
//     y se dice (PROPUESTA_RECALCULADA);
//   · confirmar: nucleo.confirmar(id, porqué, destino, confianza, regla);
//   · deshacer: nucleo.deshacer(casado, motivo).
// La única diferencia es el texto del motivo al deshacer, que dice desde dónde
// («Deshecho desde Bancos (pantallas nuevas)»): queda en el historial del casado.
// Lo que confirma y lo que deshace lo mide la e2e contra la base (mismo casado y
// mismo asiento que desde la pantalla de hoy).

import { bancos as nucleo } from '@/modules/conta/services/bancosService'
import { MOTOR_BANCOS, type Destino } from '@/modules/conta/lib/conciliacion'
import { PROPUESTA_RECALCULADA, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { guardarRegla, type FacturaPendiente } from '@/modules/conta/services/bancosPantallas'
import { casadoConFactura, cobroConFactura, emitidasDeLosClientes, type FacturaEmitidaPendiente } from './factura'

export const MOTIVO_DESHACER = 'Deshecho desde Bancos (pantallas nuevas)'

export interface Contexto { accountId: string; companyId: string; hoy: string }

/** Confirmar la propuesta de un movimiento (Intro, «Sí, es ese pago»). */
export async function confirmarPropuesta(c: Contexto, m: MovimientoBanco): Promise<void> {
  const p = m.propuesta!
  if (p.motor !== MOTOR_BANCOS) {
    await nucleo.conciliarPendientes(c.accountId, c.companyId, c.hoy)
    throw new Error(PROPUESTA_RECALCULADA)
  }
  await nucleo.confirmar(m.id, m.porque ?? p.que ?? 'Confirmado', p.destino as unknown as Destino, (m.confianza ?? 'probable'), p.reglaId ?? null)
}

/** Deshacer lo casado: vuelve a estar sin casar y su asiento se quita (o se anula, si estaba validado). */
export async function deshacerCasado(m: MovimientoBanco): Promise<string> {
  if (!m.casado) throw new Error('Este movimiento no está casado: no hay nada que deshacer.')
  // bank_deshacer dice qué ha hecho con el asiento: «su asiento propuesto se quita», «… se anula con un
  // contraasiento» o «el asiento enlazado se queda como estaba» (uno escrito a mano, por ejemplo).
  return nucleo.deshacer(m.casado.id, MOTIVO_DESHACER)
}

/**
 * «O es otra cosa»: una de las alternativas que da el motor, como el panel de hoy
 * (PanelMovimiento: nucleo.confirmar(id, «Lo dijiste tú: …», destino, 'probable', null)).
 */
export async function casarConAlternativa(m: MovimientoBanco, a: { etiqueta: string; destino: Record<string, unknown> }): Promise<string> {
  await nucleo.confirmar(m.id, `Lo dijiste tú: ${a.etiqueta}.`, a.destino as unknown as Destino, 'probable', null)
  return `Conciliado: ${a.etiqueta} · en el diario.`
}

/**
 * «O es otra cosa» a una cuenta (la comisión del banco, u otra con F4), como
 * «Decir la cuenta» de hoy (Movimientos.elegirCuenta): el destino «cuenta» por el
 * importe sin signo. Con «Hacerlo solo la próxima vez que pase igual», guarda la
 * regla de hoy (bank_regla_guardar: lo que tenga ese texto, con su signo, a esa cuenta).
 */
export async function casarConCuenta(companyId: string, m: MovimientoBanco, c: { cuenta: string; nombre: string; concepto: string; regla: string | null }): Promise<string> {
  const nombre = `${c.nombre} · ${c.cuenta}`
  const destino: Destino = { tipo: 'cuenta', concepto: c.concepto, lineas: [{ cuenta: c.cuenta, importe: Math.abs(m.importeCent) / 100 }] }
  await nucleo.confirmar(m.id, `Lo dijiste tú: ${nombre}.`, destino, 'probable', null)
  if (c.regla) {
    await guardarRegla(companyId, { palabras: `Cuando el concepto tenga «${c.regla}» → ${nombre}`, contiene: c.regla, cuenta: c.cuenta, signo: m.importeCent < 0 ? -1 : 1, origen: 'persona' })
    return `Conciliado con ${nombre} · en el diario. Y desde ahora, lo que tenga «${c.regla}» saldrá ahí: está en Reglas.`
  }
  return `Conciliado con ${nombre} · en el diario.`
}

/** Lo que dice «Deshacer» al acabar (respuesta E05 · 1, punto 5): qué se ha deshecho, con lo que dice la base del asiento. */
export const textoDeshecho = (quien: string, asiento: string): string =>
  `Deshecho: el movimiento de ${quien} vuelve a estar por conciliar${asiento ? `, y ${asiento}` : ''}.`

/**
 * «Es otra factura» (E05b): casa el pago con la factura elegida con la MISMA llamada que
 * elegirFactura de hoy (nucleo.confirmar con su destino «factura_recibida», «probable», sin regla)
 * y dice lo mismo.
 */
export async function casarConFactura(m: MovimientoBanco, f: FacturaPendiente, quien: string): Promise<string> {
  const c = casadoConFactura(m, f)
  await nucleo.confirmar(m.id, c.porque, c.destino, 'probable', null)
  return `Conciliado: ${c.concepto} (${quien}) · en el diario. ${c.importeCent < f.pendienteCent ? `A la factura le quedan ${eurosExactos((f.pendienteCent - c.importeCent) / 100)} por pagar.` : 'La factura queda pagada.'}`
}

/** E05c · Las facturas emitidas con algo por cobrar, como las ve el motor (nucleo.cargarContexto). */
export async function facturasEmitidasPendientes(accountId: string, companyId: string, hoy: string): Promise<FacturaEmitidaPendiente[]> {
  const { ctx } = await nucleo.cargarContexto(accountId, companyId, hoy)
  return emitidasDeLosClientes(ctx.clientes)
}

/**
 * E05c · «Es otra factura» en un cobro: lo casa con la emitida elegida, con la misma llamada
 * que los pagos (nucleo.confirmar, «probable», sin regla) y el destino del motor; y dice lo que ha hecho.
 */
export async function casarConEmitida(m: MovimientoBanco, f: FacturaEmitidaPendiente, quien: string): Promise<string> {
  const c = cobroConFactura(m, f)
  await nucleo.confirmar(m.id, c.porque, c.destino, 'probable', null)
  const sobra = Math.abs(m.importeCent) - c.importeCent
  return `Cobrado: ${c.concepto} (${quien}) · en el diario. ${c.importeCent < f.pendienteCent ? `A la factura le quedan ${eurosExactos((f.pendienteCent - c.importeCent) / 100)} por cobrar.` : 'La factura queda cobrada.'}${sobra > 0 ? ` Sobran ${eurosExactos(sobra / 100)}: quedan a favor del cliente en su cuenta.` : ''}`
}
