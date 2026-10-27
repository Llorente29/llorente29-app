// tests/unit/native/print/qrHacienda.test.ts
//
// V04 · PR 2 · El QR de Hacienda en el tique de la bolsa (encargo V04, punto 4):
//   · solo con Verifactu en «real» (en «pruebas» el papel va sin QR);
//   · de 30 a 40 mm, corrección M, con «QR tributario:» encima y «VERI*FACTU»
//     debajo, ENCIMA del QR de la tienda (tablero 1);
//   · las cedidas y Verifactu apagado, sin QR.
// Con la URL que da la base para un tique de verdad (PN26B-000001, 20,18 €).

import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { PUNTOS_POR_MM, puntosPorModulo, qrHacienda } from '@/native/print/fiscalTique'
import { renderBagTicket } from '@/native/print/ticketRenderer'
import { renderBagTicket as renderPrevia } from '@/modules/orders/lib/ticketRenderer'

const URL_REAL = 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B56496938&numserie=CA26B-000001&fecha=27-10-2026&importe=20.18'
const URL_PRUEBAS = 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B56496938&numserie=CA26-000001&fecha=27-10-2026&importe=20.18'
const real = { legalName: 'Llorente29 Food, S.L.', taxId: 'B56496938', ticketNumber: 'CA26B-000001', issuerKind: 'propia' as const, serie: true, verifactu: 'real' as const, verifactuQr: URL_REAL }
const pedido = { brand: 'Meraki Pita', total: 20.18, lineas: [{ qty: 1, name: 'Pita', line_total: 20.18, children: [] }], brand_shop_url: 'https://merakipita.es', external_tab_ref: 'm6y3req' }

describe('V04 · PR 2 · el QR de Hacienda en el tique', () => {
  it('solo en real: en pruebas, apagado o en una cedida, no', () => {
    expect(qrHacienda(real)).toEqual({ url: URL_REAL, encima: 'QR tributario:', debajo: 'VERI*FACTU' })
    expect(qrHacienda({ ...real, verifactu: 'pruebas' })).toBeNull()
    expect(qrHacienda({ ...real, verifactu: 'real', verifactuQr: URL_PRUEBAS })).toBeNull()
    expect(qrHacienda({ ...real, verifactu: null, verifactuQr: null })).toBeNull()
    expect(qrHacienda({ legalName: 'CLOUDTOWN BRANDS SL', issuerKind: 'cedida', ticketNumber: 'LS53-9214' })).toBeNull()
    expect(qrHacienda(null)).toBeNull()
  })

  it('de 30 a 40 mm, en puntos enteros por módulo, con la URL real en corrección M', () => {
    const modulos = QRCode.create(URL_REAL, { errorCorrectionLevel: 'M' }).modules.size
    const p = puntosPorModulo(modulos)!
    const mm = (modulos * p) / PUNTOS_POR_MM
    expect(mm).toBeGreaterThanOrEqual(30)
    expect(mm).toBeLessThanOrEqual(40)
    // Para cada tamaño de QR posible de una URL así (versión 4 a 10), cabe.
    for (let v = 4; v <= 10; v++) {
      const m = 17 + 4 * v
      const q = puntosPorModulo(m)!
      expect((m * q) / PUNTOS_POR_MM).toBeGreaterThanOrEqual(30)
      expect((m * q) / PUNTOS_POR_MM).toBeLessThanOrEqual(40)
    }
    expect(puntosPorModulo(10)).toBeNull()
  })

  it('en la tablet (texto y ESC/POS): encima del QR de la tienda, y nada en pruebas', () => {
    const conQr = renderBagTicket(pedido, real).blocks
    const i = conQr.findIndex((b) => b.kind === 'qrHacienda')
    const j = conQr.findIndex((b) => b.kind === 'qr')
    expect(i).toBeGreaterThan(0)
    expect(i).toBeLessThan(j)
    expect(conQr[i]).toMatchObject({ data: URL_REAL, encima: 'QR tributario:', debajo: 'VERI*FACTU' })
    expect(Number(conQr[i].modulo)).toBe(puntosPorModulo(QRCode.create(URL_REAL, { errorCorrectionLevel: 'M' }).modules.size))
    expect(renderBagTicket(pedido, { ...real, verifactu: 'pruebas', verifactuQr: null }).blocks.some((b) => b.kind === 'qrHacienda')).toBe(false)
  })

  it('en la vista previa de Pedidos, igual', () => {
    const b = renderPrevia(pedido as never, real).blocks
    const i = b.findIndex((x) => x.kind === 'qrHacienda')
    expect(i).toBeGreaterThan(0)
    expect(i).toBeLessThan(b.findIndex((x) => x.kind === 'qr'))
    expect(renderPrevia(pedido as never, { ...real, verifactu: 'pruebas' }).blocks.some((x) => x.kind === 'qrHacienda')).toBe(false)
  })
})
