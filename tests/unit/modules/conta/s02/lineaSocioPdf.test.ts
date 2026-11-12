// S01p·18 · Los PDF inventados de la e2e (tests/conta/fixtures/socio), por pdfjs
// y el lector de verdad: dan lo mismo que los cinco de octubre de Alcalá, que se
// pasaron por el mismo lector fuera del repositorio el 12/11 (AF-02979 11.408,42,
// FV-02979 5.998,37, saldo 6.180,05, una sola línea que preguntar: 770,00, y
// ningún bloqueo).

import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { celdasPdf, type PdfJs } from '@/modules/conta/lib/celdasPdf'
import { leerLiquidacion } from '@/modules/conta/lib/lectorLiquidacionMensual'
import { autofactura, EMPRESA_A, suFactura, transaccion } from '../../../../conta/fixtures/socio/pdfLiquidacionSocio.mjs'

const PDFJS = pdfjs as unknown as PdfJs
const leer = async (nombre: string, b: Buffer) => ({ nombre, paginas: await celdasPdf(PDFJS, new Uint8Array(b).buffer) })

describe('S01p·18 · los PDF de la e2e, por el lector de verdad', () => {
  it('dan lo de octubre de Alcalá: la línea de 770,00 se pregunta y nada bloquea', async () => {
    const r = leerLiquidacion([await leer('AutoFactura oct.pdf', autofactura()), await leer('Factura oct.pdf', suFactura()), await leer('Resumen de Transaccion oct.pdf', transaccion())], EMPRESA_A)
    expect([r.emitida?.numero, r.emitida?.total, r.recibida?.numero, r.recibida?.total, r.transaccion?.saldo?.importe]).toEqual(['AF-02979', 11408.42, 'FV-02979', 5998.37, 6180.05])
    expect(r.lineasSocio).toEqual([{ concepto: 'Financiación inventario pendiente por pagar', importe: 770, queEs: null }])
    expect(r.bloqueos).toEqual([])
  })
})
