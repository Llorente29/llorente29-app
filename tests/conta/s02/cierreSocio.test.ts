// tests/conta/s02/cierreSocio.test.ts
//
// S01p·18 · punto 4 · El correo del cierre del mes del socio va a su liquidación,
// no a Compras. Regla 31: los nombres son los de verdad, los de los dos cierres
// que llegaron a Foodint (septiembre y octubre, medidos el 12/11 en
// document_inbox): cinco PDF cada uno.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { recibirCorreo, type AdjuntoResend, type CorreoResend, type PuertoEntrada } from '../../../supabase/functions/_shared/facturasEntrada'
import { esCierreDelSocio, piezaDelCierre, queDiceElNombre } from '../../../supabase/functions/_shared/queEs'
import { cierresDelCorreo, fraseCierre, mesDelCierre, type LlegadaCierre } from '../../../src/modules/conta/lib/cierreSocio'

const OCTUBRE = ['AutoFactura-oct.pdf', 'Compras-y-Ventas-oct.pdf', 'Factura-oct.pdf', 'Resumen-de-Transaccion-oct.pdf', 'Resumen-de-ventas-oct.pdf']
const SEPTIEMBRE = ['AutoFactura-sep.pdf', 'Compras-y-Ventas-sep.pdf', 'Factura-sep.pdf', 'Resumen-de-Transaccion-sep.pdf', 'Resumen-de-ventas-sep.pdf']
// Como los guarda Gmail al bajarlos a mano (los del 05/11, con espacios).
const A_MANO = ['AutoFactura oct.pdf', 'Compras y Ventas oct.pdf', 'Factura oct.pdf', 'Resumen de Transaccion oct.pdf', 'Resumen de ventas oct.pdf']

describe('el cierre del socio, por sus nombres', () => {
  it('cada uno de los cinco PDF de verdad es su pieza', () => {
    for (const ns of [OCTUBRE, SEPTIEMBRE, A_MANO]) {
      expect(ns.map(piezaDelCierre)).toEqual(['autofactura', 'inventario', 'factura', 'transaccion', 'ventas'])
    }
    expect(piezaDelCierre('Resumen de Transacción oct.pdf')).toBe('transaccion')
  })
  it('los dos cierres medidos son cierres del socio; con su AutoFactura y su Resumen de Transacción basta', () => {
    expect(esCierreDelSocio(OCTUBRE)).toBe(true)
    expect(esCierreDelSocio(SEPTIEMBRE)).toBe(true)
    expect(esCierreDelSocio(A_MANO)).toBe(true)
    expect(esCierreDelSocio(['AutoFactura-oct.pdf', 'Resumen-de-Transaccion-oct.pdf'])).toBe(true)
  })
  it('lo que no es su cierre no lo es: una factura sola, una AutoFactura sin su transacción, el resumen de Uber', () => {
    expect(esCierreDelSocio(['Factura-oct.pdf'])).toBe(false)
    expect(esCierreDelSocio(['F-2026-0412.pdf', 'Factura Teléfono septiembre.pdf'])).toBe(false)
    expect(esCierreDelSocio(['AutoFactura-oct.pdf', 'Factura-oct.pdf'])).toBe(false)
    expect(esCierreDelSocio(['monthly_statement_October_2026.pdf'])).toBe(false)
    expect(esCierreDelSocio(['AutoFactura-oct.xlsx', 'Resumen-de-Transaccion-oct.xlsx'])).toBe(false)
  })
  it('por el nombre suelto, ninguno de los cinco dice nada a la puerta (por eso se miran juntos)', () => {
    expect(OCTUBRE.map(queDiceElNombre)).toEqual([null, null, null, null, null])
  })
})

describe('el mes que cierra', () => {
  it('el que dice el asunto, del año en que llega', () => {
    expect(mesDelCierre('Fwd: Cierre del mes de octubre', '2026-11-05')).toBe('2026-10-01')
    expect(mesDelCierre('Fwd: Cierre del mes de septiembre', '2026-11-12')).toBe('2026-09-01')
  })
  it('el de diciembre llega en enero: es del año anterior', () => {
    expect(mesDelCierre('Cierre del mes de diciembre', '2027-01-04')).toBe('2026-12-01')
  })
  it('si el asunto no lo dice, el mes anterior al que llega', () => {
    expect(mesDelCierre('Documentos', '2026-11-05')).toBe('2026-10-01')
    expect(mesDelCierre(null, '2027-01-05')).toBe('2026-12-01')
  })
})

