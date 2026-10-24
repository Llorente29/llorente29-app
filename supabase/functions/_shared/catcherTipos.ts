// supabase/functions/_shared/catcherTipos.ts
//
// E05 · Las formas de la quincena de Catcher que comparten el front
// (src/modules/conta/lib/catcherQuincena.ts) y el servidor (conta-lote-releer):
// aquí, para que los dos lean y crucen con el mismo código.

export type TipoFactura = 'rider' | 'flota' | 'catcher'

/** Una fila de la hoja Invoices, con los nombres de Folvy. */
export type FacturaExcel = {
  numero: string
  base: number; cuota: number; total: number
  emisor: { nombre: string; nif: string | null; domicilio: string | null }
  destinatario: { nombre: string; nif: string | null; domicilio: string | null }
  pedidos: number | null
  desde: string | null; hasta: string | null
  fecha: string | null
}
/** Cuánto de una factura es de cada tienda (Amounts By Partners / Commissions By Partners). */
export type PorTienda = { tienda: string; total: number; pedidos: number | null; nif: string | null; nombre: string | null; tipo: string | null }
/** Una fila de PEDIDOS. `momento`: ISO con la hora de Madrid ya pasada a UTC. */
export type PedidoExcel = { factura: string; tipo: string; codigo: string; estado: string; momento: string | null; base: number; cuota: number; total: number }

export type Comprobacion = { id: string; ok: boolean; texto: string }
