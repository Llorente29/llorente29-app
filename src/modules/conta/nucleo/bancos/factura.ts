// src/modules/conta/nucleo/bancos/factura.ts
//
// E05b · «Es otra factura» dentro de la pantalla nueva (respuesta E05 · 3): qué
// facturas se ofrecen y con qué destino se casa. La lista es la de la pantalla de
// hoy (bancos/dialogos.tsx, DialogoFactura: bank_facturas_recibidas_pendientes,
// ordenadas por lo cerca que queda lo pendiente del importe) y el destino, el de
// su elegirFactura (bancos/Movimientos.tsx), tal cual. Solo para pagos: hoy no hay
// forma de casar a mano un cobro con una factura emitida. Núcleo puro.

import { nombra, type Destino } from '@/modules/conta/lib/conciliacion'
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
