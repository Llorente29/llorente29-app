// V02 · Entrega 1 · La puerta por correo: <empresa>@entrada.… lleva cada cosa a
// su sitio por los caminos de siempre. Los nombres de los ficheros son los de
// VERDAD de Foodint (regla 31), medidos el 25/10 en solo lectura:
//   · los extractos de BBVA llegan como «BBVA Histórico movimientos (n).xlsx»;
//   · las facturas de los riders de Catcher, como invoice_<n>_ES_I_<…>.pdf (83 en
//     la quincena del 1 al 15/10, también las de flota «invoice_fleet_…» y la de
//     Catcher «invoice_890_ES_I_PIT_…»);
//   · las 13 nóminas de Laboral NO dicen «nómina» en el nombre: para ellas
//     cuenta el remitente aprendido, no el nombre.
// El correo, Resend y la base son dobles.
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  clasificarDocumentos, direccionesDeFacturas, queDiceElContenido, queDiceElNombre, recibirCorreo,
  type AdjuntoResend, type CorreoResend, type PuertoEntrada, type QueEs,
} from '../../../supabase/functions/_shared/facturasEntrada'
import { correoUber } from '../d01/uberInventado'

const sha = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

// Los nombres de verdad (los de los riders son números de factura, no personas).
const RIDERS = ['invoice_34974_ES_I_34974_26_00110.pdf', 'invoice_4929_ES_I_4929_26_00134.pdf', 'invoice_fleet_110_ES_I_FLE_110_26_00084.pdf', 'invoice_890_ES_I_PIT_26_03471.pdf']
const EXTRACTO_BBVA = 'BBVA Histórico movimientos (6).xlsx'
const zipDeRiders = () => zipSync(Object.fromEntries(RIDERS.map((n) => [n, new TextEncoder().encode(`%PDF ${n}`)])))

