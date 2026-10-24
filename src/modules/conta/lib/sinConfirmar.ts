// src/modules/conta/lib/sinConfirmar.ts
//
// C11b (Julio, 23/10): el cierre del día cierra como vendidos los pedidos de
// plataforma que siguen abiertos a su hora (salvo los que la plataforma
// cancela, rechaza o no entrega). Si después llega la liquidación de su canal
// y no trae ese pedido cobrado, se avisa para hacer el ajuste: el aviso que
// enseña «Proponer asientos», con lo que hay que mirar.

export interface SinConfirmarNoCobrado {
  codigo: string | null
  dia: string            // AAAA-MM-DD
  total: number
  canal: string
  liquidacion: string | null
  fechaLiquidacion: string | null
}

const fecha = (d: string) => d.split('-').reverse().join('/')
const euros = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)

/** El aviso de un pedido cerrado sin confirmar que su liquidación no cobra. */
export function avisoSinConfirmar(x: SinConfirmarNoCobrado): { que: string; porque: string } {
  const liq = x.liquidacion ? `la liquidación ${x.liquidacion}${x.fechaLiquidacion ? ` del ${fecha(x.fechaLiquidacion)}` : ''}` : 'su liquidación'
  return {
    que: `Pedido ${x.codigo ?? 'sin código'} de ${x.canal} del ${fecha(x.dia)} (${euros(x.total)}), cerrado sin confirmar`,
    porque: `Se cerró como vendido al cierre del día sin confirmación de ${x.canal}, y ${liq} no lo trae cobrado. Haz el ajuste (devolución) si no se cobró, o descártalo si se cobró por otro lado.`,
  }
}
