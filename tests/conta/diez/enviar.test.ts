// C04b · R15 · Enviar a Diez un asiento de ventas validado, con su documento.
// Cada freno, uno a uno, contra dobles de la base y de Diez (lo que contesta
// Diez es lo MEDIDO en la C0009: el 500 «The specified container does not
// exist.» del R14, el listado que repite filas). Importes INVENTADOS.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { enviarAsientoADiez, TEXTO_CONTENEDOR, type ClienteDiezEnvio, type EnvioFila, type PuertoEnvio } from '../../../supabase/functions/_shared/diezEnviar'
import { CORRESPONDENCIA_LLORENTE29 } from '../../../supabase/functions/_shared/diezAnalitica'
import { resumenDeAsiento, type ResumenBD } from '../../../supabase/functions/_shared/resumenDeAsiento'
import type { Factura, FacturaData } from '../../../supabase/functions/_shared/diezCliente'

const PDF = new TextEncoder().encode('%PDF-1.3 ' + 'x'.repeat(400))
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

const resumen = (o: Partial<ResumenBD> = {}): ResumenBD => ({
  id: 'e1', account_id: 'acc', company_id: 'emp', estado: 'validado', serie: 1, numero: 1287, fecha: '2026-10-01',
  empresa: { nombre: 'Empresa de Prueba SL', nif: 'B00000000' }, local: { id: 'l1', nombre: 'Foodint Alcalá' }, canal: { id: 'c1', slug: 'uber', nombre: 'Uber Eats' },
  pedidos: [{ hora: '13:05', codigo: 'A1', marca: 'Meraki Pita', total: 22, base: 20, cuota: 2 }, { hora: '14:10', codigo: 'A2', marca: 'Milanesa House', total: 11, base: null, cuota: null }],
  lineas: [{ cuenta: '43000002', debe: 33, haber: 0, marca: null, tipoIva: null, documento: null }, { cuenta: '70000002', debe: 0, haber: 20, marca: 'Meraki Pita', tipoIva: null, documento: null },
    { cuenta: '70000001', debe: 0, haber: 10, marca: 'Milanesa House', tipoIva: null, documento: null }, { cuenta: '47700010', debe: 0, haber: 3, marca: null, tipoIva: 10, documento: null }],
  documento: { id: 'd1', ruta: 'acc/e1/abc.pdf', nombre: 'ResumenDeVentas_UBR-FLO-20261001.pdf', sha256: sha(PDF), bytes: PDF.length, creado_en: '', creado_por: 'Julio' },
  ...o,
})