describe('lo que dice el nombre y el contenido', () => {
  it('con los nombres de verdad: el extracto de BBVA, sí; una factura de rider suelta, no dice nada (se lee como factura)', () => {
    expect(queDiceElNombre(EXTRACTO_BBVA)).toBe('extracto')
    for (const n of RIDERS) expect(queDiceElNombre(n)).toBeNull()
  })
  it('lo que no admite dudas: Norma 43, nóminas, el resumen mensual de Uber y la factura electrónica', () => {
    expect(queDiceElNombre('cuenta-0182.n43')).toBe('extracto')
    expect(queDiceElNombre('Nómina octubre.pdf')).toBe('nomina')
    expect(queDiceElNombre('monthly_statement_September_2026.pdf')).toBe('liquidacion')
    expect(queDiceElNombre('F-2026-1022.xsig')).toBe('factura')
    expect(queDiceElNombre('documento.pdf')).toBeNull()
  })
  it('el zip de la quincena de Catcher se reconoce por lo que lleva dentro, se llame como se llame', () => {
    expect(queDiceElContenido('descarga (3).zip', zipDeRiders())).toBe('riders')
    expect(queDiceElContenido('fotos.zip', zipSync({ 'a.jpg': new Uint8Array([1, 2, 3]) }))).toBeNull()
    // Un Excel también empieza por PK: no se toma por zip.
    expect(queDiceElContenido(EXTRACTO_BBVA, zipDeRiders())).toBeNull()
  })
  it('qué se lee, qué se guarda sin leer y qué se deja, con su porqué', () => {
    const r = clasificarDocumentos([
      { id: '1', filename: 'Factura.pdf', content_type: 'application/pdf', size: 50_000 },
      { id: '2', filename: EXTRACTO_BBVA, content_type: 'application/octet-stream', size: 30_000 },
      { id: '3', filename: 'quincena.zip', content_type: 'application/zip', size: 900_000 },
      { id: '4', filename: 'movimientos.csv', content_type: 'text/csv', size: 2_000 },
      { id: '5', filename: 'contrato.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 20_000 },
      { id: '6', filename: 'enorme.xlsx', content_type: 'application/octet-stream', size: 11 * 1024 * 1024 },
    ])
    expect(r.leer.map((x) => x.id)).toEqual(['1'])
    expect(r.guardar.map((x) => [x.id, x.nombre])).toEqual([['2', 'BBVA-Historico-movimientos-6.xlsx'], ['3', 'quincena.zip'], ['4', 'movimientos.csv']])
    expect(r.dejar.map((x) => x.porque)).toEqual(['no es un PDF, una foto, una hoja, un extracto, un zip ni un XML', 'pasa de 10 MB'])
  })
  it('la dirección única: sin prefijo, solo en un dominio de entrada (folvy.app ahora, sumied.com cuando se dé de alta)', () => {
    expect(direccionesDeFacturas({ to: ['Taberna <taberna-norte@entrada.folvy.app>', 'taberna-norte@entrada.sumied.com', 'julio@taberna.test'] }).map((d) => d.direccion))
      .toEqual(['taberna-norte@entrada.folvy.app', 'taberna-norte@entrada.sumied.com'])
  })
})

type Colocado = { id: string; tipo: QueEs | null; por: string; bucket?: string }
function puerta(o: { adjuntos?: AdjuntoResend[]; remitente?: { decision: 'no_facturas' | 'tipo'; motivo: string; tipo?: QueEs | null } | null;
  leer?: string; ficheros?: Record<string, Uint8Array>; cuerpo?: { html: string | null; text: string | null } } = {}) {
  const registro: Record<string, unknown>[] = []
  const subidas: { bucket: string; ruta: string }[] = []
  const llegadas: { id: string; nombre: string | null; ruta: string | null }[] = []
  const colocados: Colocado[] = []
  const leidas: string[] = []
  const nominas: string[] = []
  const liquidaciones: unknown[] = []
  const cuerpos: string[] = []
  const p: PuertoEntrada = {
    destino: async (lp, dom) => (lp === 'taberna-norte' && dom.startsWith('entrada.') ? { companyId: 'emp', accountId: 'acc', activa: true, tipo: 'documentos' } : null),
    yaVisto: async () => false,
    registrarCorreo: async (r) => { registro.push(r as never) },
    adjuntos: async () => o.adjuntos ?? [],
    bajar: async (url) => o.ficheros?.[url] ?? new TextEncoder().encode(`%PDF contenido de ${url}`),
    subir: async (ruta) => { subidas.push({ bucket: 'receipt-uploads', ruta }) },
    subirA: async (bucket, ruta) => { subidas.push({ bucket, ruta }) },
    sha256: sha,
    llegada: async (x) => { llegadas.push({ id: `l${llegadas.length + 1}`, nombre: x.nombre, ruta: x.ruta }); return { id: `l${llegadas.length}`, yaEstaba: false } },
    leer: async (id) => { leidas.push(id); return { estado: o.leer ?? 'factura', texto: `${id}: leída` } },
    colocar: async (id, x) => { colocados.push({ id, ...x }) },
    nomina: async (x) => { nominas.push(x.nombre); return { ok: true, texto: `${x.nombre}: a Laboral.` } },
    remitente: async () => o.remitente ?? null,
    cuerpo: async (id) => { cuerpos.push(id); return o.cuerpo ?? { html: null, text: null } },
    liquidacion: async (x) => { liquidaciones.push(x); return { id: 'liq-1', yaEstaba: false, texto: 'Liquidación leída.', factura: 'creada' } },
  }
  return { p, registro, subidas, llegadas, colocados, leidas, nominas, liquidaciones, cuerpos }
}
const aLaPuerta = (o: Partial<CorreoResend> = {}): CorreoResend => ({ email_id: 'e9', from: 'alguien@ejemplo.test', to: ['taberna-norte@entrada.folvy.app'], subject: 'Te mando esto', ...o })

describe('recibirCorreo: la puerta, <empresa>@entrada.…', () => {
  it('un PDF que la lectura da por factura: a la bandeja de siempre, se lee y queda apuntado que es factura (por la lectura)', async () => {
    const m = puerta({ adjuntos: [{ id: '1', filename: 'F-77.pdf', content_type: 'application/pdf', size: 40_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo(aLaPuerta(), m.p)
    expect(r.resultado).toBe('documentos')
    expect(m.subidas).toEqual([{ bucket: 'receipt-uploads', ruta: 'acc/_correo/e9/01-F-77.pdf' }])
    expect(m.leidas).toEqual(['l1'])
    expect(m.colocados).toEqual([{ id: 'l1', tipo: 'factura', por: 'lectura' }])
    expect(m.registro).toMatchObject([{ resultado: 'recibido', companyId: 'emp', detalle: { puerta: true, tomados: 1, estados: { factura: 1 } } }])
  })
  it('un PDF que no parece factura: queda sin saber qué es («Necesita que lo mires»), sin inventárselo', async () => {
    const m = puerta({ leer: 'no_es_factura', adjuntos: [{ id: '1', filename: 'documento.pdf', content_type: 'application/pdf', size: 40_000, download_url: 'https://r/1' }] })
    await recibirCorreo(aLaPuerta(), m.p)
    expect(m.leidas).toEqual(['l1'])
    expect(m.colocados).toEqual([])
  })
  it('el extracto de BBVA (Excel): a conta-entrada, sin leer, apuntado como extracto', async () => {
    const m = puerta({ adjuntos: [{ id: '1', filename: EXTRACTO_BBVA, content_type: 'application/octet-stream', size: 30_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo(aLaPuerta(), m.p)
    expect(m.subidas).toEqual([{ bucket: 'conta-entrada', ruta: 'acc/_correo/e9/01-BBVA-Historico-movimientos-6.xlsx' }])
    expect(m.leidas).toEqual([])
    expect(m.colocados).toEqual([{ id: 'l1', tipo: 'extracto', por: 'regla', bucket: 'conta-entrada' }])
    expect(r.llegadas[0].texto).toBe('BBVA-Historico-movimientos-6.xlsx: es un extracto del banco.')
  })
  it('la quincena de Catcher (el zip y sus dos Excel, con nombres que no dicen nada): los tres, quincena de riders', async () => {
    const m = puerta({
      adjuntos: [
        { id: '1', filename: 'Facturas.zip', content_type: 'application/zip', size: 900_000, download_url: 'https://r/zip' },
        { id: '2', filename: 'export (1).xlsx', content_type: 'application/octet-stream', size: 30_000, download_url: 'https://r/x1' },
        { id: '3', filename: 'export (2).xlsx', content_type: 'application/octet-stream', size: 30_000, download_url: 'https://r/x2' },
      ],
      ficheros: { 'https://r/zip': zipDeRiders() },
    })
    await recibirCorreo(aLaPuerta({ from: 'Catcher <no-reply@catcher.test>', subject: 'Facturas quincena' }), m.p)
    expect(m.colocados.map((x) => x.tipo)).toEqual(['riders', 'riders', 'riders'])
    expect(m.subidas.every((s) => s.bucket === 'conta-entrada')).toBe(true)
  })
  it('un Excel solo, que no dice nada: guardado y sin saber qué es', async () => {
    const m = puerta({ adjuntos: [{ id: '1', filename: 'export.xlsx', content_type: 'application/octet-stream', size: 30_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo(aLaPuerta(), m.p)
    expect(m.colocados).toEqual([{ id: 'l1', tipo: null, por: 'regla', bucket: 'conta-entrada' }])
    expect(r.llegadas[0]).toMatchObject({ estado: 'sin_saber', texto: 'export.xlsx: no sé qué es; dímelo en la puerta.' })
  })
  it('una nómina de un remitente aprendido (el nombre no lo dice, como las 13 de verdad): a Laboral por su camino, no a la bandeja', async () => {
    const m = puerta({ remitente: { decision: 'tipo', motivo: 'Lo dijo Julio', tipo: 'nomina' },
      adjuntos: [{ id: '1', filename: 'B12345678_202609_001.pdf', content_type: 'application/pdf', size: 60_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo(aLaPuerta({ from: 'Gestoría <laboral@gestoria.test>' }), m.p)
    expect(m.nominas).toEqual(['B12345678_202609_001.pdf'])
    expect(m.llegadas).toEqual([])
    expect(m.leidas).toEqual([])
    expect(r.llegadas).toMatchObject([{ estado: 'nomina' }])
  })
  it('un PDF de un remitente que manda extractos: se guarda en la bandeja como extracto y no se lee como factura', async () => {
    const m = puerta({ remitente: { decision: 'tipo', motivo: 'Lo dijo Julio', tipo: 'extracto' },
      adjuntos: [{ id: '1', filename: 'documento.pdf', content_type: 'application/pdf', size: 60_000, download_url: 'https://r/1' }] })
    await recibirCorreo(aLaPuerta(), m.p)
    expect(m.leidas).toEqual([])
    expect(m.colocados).toEqual([{ id: 'l1', tipo: 'extracto', por: 'regla' }])
  })
  it('un remitente que no manda facturas: se apunta y no se baja nada, como en facturas-', async () => {
    const m = puerta({ remitente: { decision: 'no_facturas', motivo: 'Manda justificantes de entrega.' },
      adjuntos: [{ id: '1', filename: 'F.pdf', content_type: 'application/pdf', size: 60_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo(aLaPuerta(), m.p)
    expect(r.resultado).toBe('no_es_factura')
    expect(m.subidas).toEqual([])
  })
  it('un resumen de pagos de Uber a la puerta: es una liquidación, por su camino (el cuerpo se pide una sola vez)', async () => {
    const resumen = correoUber({ desde: '2026-09-21', hasta: '2026-09-27', dias: [{ fecha: '2026-09-24', pedidos: 2, ventas: 40, impuesto: 4 }],
      desglose: { ventas: 44, pedidosVentas: 2, tasas: -13.31, promociones: -5 } })
    const m = puerta({ cuerpo: { html: resumen.html, text: null } })
    const r = await recibirCorreo(aLaPuerta({ from: 'Uber Eats <noreply@uber.com>', subject: resumen.subject }), m.p)
    expect([r.resultado, r.texto]).toEqual(['liquidacion', 'Liquidación leída.'])
    expect(m.cuerpos).toEqual(['e9'])
    expect(m.liquidaciones).toHaveLength(1)
  })
  it('un correo de Uber que no es un resumen: no se fuerza, sigue como cualquier documento', async () => {
    const m = puerta({ cuerpo: { html: '<p>Novedades</p>', text: null } })
    const r = await recibirCorreo(aLaPuerta({ from: 'Uber Eats <noreply@uber.com>', subject: 'Novedades' }), m.p)
    expect(r.resultado).toBe('documentos')
    expect(m.liquidaciones).toEqual([])
  })
  it('una dirección de entrada que no es de nadie en el To:, y la buena en el sobre: se enruta por el sobre', async () => {
    const m = puerta({ adjuntos: [{ id: '1', filename: 'F-77.pdf', content_type: 'application/pdf', size: 40_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo({ ...aLaPuerta({ to: ['otra-cosa@entrada.folvy.app'] }), envelope: { to: ['taberna-norte@entrada.folvy.app'] } } as never, m.p)
    expect(r.resultado).toBe('documentos')
    expect(m.registro[0]).toMatchObject({ to: 'taberna-norte@entrada.folvy.app', porSobre: true })
  })
})