describe('los cierres de la bandeja, juntos por correo', () => {
  const llegada = (emailId: string, nombre: string, recibido = '2026-11-05T09:12:00Z', asunto = 'Fwd: Cierre del mes de octubre'): LlegadaCierre =>
    ({ id: `${emailId}:${nombre}`, emailId, asunto, recibido, nombre, bucket: 'receipt-uploads', ruta: `acc/_correo/${emailId}/${nombre}` })
  it('cada correo con sus PDF; solo los que son el cierre; los más nuevos primero', () => {
    const xs = [
      ...OCTUBRE.map((n) => llegada('e-oct', n)),
      ...SEPTIEMBRE.map((n) => llegada('e-sep', n, '2026-11-12T10:00:00Z', 'Fwd: Cierre del mes de septiembre')),
      llegada('e-otro', 'liquidacion-glovo.pdf'),
    ]
    const cs = cierresDelCorreo(xs)
    expect(cs.map((c) => [c.emailId, c.mes, c.recibido, c.ficheros.length])).toEqual([['e-sep', '2026-09-01', '2026-11-12', 5], ['e-oct', '2026-10-01', '2026-11-05', 5]])
    expect(fraseCierre(cs[1])).toBe('El cierre de octubre llegó por correo el 05/11, con sus 5 PDF.')
  })
})

// ── La puerta: el correo de facturas no lo lee como facturas ─────────────────

const sha = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
function mundo(adjuntos: AdjuntoResend[]) {
  const registro: Record<string, unknown>[] = []
  const subidas: string[] = []
  const colocados: { id: string; tipo: string | null; por: string }[] = []
  const leidas: string[] = []
  let n = 0
  const p: PuertoEntrada = {
    destino: async (lp) => (lp === 'facturas-taberna-norte' ? { companyId: 'emp', accountId: 'acc', activa: true } : null),
    yaVisto: async () => false,
    registrarCorreo: async (r) => { registro.push(r as unknown as Record<string, unknown>) },
    adjuntos: async () => adjuntos,
    bajar: async (url) => new TextEncoder().encode(`%PDF ${url}`),
    subir: async (ruta) => { subidas.push(ruta) },
    sha256: sha,
    llegada: async () => ({ id: `l${++n}`, yaEstaba: false }),
    leer: async (id) => { leidas.push(id); return { estado: 'factura', texto: `${id}: leída` } },
    colocar: async (id, x) => { colocados.push({ id, tipo: x.tipo, por: x.por }) },
  }
  return { p, registro, subidas, colocados, leidas }
}
const pdf = (nombre: string, i: number): AdjuntoResend => ({ id: String(i), filename: nombre, content_type: 'application/pdf', size: 60_000, download_url: `https://r/${i}` })
const correo: CorreoResend = { email_id: 'e-oct', from: 'reenvio@ejemplo.test', to: ['facturas-taberna-norte@entrada.folvy.app'], subject: 'Fwd: Cierre del mes de octubre' }

describe('recibirCorreo: el cierre del socio', () => {
  it('sus cinco PDF se guardan como «liquidación» y ninguno se lee como factura', async () => {
    const m = mundo(OCTUBRE.map(pdf))
    const r = await recibirCorreo(correo, m.p)
    expect(r.resultado).toBe('cierre_socio')
    expect(m.leidas).toEqual([])
    expect(m.subidas).toHaveLength(5)
    expect(m.colocados).toEqual(['l1', 'l2', 'l3', 'l4', 'l5'].map((id) => ({ id, tipo: 'liquidacion', por: 'regla' })))
    expect(r.llegadas.map((l) => l.estado)).toEqual(Array(5).fill('cierre_socio'))
    expect(m.registro).toMatchObject([{ resultado: 'recibido', companyId: 'emp', detalle: { cierre_socio: true, tomados: 5, dejados: [] } }])
    expect(r.texto).toBe('Es el cierre del mes del socio de marca: 5 PDF guardados, que no son facturas de Compras. Esperan en Ventas › Liquidaciones › Socios de marca, para leerlos con su liquidación y su local.')
  })
  it('lo que viene con él y no es un PDF (la firma) no se toma, y se dice', async () => {
    const m = mundo([...OCTUBRE.map(pdf), { id: '9', filename: 'firma.png', content_type: 'image/png', size: 4_000, download_url: 'https://r/9' }])
    const r = await recibirCorreo(correo, m.p)
    expect(m.colocados).toHaveLength(5)
    expect(r.texto).toMatch(/1 sin tomar \(firma\.png: es una imagen pequeña/)
  })
  it('una factura normal sigue su camino: se lee', async () => {
    const m = mundo([pdf('F-2026-0412.pdf', 1)])
    const r = await recibirCorreo({ ...correo, subject: 'Factura octubre' }, m.p)
    expect(r.resultado).toBe('recibido')
    expect(m.leidas).toEqual(['l1'])
    expect(m.colocados).toEqual([])
  })
})
