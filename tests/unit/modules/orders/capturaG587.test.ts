// CAPTURA del G587: imprime por pantalla el ticket de cocina, el de bolsa y las
// pegatinas tal y como saldrian por la impresora. No es una prueba de nada: es
// el papel, para poder mirarlo al lado de como sale hoy.
//
//   npx vitest run tests/unit/modules/orders/capturaG587.test.ts
//
// Datos REALES de la venta a6750ed3-0a6e-46fa-b982-5044f4ba56ff (Alcala · Dos
// Coyotes · Glovo 101780066538 · 21/09/2026 16:06), copiados de sale_line el
// 22/09. El MISMO fichero se corre en las dos ramas y se comparan las salidas:
// misma vara a los dos lados.
import { describe, it, expect } from 'vitest'
import { renderKitchenTicket, renderBagTicket, renderLabels } from '../../../../src/modules/orders/lib/ticketRenderer'
import type { TicketDoc, TicketBlock } from '../../../../src/modules/orders/lib/ticketRenderer'

const hijo = (name: string, qty: number, family: string | null = null) => ({
  line_id: 'h-' + name, name, qty, line_type: 'combo_item', group_type: null,
  menu_item_id: null, family, family_color: null, menu_category: null, customer_note: null,
})

const G587: any = {
  sale_id: 'a6750ed3-0a6e-46fa-b982-5044f4ba56ff',
  platform_order_code: '101780066538', pos_short_code: 'G587', platform_order_ref: null,
  external_ref: null, external_tab_ref: null, order_status: 'accepted', status: 'open',
  service_type: 'delivery', source: 'glovo', brand: 'Dos Coyotes', brand_logo_url: null,
  brand_color: null, brand_shop_url: null, brand_qr_caption: null, brand_ownership_type: 'own',
  channel: 'Glovo', channel_id: null, customer_name: 'Cliente Glovo', customer_phone: null,
  delivery_address: null, expected_time: null, customer_note: null,
  total: 62.86, paid: null, payment_method: null, discount_amount: null, delivery_cost: null,
  entro_at: '2026-09-21T14:06:41Z', minutos: 0,
  lineas: [{
    line_id: 'da161c0d-dd98-444f-96da-d1f2621e0346', name: 'PACK PA 2  DC', qty: 2,
    menu_item_id: null, unit_price: 31.43, line_total: 62.86, marked: false, allergens: [],
    family: null, family_color: null, family_icon: null, menu_category: null,
    has_recipe: false, customer_note: null,
    children: [
      hijo('QUESATACOS DE BIRRIA DE POLLO (DC)', 1),
      hijo('QUESATACOS DE TERNERA (DC)', 1),
      hijo('QUESADILLA DOS COYOTES (DC)', 1),
      hijo('Coca Cola', 2, 'Bebidas sin alcohol'),
    ],
  }],
}

function pinta(b: TicketBlock): string {
  const x = b as any
  switch (x.kind) {
    case 'text':   return '  ' + x.text
    case 'row':    return '  ' + x.left + (x.right ? '   ' + x.right : '')
    case 'banner': return '  [' + x.text + ']'
    case 'rule':   return '  ' + '-'.repeat(40)
    case 'space':  return ''
    case 'qr':     return '  (QR)'
    case 'cut':    return '  ' + '='.repeat(40)
    default:       return '  ?'
  }
}
const doc = (d: TicketDoc) => `### ${d.title}\n` + d.blocks.map(pinta).join('\n')

describe('CAPTURA G587', () => {
  it('imprime el papel', () => {
    const out: string[] = []
    out.push('======== G587 · TICKET DE COCINA ========', doc(renderKitchenTicket(G587)))
    out.push('', '======== G587 · TICKET DE BOLSA ========', doc(renderBagTicket(G587)))
    const labels = renderLabels(G587)
    out.push('', `======== G587 · PEGATINAS: ${labels.length} ========`)
    for (const l of labels) out.push(doc(l))
    console.log('\n' + out.join('\n'))
    expect(labels.length).toBeGreaterThan(0)
  })
})
