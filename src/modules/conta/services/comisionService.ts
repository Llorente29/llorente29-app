// src/modules/conta/services/comisionService.ts
//
// S01i · La factura de comisión de una plataforma y su liquidación. Lo decide
// la base, por la cuenta de la factura (regla 9). Nombres comprobados contra
// la 0050 (regla 40): conta_comision_de_la_factura(p_invoice) y
// conta_comision_ligar(p_invoice, p_settlement, p_quien_nombre).
import { rpc } from '@/modules/conta/services/bd'
import { estadoComision, type EstadoComision } from '@/modules/conta/documentos/comision'

export async function leerComision(invoiceId: string): Promise<EstadoComision> {
  return estadoComision(await rpc<unknown>('conta_comision_de_la_factura', { p_invoice: invoiceId }))
}

/** Liga la factura con la liquidación que elige la persona; si está validada, queda pagada por compensación. */
export async function ligarComision(invoiceId: string, settlementId: string, quien: string | null): Promise<{ texto: string; pagada: boolean }> {
  const r = await rpc<{ texto?: string; pagada?: boolean }>('conta_comision_ligar', { p_invoice: invoiceId, p_settlement: settlementId, p_quien_nombre: quien })
  return { texto: r?.texto ?? 'Ligada con su liquidación.', pagada: r?.pagada === true }
}