type Diez = ClienteDiezEnvio & { altas: FacturaData[]; subidas: number; guardado: Uint8Array | null }
function diez(o: { facturas?: Factura[]; contenedor?: boolean; subida?: number; devuelve?: (g: Uint8Array | null) => Uint8Array | null } = {}): Diez {
  const facturas = [...(o.facturas ?? [{ Ejercicio: '2026', Serie: '1', Documento: 1700, TipoAsiento: 1, Fecha: 20261001, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-CAM-20261001' }])]
  const d: Diez = {
    altas: [], subidas: 0, guardado: null,
    async facturasDelMes() { return [...facturas, ...facturas] }, // el listado de Diez repite filas
    async enviarFactura(fd) { d.altas.push(fd); const f = { ...fd, Documento: 1801, Fecha: Number(fd.FechaFactura) } as Factura; facturas.push(f); return f },
    async adjuntarDocumentoFactura(x) {
      d.subidas++
      if (o.contenedor === false) return { status: 500, json: { Message: 'The specified container does not exist.' } }
      if ((o.subida ?? 200) !== 200) return { status: o.subida!, json: 'mal' }
      d.guardado = Uint8Array.from(Buffer.from(x.Archivo, 'base64')); return { status: 200, json: { NumeroFactura: 'x' } }
    },
    async documentoDeFactura() {
      if (o.contenedor === false) return { status: 500, json: { ExceptionMessage: 'The specified container does not exist.' } }
      const g = o.devuelve ? o.devuelve(d.guardado) : d.guardado
      return g ? { status: 200, json: b64(g) } : { status: 404, json: null }
    },
  }
  return d
}

function puerto(o: { r?: ResumenBD; bd?: string | null; d?: Diez; envio?: EnvioFila | null; pdf?: Uint8Array } = {}) {
  const filas: EnvioFila[] = []
  let actual: EnvioFila | null = o.envio ?? null
  const llamadas = { conexion: 0, cliente: 0 }
  const d = o.d ?? diez()
  const p: PuertoEnvio = {
    resumen: async () => o.r ?? resumen(),
    envio: async () => actual,
    guardar: async (f) => { actual = { ...f, id: f.id ?? 's1' }; filas.push(actual); return actual },
    conexion: async () => { llamadas.conexion++; return o.bd === null ? null : { id: 'k1', nombreBd: o.bd ?? 'C0009' } },
    cliente: async () => { llamadas.cliente++; return d },
    documento: async () => o.pdf ?? PDF,
    sha256: async (b) => sha(b),
    correspondencia: () => CORRESPONDENCIA_LLORENTE29,
    ahora: () => new Date('2026-10-13T10:00:00Z'),
  }
  return { p, d, filas, llamadas, get actual() { return actual } }
}

describe('enviarAsientoADiez (R15): los frenos', () => {
  it('lo propuesto no se envía y no se apunta nada', async () => {
    const t = puerto({ r: resumen({ estado: 'propuesto' }) })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.filas).toEqual([]); expect(t.llamadas.conexion).toBe(0)
  })
  it('SIN DOCUMENTO NO SE ENVÍA: ni se abre la conexión; queda «falta el documento»', async () => {
    const t = puerto({ r: resumen({ documento: null }) })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', motivo: 'falta el documento', texto: 'No ha llegado a Diez: falta el documento.' })
    expect(t.llamadas).toEqual({ conexion: 0, cliente: 0 })
    expect(t.actual).toMatchObject({ status: 'pendiente', attempts: 0, document_status: 'pendiente', last_error: 'falta el documento' })
  })
  it('una plataforma sin su factura medida (Glovo) no se envía y dice por qué', async () => {
    const t = puerto({ r: resumen({ canal: { id: 'c2', slug: 'glovo', nombre: 'Glovo' } }) })
    const x = await enviarAsientoADiez('e1', t.p)
    expect(x).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(x.estado === 'no_llega' && x.motivo).toMatch(/glovo.*patrón de factura medido/)
    expect(t.llamadas.conexion).toBe(0)
  })
  it('sin conexión: «la conexión con Diez no está configurada»', async () => {
    const t = puerto({ bd: null })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ motivo: 'la conexión con Diez no está configurada para esta empresa' })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('C0008 CERRADO (R15): no se abre el cliente, no se escribe nada', async () => {
    const t = puerto({ bd: 'c0008' })
    const x = await enviarAsientoADiez('e1', t.p)
    expect(x.estado === 'no_llega' && x.motivo).toMatch(/C0008\) está cerrado/)
    expect(t.llamadas.cliente).toBe(0); expect(t.d.altas).toEqual([]); expect(t.d.subidas).toBe(0)
    expect(t.actual).toMatchObject({ attempts: 0, status: 'pendiente' })
  })
  it('C0001 VETADA', async () => {
    const t = puerto({ bd: 'C0001' })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', reintentar: false, motivo: 'la base C0001 de Diez no se toca nunca' })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('DIEZ SIN CONTENEDOR DE DOCUMENTOS (lo del R14): no se da de alta la factura', async () => {
    const t = puerto({ d: diez({ contenedor: false }) })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', motivo: TEXTO_CONTENEDOR })
    expect(t.d.altas).toEqual([]); expect(t.d.subidas).toBe(0)
  })
  it('el PDF guardado tiene que ser el registrado (su huella)', async () => {
    const t = puerto({ pdf: new TextEncoder().encode('%PDF otro') })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.d.altas).toEqual([])
  })
})

describe('enviarAsientoADiez (R15): el camino', () => {
  it('C0009: alta, documento subido y leído de vuelta igual → En Diez 1/1801, con analítica', async () => {
    const t = puerto()
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', serie: '1', documento: 1801, enlazada: false })
    expect(t.d.altas).toHaveLength(1)
    expect(t.d.altas[0]).toMatchObject({ NumeroFactura: 'UBR-FLO-20261001', NombreCliente: 'UBER EATS', CuentaCliente: '43000002' })
    expect((t.d.altas[0].Analitica as unknown[]).length).toBe(2)
    expect(t.actual).toMatchObject({ status: 'enviado', ext_series: '1', ext_number: 1801, attempts: 1, document_status: 'adjunto', document_id: 'd1', last_error: null })
    // La intención se apuntó ANTES de escribir en Diez.
    expect(t.filas[0]).toMatchObject({ status: 'pendiente', attempts: 1, last_error: 'enviando' })
  })
  it('NUNCA DOS VECES: si ya está en Diez, se enlaza y no se envía otra', async () => {
    const t = puerto({ d: diez({ facturas: [{ Ejercicio: '2026', Serie: '1', Documento: 1801, TipoAsiento: 1, Fecha: 20261001, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-FLO-20261001' }] }) })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', documento: 1801, enlazada: true })
    expect(t.d.altas).toEqual([])
    expect(t.actual).toMatchObject({ status: 'enlazado', attempts: 0, document_status: 'adjunto' })
  })
  it('dos con el mismo número en Diez: no se toca nada', async () => {
    const f = (doc: number): Factura => ({ Ejercicio: '2026', Serie: '1', Documento: doc, TipoAsiento: 1, Fecha: 20261001, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-FLO-20261001' })
    const t = puerto({ d: diez({ facturas: [f(1801), f(1802)] }) })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.d.altas).toEqual([]); expect(t.d.subidas).toBe(0)
  })
  it('SI EL ADJUNTO FALLA, NO ESTÁ «EN DIEZ»: «falta el documento»; Reintentar solo sube el documento', async () => {
    const d = diez({ subida: 503 })
    const t = puerto({ d })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', motivo: 'falta el documento', reintentar: true })
    expect(t.actual).toMatchObject({ status: 'enviado', ext_number: 1801, document_status: 'fallo' })
    // Reintentar, ya con Diez bien: no hay otra alta.
    const d2 = diez({ facturas: [] })
    const t2 = puerto({ d: d2, envio: t.actual })
    expect(await enviarAsientoADiez('e1', t2.p)).toMatchObject({ estado: 'en_diez', documento: 1801 })
    expect(d2.altas).toEqual([]); expect(d2.subidas).toBe(1)
    expect(t2.actual).toMatchObject({ status: 'enviado', document_status: 'adjunto', attempts: 2 })
  })
  it('si Diez devuelve otro documento después de subirlo, no está adjunto', async () => {
    const t = puerto({ d: diez({ devuelve: () => new TextEncoder().encode('%PDF-1.3 ' + 'y'.repeat(400)) }) })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', motivo: 'falta el documento' })
    expect(t.actual).toMatchObject({ document_status: 'fallo', document_error: 'Diez devuelve otro documento (otra huella)' })
  })
  it('lo que ya está en Diez con su documento no se vuelve a tocar', async () => {
    const t = puerto({ envio: { entry_id: 'e1', account_id: 'acc', company_id: 'emp', account_connector_id: 'k1', kind: 'factura', ext_year: '2026', ext_series: '1', ext_number: 1801, ext_invoice_number: 'UBR-FLO-20261001',
      payload_hash: 'h', status: 'enviado', attempts: 1, last_error: null, sent_at: 'x', document_id: 'd1', document_status: 'adjunto', document_error: null, document_attached_at: 'x' } })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', documento: 1801 })
    expect(t.filas).toEqual([]); expect(t.llamadas.cliente).toBe(0)
  })
  it('como mucho 3 intentos que escriben', async () => {
    const t = puerto({ envio: { entry_id: 'e1', account_id: 'acc', company_id: 'emp', account_connector_id: 'k1', kind: 'factura', ext_year: null, ext_series: null, ext_number: null, ext_invoice_number: 'UBR-FLO-20261001',
      payload_hash: 'h', status: 'pendiente', attempts: 3, last_error: 'x', sent_at: null, document_id: 'd1', document_status: 'pendiente', document_error: null, document_attached_at: null } })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.llamadas.cliente).toBe(0)
  })
})

describe('resumenDeAsiento (R15): el PDF sale del asiento', () => {
  const o = { correspondencia: CORRESPONDENCIA_LLORENTE29, generado: new Date('2026-10-13T10:00:00Z'), hoy: '2026-10-13' }
  it('Uber: con su factura; la base del pedido sin base, del total al 10 %', () => {
    const x = resumenDeAsiento(resumen(), o)
    expect(x.factura?.factura.NumeroFactura).toBe('UBR-FLO-20261001')
    expect(x.nombreFichero).toBe('ResumenDeVentas_UBR-FLO-20261001.pdf')
    expect(x.datos).toMatchObject({ numeroFactura: 'UBR-FLO-20261001', asiento: 'Ventas nº 1287', tipoIva: 10, factura: { base: 30, cuota: 3, total: 33 }, cobro: 33 })
    expect(x.datos.pedidos[1]).toEqual({ hora: '14:10', codigo: 'A2', marca: 'Milanesa House', base: 10, cuota: 1, total: 11 })
  })
  it('Glovo: sin factura de Diez, el PDF lleva el asiento y dice por qué no hay factura', () => {
    const x = resumenDeAsiento(resumen({ canal: { id: 'c2', slug: 'glovo', nombre: 'Glovo' }, lineas: resumen().lineas.map((l) => l.cuenta === '43000002' ? { ...l, cuenta: '43000001' } : l) }), o)
    expect(x.factura).toBeNull(); expect(x.sinFactura).toMatch(/glovo/)
    expect(x.datos.numeroFactura).toBeNull(); expect(x.nombreFichero).toBe('ResumenDeVentas_Ventas-1287.pdf')
  })
  it('el reembolso sale de sus líneas (708, 477 al debe, 430 al haber, con su documento)', () => {
    const lineas = [...resumen().lineas.map((l) => l.cuenta === '43000002' ? { ...l, debe: 33 } : l),
      { cuenta: '70800002', debe: 5, haber: 0, marca: 'Meraki Pita', tipoIva: null, documento: 'R9' }, { cuenta: '47700010', debe: 0.5, haber: 0, marca: null, tipoIva: 10, documento: 'R9' },
      { cuenta: '43000002', debe: 0, haber: 5.5, marca: null, tipoIva: null, documento: 'R9' }]
    const x = resumenDeAsiento(resumen({ lineas }), o)
    expect(x.datos.reembolsos).toEqual([{ hora: '—', codigo: 'R9', marca: 'Meraki Pita', base: 5, cuota: 0.5, total: 5.5 }])
    expect(x.datos.factura).toEqual({ base: 25, cuota: 2.5, total: 27.5 })
  })
  it('solo de lo validado y con número', () => {
    expect(() => resumenDeAsiento(resumen({ estado: 'propuesto', numero: null }), o)).toThrow(/validado/)
  })
})
