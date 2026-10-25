// tests/unit/modules/conta/v03/qrPdf.test.ts
//
// V03 · E1 · El QR tributario en el PDF de la factura.
//   · La matriz se comprueba LEYÉNDOLA, no comparándola con quien la hizo: los
//     tres patrones de esquina y los bits de formato (ISO/IEC 18004, §7.9), que
//     dicen el nivel de corrección: M, como pide la AEAT (§6). Las dos copias de
//     esos bits tienen que coincidir.
//   · (Una vez, el 25/10, se descodificó con un lector de verdad, jsQR 1.4.0,
//     fuera del repositorio: leyó la URL exacta, 45 módulos. Está en
//     docs/conta/v03/E1_paso2_envio.md.)
//   · El PDF lleva «QR tributario:» y «VERI*FACTU»; en pruebas, «PRUEBA» y su
//     nota; sin registro, nada de eso.

import { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { facturaVentaPdf, QR_PDF, type DatosFacturaPdf } from '../../../../../supabase/functions/_shared/facturaVentaPdf'
import { modulosQr, QR_MM, urlQr } from '@/modules/conta/lib/verifactu/qr'

const URL = urlQr({ nif: 'B28000016', numSerie: 'F-2026/000002', fecha: '25-10-2026', importe: '121.00' }, 'pruebas')

/** Los 15 bits de formato, leídos de la columna 8 (copia 1) y de la fila 8 (copia 2). */
function formato(m: boolean[][]): { columna: number; fila: number } {
  const n = m.length
  let columna = 0, fila = 0
  for (let i = 0; i < 15; i++) {
    const v = i < 6 ? m[i][8] : i < 8 ? m[i + 1][8] : m[n - 15 + i][8]
    const h = i < 8 ? m[8][n - i - 1] : i < 9 ? m[8][15 - i] : m[8][15 - i - 1]
    columna |= (v ? 1 : 0) << i
    fila |= (h ? 1 : 0) << i
  }
  return { columna, fila }
}

/** Un patrón de esquina (7×7: borde negro, anillo blanco, centro 3×3 negro) en (f, c). */
function esquina(m: boolean[][], f: number, c: number): boolean {
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    const borde = i === 0 || i === 6 || j === 0 || j === 6
    const centro = i >= 2 && i <= 4 && j >= 2 && j <= 4
    if (m[f + i][c + j] !== (borde || centro)) return false
  }
  return true
}

const texto = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

const D: DatosFacturaPdf = {
  empresa: { nombre: 'Restaurante Prueba V03 SL', nif: 'B28000016', direccion: 'Calle Mayor 1, 28001 Madrid' },
  numero: 'F-2026/000002', fecha: '2026-10-25', vence: null, formaCobro: null,
  cliente: { nombre: 'Colegio Prueba V03', nif: '12345678Z', direccion: null },
  lineas: [{ concepto: 'Menú comedor', cantidad: 10, precio: 10, descuento: 0, tipo: 21, importe: 100 }],
  porTipo: [{ tipo: 21, base: 100, iva: 21, recargo: 0 }], base: 100, iva: 21, recargo: 0, retencion: null, total: 121, notas: null, rectifica: null,
}

describe('V03 · el QR tributario', () => {
  const m = modulosQr(URL)

  it('es cuadrado, del tamaño de una versión QR, con sus tres esquinas', () => {
    const n = m.length
    expect(m.every((f) => f.length === n)).toBe(true)
    expect((n - 21) % 4).toBe(0)
    expect(esquina(m, 0, 0) && esquina(m, 0, n - 7) && esquina(m, n - 7, 0)).toBe(true)
    expect(esquina(m, n - 7, n - 7)).toBe(false) // abajo a la derecha no hay
  })

  it('lleva el nivel de corrección M, y las dos copias del formato coinciden', () => {
    const { columna, fila } = formato(m)
    expect(columna).toBe(fila)
    const sinMascara = columna ^ 0b101010000010010
    expect(sinMascara >> 13).toBe(0b00) // M = 00 (L = 01, Q = 11, H = 10)
  })

  it('el lado que se pinta está entre 30 y 40 mm, el mismo en el PDF y en qr.ts', () => {
    expect(QR_PDF.mm).toBe(QR_MM.elegido)
    expect(QR_PDF.mm).toBeGreaterThanOrEqual(QR_MM.minimo)
    expect(QR_PDF.mm).toBeLessThanOrEqual(QR_MM.maximo)
  })
})

describe('V03 · el PDF con su QR', () => {
  it('con registro: «QR tributario:» y «VERI*FACTU», sin marca de prueba', () => {
    const t = texto(facturaVentaPdf(jsPDF, { ...D, verifactu: { modulos: modulosQr(URL), prueba: false } }))
    expect(t).toContain('QR tributario:')
    expect(t).toContain('VERI*FACTU')
    expect(t).not.toContain('PRUEBA')
  })

  it('en pruebas: además «PRUEBA» y la nota de que no vale ante Hacienda', () => {
    const t = texto(facturaVentaPdf(jsPDF, { ...D, verifactu: { modulos: modulosQr(URL), prueba: true } }))
    expect(t).toContain('PRUEBA')
    expect(t).toContain('no tiene validez')
  })

  it('sin registro: ni QR ni leyendas (y el PDF es el de la V01)', () => {
    const sin = facturaVentaPdf(jsPDF, D)
    const t = texto(sin)
    expect(t).not.toContain('QR tributario:')
    expect(t).not.toContain('VERI*FACTU')
    const con = facturaVentaPdf(jsPDF, { ...D, verifactu: { modulos: modulosQr(URL), prueba: false } })
    expect(con.length).toBeGreaterThan(sin.length + 1000) // los módulos del QR
    expect(facturaVentaPdf(jsPDF, { ...D, verifactu: null }).length).toBe(sin.length)
  })
})
