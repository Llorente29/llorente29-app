// src/modules/conta/nucleo/bancos/factura.ts
//
// E05b · «Es otra factura» dentro de la pantalla nueva (respuesta E05 · 3): qué
// facturas se ofrecen y con qué destino se casa. La lista es la de la pantalla de
// hoy (bancos/dialogos.tsx, DialogoFactura: bank_facturas_recibidas_pendientes,
// ordenadas por lo cerca que queda lo pendiente del importe) y el destino, el de
// su elegirFactura (bancos/Movimientos.tsx), tal cual.
//
// E05c (respuesta E05 · 4): también los cobros, con sus facturas emitidas. La lista
// es la que ve el motor (nucleo.cargarContexto: los clientes con saldo en su 430,
// sin las plataformas, y sus emitidas con algo por cobrar) y el destino, el que arma
// el motor para un cobro de cliente (conciliacion.ts, «factura_emitida»: la 430 por
// todo el ingreso y la factura por lo que le queda). Núcleo puro.

import { nombra, type Cliente, type Destino } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import type { FacturaPendiente } from '@/modules/conta/services/bancosPantallas'

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Las facturas que se ofrecen: las del proveedor que nombra el movimiento (su
 * contraparte o lo que dice el banco); si no nombra a ninguno, todas. Con lo
 * escrito, las que lo llevan en el proveedor o el número. La más cercana al
 * importe, primero (como hoy).
 */
export function facturasQueEncajan(m: MovimientoBanco, facturas: readonly FacturaPendiente[], escrito: string): FacturaPendiente[] {
  const texto = `${m.contraparte ?? ''} ${m.conceptoLimpio} ${m.conceptoBanco}`
  const suyas = facturas.filter((f) => nombra(texto, [f.proveedor]))
  const base = suyas.length ? suyas : facturas
  const t = normal(escrito.trim())
  const importe = Math.abs(m.importeCent)
  return base.filter((f) => !t || normal(`${f.proveedor} ${f.numero ?? ''}`).includes(t))
    .sort((a, b) => Math.abs(a.pendienteCent - importe) - Math.abs(b.pendienteCent - importe))
}

/** El destino y los textos del casado con esa factura: los de elegirFactura de hoy. */
export function casadoConFactura(m: MovimientoBanco, f: FacturaPendiente): { destino: Destino; porque: string; concepto: string; importeCent: number } {
  const importe = Math.min(Math.abs(m.importeCent), f.pendienteCent) / 100
  const concepto = `Pago de la factura ${f.numero ?? ''} de ${f.proveedor}`.replace(/\s+/g, ' ')
  const destino: Destino = { tipo: 'factura_recibida', facturas: [{ id: f.id, importe }], cuenta_tercero: f.cuentaTercero ?? '', tercero_id: f.terceroId, concepto }
  return { destino, porque: `Lo dijiste tú: paga la factura ${f.numero ?? ''} de ${f.proveedor}.`, concepto, importeCent: Math.round(importe * 100) }
}

/** Una factura emitida con algo por cobrar, con su cliente y su 430 (lo que ve el motor). */
export interface FacturaEmitidaPendiente {
  id: string; numero: string | null; fecha: string; pendienteCent: number
  cliente: string; alias: string[]; cuenta430: string; terceroId: string | null
}

/** Las facturas de los clientes del motor, una lista. */
export const emitidasDeLosClientes = (clientes: readonly Cliente[]): FacturaEmitidaPendiente[] =>
  clientes.flatMap((c) => (c.facturas ?? []).map((f) => ({ ...f, cliente: c.nombre, alias: c.alias, cuenta430: c.cuenta, terceroId: c.terceroId })))

/** Las emitidas que se ofrecen a un cobro: las del cliente que nombra el banco; si no nombra a ninguno, todas. La más cercana al importe, primero. */
export function emitidasQueEncajan(m: MovimientoBanco, facturas: readonly FacturaEmitidaPendiente[], escrito: string): FacturaEmitidaPendiente[] {
  const texto = `${m.contraparte ?? ''} ${m.conceptoLimpio} ${m.conceptoBanco}`
  const suyas = facturas.filter((f) => nombra(texto, [f.cliente, ...f.alias]))
  const base = suyas.length ? suyas : facturas
  const t = normal(escrito.trim())
  const importe = Math.abs(m.importeCent)
  return base.filter((f) => !t || normal(`${f.cliente} ${f.numero ?? ''}`).includes(t))
    .sort((a, b) => Math.abs(a.pendienteCent - importe) - Math.abs(b.pendienteCent - importe))
}

/**
 * El casado del cobro con esa factura: el destino «factura_emitida» del motor. La 430
 * del cliente se lleva todo el ingreso (bank_casar pide que las líneas sumen el
 * movimiento: si paga de más, queda a su favor en la 430); la factura, lo que le queda
 * como mucho (la base no deja pasarse).
 */
export function cobroConFactura(m: MovimientoBanco, f: FacturaEmitidaPendiente): { destino: Destino; porque: string; concepto: string; importeCent: number } {
  const ingreso = Math.abs(m.importeCent)
  const cobra = Math.min(ingreso, f.pendienteCent)
  const concepto = `Cobro de la factura ${f.numero ?? ''} de ${f.cliente}`.replace(/\s+/g, ' ')
  const destino: Destino = { tipo: 'factura_emitida', tercero_id: f.terceroId, concepto,
    lineas: [{ cuenta: f.cuenta430, importe: ingreso / 100 }], facturas: [{ id: f.id, importe: cobra / 100 }] }
  return { destino, porque: `Lo dijiste tú: cobra la factura ${f.numero ?? ''} de ${f.cliente}.`, concepto, importeCent: cobra }
}
