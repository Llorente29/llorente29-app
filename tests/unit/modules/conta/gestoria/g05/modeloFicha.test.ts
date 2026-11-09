// G05 · T4 · La ficha de una factura que sale de un recibo (modeloFicha.ts), con
// los textos de la maqueta aprobada (Factura.dc.html). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { huellaCorta, modeloFicha, type DatosFichaRecibo, type FacturaDeLaFicha } from '../../../../../../src/modules/conta/gestoria/g05/modeloFicha'

const datos = (extra: Partial<DatosFichaRecibo['recibo']> = {}, resto: Partial<DatosFichaRecibo> = {}): DatosFichaRecibo => ({
  recibo: { id: 'r1', company_id: 'e1', mes: '2026-12', estado: 'facturado', gc_estado: 'confirmed', cobrar_cent: 15730, cargo_el: '2026-12-04',
    confirmado_el: '2026-12-04', enviado_at: '2026-12-01T09:42:00Z', enviado_por_name: 'Persona Prueba', aviso_el: '2026-12-02', ...extra },
  eventos: [],
  verifactu: null,
  asientos: [
    { tipo: 'factura', id: 'a1', fecha: '2026-12-04', numero: 812, estado: 'validado', apuntes: [
      { codigo: '43000052', nombre: 'Talleres Ejemplo, S.L.', debe: 157.3, haber: 0 },
      { codigo: '70500000', nombre: 'Prestaciones de servicios', debe: 0, haber: 130 },
      { codigo: '47700021', nombre: 'IVA repercutido 21 %', debe: 0, haber: 27.3 }] },
    { tipo: 'cobro', id: 'a2', fecha: '2026-12-04', numero: 813, estado: 'validado', apuntes: [
      { codigo: '57200002', nombre: 'Plataforma GoCardless', debe: 157.3, haber: 0 },
      { codigo: '43000052', nombre: 'Talleres Ejemplo, S.L.', debe: 0, haber: 157.3 }] },
  ],
  ...resto,
})
const factura = (extra: Partial<FacturaDeLaFicha> = {}): FacturaDeLaFicha => ({
  numero: '2026/1/141', serie: '1', fecha: '2026-12-04', total: 157.3, cliente: 'Talleres Ejemplo, S.L.',
  enviadaEl: '2026-12-04T09:15:00Z', correo: 'administracion@ejemplo.example', anulada: false, ...extra,
})

describe('G05 · T4 · la ficha de la factura de un recibo', () => {
  it('la cabecera: «Factura N», «Pagada» y cliente · mes · total; vuelve al cobro de su mes', () => {
    const m = modeloFicha(datos(), factura())
    expect(m.titulo).toBe('Factura 2026/1/141')
    expect(m.chip).toEqual({ texto: 'Pagada', tono: 'bien' })
    expect(m.subtitulo).toBe('Talleres Ejemplo, S.L. · diciembre de 2026 · 157,30 €')
    expect(m.volver).toEqual({ texto: '← Cobro de diciembre', mes: '2026-12', empresa: 'e1' })
  })

  it('«Lo que ha pasado», en el orden y con los textos de la maqueta (hora de Madrid)', () => {
    const m = modeloFicha(datos(), factura())
    expect(m.hitos.map((h) => [h.titulo, h.detalle])).toEqual([
      ['Cobro enviado', '1 de diciembre · aviso al cliente el día 2 con el detalle'],
      ['Cobrado', '4 de diciembre · 157,30 € por domiciliación'],
      ['Factura emitida', '4 de diciembre · 2026/1/141, serie 1 · facturas expedidas'],
      ['Verifactu de pruebas: pendiente', 'Se registrará sola en cuanto la conexión con la AEAT esté probada. El PDF saldrá entonces con su QR.'],
      ['Enviada al cliente', '4 de diciembre, 10:15 · administracion@ejemplo.example'],
      ['Ingreso de GoCardless en el banco', 'Llega unos días después del cobro, junto con los demás cobros del día. Se casa solo en Bancos.'],
    ])
    expect(m.hitos.map((h) => h.bola)).toEqual(['hecho', 'hecho', 'hecho', 'espera', 'hecho', 'pendiente'])
  })

  it('con Verifactu registrado en pruebas: su huella corta y con cuál se encadena', () => {
    const huella = '7C3E91A05B2D' + '0'.repeat(48) + 'F04E'
    const m = modeloFicha(datos({}, { verifactu: { estado: 'correcto', entorno: 'pruebas', huella, anterior: '2026/1/140' } }), factura())
    expect(m.hitos[3]).toEqual({ bola: 'hecho', icono: '✓', titulo: 'Verifactu: registrada en pruebas de la AEAT', detalle: 'Huella 7C3E 91A0 5B2D … F04E · encadenada con la 2026/1/140' })
    expect(huellaCorta(huella)).toBe('7C3E 91A0 5B2D … F04E')
  })

  it('sin enviar al cliente, lo dice; devuelta, sale en rojo y sin el ingreso en el banco', () => {
    const sinEnviar = modeloFicha(datos(), factura({ enviadaEl: null }))
    expect(sinEnviar.hitos[4]).toMatchObject({ bola: 'pendiente', titulo: 'Sin enviar al cliente', detalle: 'Aún no se le ha mandado a administracion@ejemplo.example.' })
    const dev = modeloFicha(datos({ estado: 'devuelto', gc_estado: 'failed' }, { eventos: [{ tipo: 'devuelto', texto: 'Devuelto después de cobrarse.', cuando: '2026-12-08T10:00:00Z', quien: null }] }), factura())
    expect(dev.chip).toEqual({ texto: 'Devuelta', tono: 'mal' })
    expect(dev.hitos.at(-1)).toEqual({ bola: 'mal', icono: '!', titulo: 'Devuelto', detalle: '8 de diciembre · Devuelto después de cobrarse.' })
    expect(dev.hitos.some((h) => h.titulo.startsWith('Ingreso'))).toBe(false)
  })

  it('«En la contabilidad»: cada asiento con su fecha y número, y sus apuntes con debe y haber', () => {
    const m = modeloFicha(datos(), factura())
    expect(m.asientos[0]).toEqual({ id: 'a1', titulo: 'Factura · 4 de diciembre · asiento 812', lineas: [
      { cuenta: '43000052 Talleres Ejemplo, S.L.', debe: '157,30', haber: '' },
      { cuenta: '70500000 Prestaciones de servicios', debe: '', haber: '130,00' },
      { cuenta: '47700021 IVA repercutido 21 %', debe: '', haber: '27,30' }] })
    expect(m.asientos[1].titulo).toBe('Cobro · 4 de diciembre · asiento 813')
    expect(m.notas[1]).toMatch(/^La comisión de GoCardless no va aquí/)
  })
})
