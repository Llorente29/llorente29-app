// C04b · R15 · Enviar a Diez un asiento de ventas validado, con su documento.
// Cada freno, uno a uno, contra dobles de la base y de Diez (lo que contesta
// Diez es lo MEDIDO en la C0009: el 500 «The specified container does not
// exist.» del R14, el listado que repite filas). Importes INVENTADOS.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { autorizacionCubre, enviarAsientoADiez, enviarContraasientoADiez, PDF_PENDIENTE, TEXTO_CONTENEDOR, type ClienteDiezEnvio, type ContraasientoBD, type EnvioFila, type PuertoEnvio } from '../../../supabase/functions/_shared/diezEnviar'
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
// subcuentas: lo que Diez tiene en su plan (por defecto, la 430 de Uber con su nombre, sin NIF ni nombre comercial, como la captura de Julio de C0008).
function diez(o: { facturas?: Factura[]; contenedor?: boolean; subida?: number; devuelve?: (g: Uint8Array | null) => Uint8Array | null; subcuentas?: Record<string, Record<string, unknown>> } = {}): Diez {
  const facturas = [...(o.facturas ?? [{ Ejercicio: '2026', Serie: '1', Documento: 1700, TipoAsiento: 1, Fecha: 20261001, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-CAM-20261001' }])]
  const subcuentas = o.subcuentas ?? { '43000002': { Codigo: '43000002', Descripcion: 'UBER EATS', NIF: '', NombreComercial: '' } }
  const d: Diez = {
    altas: [], subidas: 0, guardado: null,
    async subcuenta(codigo) { return subcuentas[codigo] ?? null },
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

// adjuntar: ¿guarda Diez documentos? Las pruebas de R15 son «con almacén» (true);
// las de C06b R7, el día de hoy: sin almacén (false). autorizados: lo que Julio
// ha autorizado en conta_diez_autorizo para escribir en una base real.
type Autorizo = { alcance: 'asiento' | 'empresa'; entry?: string; bd: string; desde?: string; recibidas?: boolean }
function puerto(o: { r?: ResumenBD; bd?: string | null; d?: Diez; envio?: EnvioFila | null; pdf?: Uint8Array; adjuntar?: boolean; autorizados?: Autorizo[] } = {}) {
  const filas: EnvioFila[] = []
  let actual: EnvioFila | null = o.envio ?? null
  const llamadas = { conexion: 0, cliente: 0, real: [] as boolean[] }
  const d = o.d ?? diez()
  const p: PuertoEnvio = {
    resumen: async () => o.r ?? resumen(),
    envio: async () => actual,
    guardar: async (f) => { actual = { ...f, id: f.id ?? 's1' }; filas.push(actual); return actual },
    conexion: async () => { llamadas.conexion++; return o.bd === null ? null : { id: 'k1', nombreBd: o.bd ?? 'C0009', adjuntar: o.adjuntar ?? true } },
    // La misma decisión que la función (autorizacionCubre), sobre las filas de esa base.
    autorizado: async (id, _emp, bd, fecha, tipo) => autorizacionCubre((o.autorizados ?? []).filter((a) => a.bd.toUpperCase() === bd.toUpperCase())
      .map((a) => ({ alcance: a.alcance, entry_id: a.entry ?? null, desde: a.desde ?? null, incluye_recibidas: a.recibidas ?? false })), id, fecha, tipo),
    cliente: async (_c, x) => { llamadas.cliente++; llamadas.real.push(x.real); return d },
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
    expect(t.llamadas).toMatchObject({ conexion: 0, cliente: 0 })
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
  it('C06 · la base REGISTRADA de otra empresa es real: cerrada igual que C0008, sin abrir el cliente', async () => {
    const t = puerto({ bd: 'C0042' })
    const x = await enviarAsientoADiez('e1', t.p)
    expect(x.estado === 'no_llega' && x.motivo).toBe('Diez real (C0042) está cerrado: no se escribe nada hasta que Julio lo autorice')
    expect(t.llamadas.cliente).toBe(0); expect(t.d.altas).toEqual([]); expect(t.d.subidas).toBe(0)
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

// ── C06b · Respuesta 7: a Diez sin esperar a Cegid ─────────────────────────────
const enDiez = (o: Partial<EnvioFila> = {}): EnvioFila => ({ entry_id: 'e1', account_id: 'acc', company_id: 'emp', account_connector_id: 'k1', kind: 'factura', ext_year: '2026', ext_series: '1', ext_number: 1801,
  ext_invoice_number: 'UBR-FLO-20261001', payload_hash: 'h', status: 'enviado', attempts: 1, last_error: null, sent_at: 'x', document_id: 'd1', document_status: 'pendiente_diez', document_error: null, document_attached_at: null, ...o })

describe('C06b R7 · sin almacén de documentos en Diez: la factura va sin adjunto', () => {
  it('C0009: alta SIN subir el PDF ni preguntar por el almacén → «En Diez · 1/1801 · PDF pendiente en Diez»', async () => {
    const d = diez({ contenedor: false })
    const t = puerto({ d, adjuntar: false })
    const x = await enviarAsientoADiez('e1', t.p)
    expect(x).toMatchObject({ estado: 'en_diez', serie: '1', documento: 1801, enlazada: false, pdfPendiente: true })
    expect(x.texto).toContain(PDF_PENDIENTE)
    expect(d.altas).toHaveLength(1); expect(d.subidas).toBe(0)
    expect(t.actual).toMatchObject({ status: 'enviado', ext_number: 1801, attempts: 1, document_status: 'pendiente_diez', document_error: null, last_error: null })
  })
  it('SIN DOCUMENTO EN FOLVY SIGUE SIN ENVIARSE, aunque Diez no lo pida', async () => {
    const t = puerto({ r: resumen({ documento: null }), adjuntar: false })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', motivo: 'falta el documento' })
    expect(t.llamadas).toMatchObject({ conexion: 0, cliente: 0 }); expect(t.d.altas).toEqual([])
  })
  it('NUNCA DOS VECES: enviar otra vez lo que ya está con el PDF pendiente no habla con Diez', async () => {
    const t = puerto({ envio: enDiez(), adjuntar: false })
    const x = await enviarAsientoADiez('e1', t.p)
    expect(x).toMatchObject({ estado: 'en_diez', documento: 1801, pdfPendiente: true })
    expect(x.texto).toBe('Ya estaba en Diez: 1/1801. PDF pendiente en Diez.')
    expect(t.llamadas.cliente).toBe(0); expect(t.filas).toEqual([]); expect(t.d.altas).toEqual([])
  })
  it('NUNCA DOS VECES: si la factura ya está en Diez (otro envío, o a mano), se enlaza y no se da otra de alta', async () => {
    const d = diez({ facturas: [{ Ejercicio: '2026', Serie: '1', Documento: 1801, TipoAsiento: 1, Fecha: 20261001, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-FLO-20261001' }] })
    const t = puerto({ d, adjuntar: false })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', documento: 1801, enlazada: true, pdfPendiente: true })
    expect(d.altas).toEqual([]); expect(d.subidas).toBe(0)
    expect(t.actual).toMatchObject({ status: 'enlazado', attempts: 0, document_status: 'pendiente_diez' })
  })
  it('el envío cortado a medias (intención apuntada, sin respuesta): al reintentar lo busca y lo enlaza, no da otra de alta', async () => {
    const d = diez({ facturas: [{ Ejercicio: '2026', Serie: '1', Documento: 1801, TipoAsiento: 1, Fecha: 20261001, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-FLO-20261001' }] })
    const t = puerto({ d, adjuntar: false, envio: enDiez({ status: 'pendiente', ext_year: null, ext_series: null, ext_number: null, last_error: 'enviando', document_status: 'pendiente' }) })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', documento: 1801, enlazada: true })
    expect(d.altas).toEqual([])
  })
  it('EL DÍA QUE CEGID ACTIVE EL ALMACÉN: el mismo envío solo sube el PDF de lo pendiente (sin otra alta) y queda adjunto por Diez', async () => {
    const d = diez({ facturas: [] })
    const t = puerto({ d, adjuntar: true, envio: enDiez() })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', documento: 1801, pdfPendiente: false })
    expect(d.altas).toEqual([]); expect(d.subidas).toBe(1)
    expect(t.actual).toMatchObject({ document_status: 'adjunto', document_attached_via: 'diez' })
  })
  it('lo marcado «Ya está adjunto» no se vuelve a tocar', async () => {
    const t = puerto({ envio: enDiez({ document_status: 'adjunto', document_attached_via: 'a_mano' }), adjuntar: true })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', pdfPendiente: false })
    expect(t.llamadas.conexion).toBe(0); expect(t.filas).toEqual([])
  })
})

describe('C06b R7 · Diez real, solo con lo que autoriza Julio', () => {
  it('C0008 sin autorización: cerrado como hasta hoy, sin abrir el cliente', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false })
    const x = await enviarAsientoADiez('e1', t.p)
    expect(x.estado === 'no_llega' && x.motivo).toBe('Diez real (C0008) está cerrado: no se escribe nada hasta que Julio lo autorice')
    expect(t.llamadas.cliente).toBe(0); expect(t.d.altas).toEqual([])
  })
  it('C0008 con ESE asiento autorizado: se envía, con escribirEnReal', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false, autorizados: [{ alcance: 'asiento', entry: 'e1', bd: 'C0008' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', documento: 1801, pdfPendiente: true })
    expect(t.llamadas.real).toEqual([true]); expect(t.d.altas).toHaveLength(1)
  })
  it('C0008 con OTRO asiento autorizado: este no', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false, autorizados: [{ alcance: 'asiento', entry: 'e9', bd: 'C0008' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega' })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('la autorización es de una base: la de C0008 no abre otra base real', async () => {
    const t = puerto({ bd: 'C0042', adjuntar: false, autorizados: [{ alcance: 'empresa', bd: 'C0008' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega' })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('C0008 con la empresa autorizada: cualquier asiento validado', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false, autorizados: [{ alcance: 'empresa', bd: 'C0008' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez' })
  })
  it('C0001, NI AUTORIZADA', async () => {
    const t = puerto({ bd: 'C0001', adjuntar: false, autorizados: [{ alcance: 'empresa', bd: 'C0001' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', reintentar: false, motivo: 'la base C0001 de Diez no se toca nunca' })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('C0009 (pruebas) no necesita autorización y no va con escribirEnReal', async () => {
    const t = puerto({ adjuntar: false })
    await enviarAsientoADiez('e1', t.p)
    expect(t.llamadas.real).toEqual([false])
  })
})

// ── C06b R7 · El cliente se busca por su cuenta (Julio, captura de C0008) ───────
describe('C06b R7 · el cliente, por su subcuenta en Diez (no por NIF ni por nombre comercial)', () => {
  it('C0008 sin ninguna factura de Uber en el mes: el nombre sale de la subcuenta 43000002 («UBER EATS») y la factura va sin NIF', async () => {
    const d = diez({ facturas: [] })
    const t = puerto({ d, bd: 'C0008', adjuntar: false, autorizados: [{ alcance: 'asiento', entry: 'e1', bd: 'C0008' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', documento: 1801, pdfPendiente: true })
    expect(d.altas).toHaveLength(1)
    expect(d.altas[0]).toMatchObject({ CuentaCliente: '43000002', NombreCliente: 'UBER EATS' })
    expect(JSON.stringify(d.altas[0])).not.toMatch(/"(CifCliente|NifCliente|NIF)":"[^"]/)
  })
  it('el nombre comercial y el NIF no cuentan: manda la Descripcion de la subcuenta', async () => {
    const d = diez({ facturas: [], subcuentas: { '43000002': { Codigo: '43000002', Descripcion: 'UBER EATS', NIF: 'B00000000', NombreComercial: 'Otro nombre' } } })
    const t = puerto({ d, adjuntar: false })
    await enviarAsientoADiez('e1', t.p)
    expect(d.altas[0]).toMatchObject({ NombreCliente: 'UBER EATS' })
  })
  it('la subcuenta del cliente no está en Diez: no se da de alta nada y no se reintenta solo', async () => {
    const d = diez({ facturas: [], subcuentas: {} })
    const t = puerto({ d, adjuntar: false })
    const x = await enviarAsientoADiez('e1', t.p)
    expect(x).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(x.estado === 'no_llega' && x.motivo).toBe('la subcuenta 43000002 del cliente no está en Diez: no se inventa')
    expect(d.altas).toEqual([]); expect(t.actual).toMatchObject({ attempts: 0 })
  })
  it('la subcuenta sin nombre: no se inventa', async () => {
    const d = diez({ facturas: [], subcuentas: { '43000002': { Codigo: '43000002', Descripcion: '  ' } } })
    const t = puerto({ d, adjuntar: false })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', motivo: 'la subcuenta 43000002 de Diez no tiene nombre: no se inventa' })
    expect(d.altas).toEqual([])
  })
  it('si Diez devuelve OTRA subcuenta que la pedida, para', async () => {
    const d = diez({ facturas: [], subcuentas: { '43000002': { Codigo: '43000001', Descripcion: 'GLOVO' } } })
    const t = puerto({ d, adjuntar: false })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(d.altas).toEqual([])
  })
  it('si la factura ya está en Diez, se enlaza sin mirar la subcuenta (nunca dos veces)', async () => {
    const d = diez({ facturas: [{ Ejercicio: '2026', Serie: '1', Documento: 1801, TipoAsiento: 1, Fecha: 20261001, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-FLO-20261001' }], subcuentas: {} })
    const t = puerto({ d, adjuntar: false })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez', enlazada: true })
    expect(d.altas).toEqual([])
  })
})

// ── C06b R8 · al anular lo que está en Diez, el contraasiento va a Diez ─────────
describe('C06b R8 · el contraasiento de lo anulado, a Diez (nunca dos veces)', () => {
  const CONTRA: ContraasientoBD = { id: 'c1', account_id: 'acc', company_id: 'emp', estado: 'validado', fecha: '2026-10-14', origen: 'reversal', anula: 'e1', numero: 1290 }
  const enDiez = (o: Partial<EnvioFila> = {}): EnvioFila => ({
    id: 's-e1', entry_id: 'e1', account_id: 'acc', company_id: 'emp', account_connector_id: 'k1', kind: 'factura', ext_year: '2026', ext_series: '1', ext_number: 1801,
    ext_invoice_number: 'UBR-FLO-20261001', payload_hash: 'h', status: 'enviado', attempts: 1, last_error: null, sent_at: '2026-10-13T10:00:00Z',
    document_id: 'd1', document_status: 'pendiente_diez', document_error: null, document_attached_at: null, ...o,
  })
  // Un envío por asiento, como el índice único de external_send: el de lo anulado y el del contraasiento, cada uno el suyo.
  function conAnulado(o: { original?: EnvioFila | null; contra?: EnvioFila | null; d?: Diez; bd?: string; autorizados?: Autorizo[] } = {}) {
    const t = puerto({ r: resumen({ estado: 'anulado' }), d: o.d, bd: o.bd, autorizados: o.autorizados, adjuntar: false })
    const envios = new Map<string, EnvioFila | null>([['e1', o.original === undefined ? enDiez() : o.original], ['c1', o.contra ?? null]])
    const guardadas: EnvioFila[] = []
    t.p.envio = async (id) => envios.get(id) ?? null
    t.p.guardar = async (f) => { const g = { ...f, id: f.id ?? `s-${f.entry_id}` }; envios.set(f.entry_id, g); guardadas.push(g); return g }
    return { ...t, envios, guardadas }
  }

  it('manda la factura que anula: los mismos importes en negativo, su número y a qué factura apunta', async () => {
    const t = conAnulado()
    const r = await enviarContraasientoADiez(CONTRA, t.p)
    expect(r).toMatchObject({ estado: 'en_diez', serie: '1', documento: 1801, enlazada: false })
    expect(r.texto).toBe('Anulada también en Diez: 1/1801 (UBR-FLO-20261001) con 1/1801 (UBR-FLO-20261001-ANUL).')
    expect(t.d.altas).toHaveLength(1)
    const fd = t.d.altas[0]
    expect(fd).toMatchObject({ Ejercicio: '2026', Serie: '1', CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-FLO-20261001-ANUL',
      Fecha: 20261014, FechaFactura: 20261014, BaseImponible1: -30, CuotaIVA1: -3, TotalFactura: -33, TotalGastosIngresos: -30, TipoFactura: 1, Descripcion: 'ANUL UBER EATS FLO 01/10' })
    // Como la anulación de la gestoría en la C0009: sin campos de rectificativa.
    for (const k of ['TipoRectificativa', 'NumeroFacturaRectificativa', 'FechaFacturaRectificativa', 'TotalBasesRectificativa', 'TotalCuotasRectificativa', 'ClaveTipoFactura']) expect(fd, k).not.toHaveProperty(k)
    expect((fd.Apuntes as { Importe: number }[]).map((a) => a.Importe)).toEqual([-10, -20])
    expect(String(fd.Descripcion).length).toBeLessThanOrEqual(40)
    // Su envío es el del contraasiento; el de lo anulado no se toca.
    expect(t.envios.get('c1')).toMatchObject({ status: 'enviado', ext_number: 1801, ext_invoice_number: 'UBR-FLO-20261001-ANUL', document_status: null, attempts: 1 })
    expect(t.envios.get('e1')).toEqual(enDiez())
  })
  it('lo que no llegó a Diez no se anula allí: no se habla con Diez ni se apunta nada', async () => {
    const t = conAnulado({ original: null })
    expect(await enviarContraasientoADiez(CONTRA, t.p)).toMatchObject({ estado: 'no_llega', reintentar: false, motivo: 'lo que anula no llegó a Diez: allí no hay nada que anular' })
    expect(t.llamadas.cliente).toBe(0); expect(t.guardadas).toEqual([])
  })
  it('nunca dos veces: ya enviado, no habla con Diez', async () => {
    const t = conAnulado({ contra: { ...enDiez({ entry_id: 'c1', id: 's-c1', ext_number: 1802, ext_invoice_number: 'UBR-FLO-20261001-ANUL', document_status: null }) } })
    const r = await enviarContraasientoADiez(CONTRA, t.p)
    expect(r).toMatchObject({ estado: 'en_diez', documento: 1802 })
    expect(r.texto).toBe('Ya estaba anulada en Diez: 1/1801, con 1/1802.')
    expect(t.llamadas.cliente).toBe(0); expect(t.d.altas).toEqual([])
  })
  it('nunca dos veces: si la que anula ya está en Diez (metida a mano o un envío cortado), se enlaza', async () => {
    const d = diez({ facturas: [{ Ejercicio: '2026', Serie: '1', Documento: 1950, TipoAsiento: 1, Fecha: 20261014, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-FLO-20261001-ANUL' }] })
    const t = conAnulado({ d })
    expect(await enviarContraasientoADiez(CONTRA, t.p)).toMatchObject({ estado: 'en_diez', documento: 1950, enlazada: true })
    expect(d.altas).toEqual([])
    expect(t.envios.get('c1')).toMatchObject({ status: 'enlazado', ext_number: 1950 })
  })
  it('dos con ese número en Diez: no se toca nada', async () => {
    const f = { Ejercicio: '2026', Serie: '1', TipoAsiento: 1, Fecha: 20261014, CuentaCliente: '43000002', NumeroFactura: 'UBR-FLO-20261001-ANUL' }
    const d = diez({ facturas: [{ ...f, Documento: 1950 }, { ...f, Documento: 1951 }] })
    const t = conAnulado({ d })
    expect(await enviarContraasientoADiez(CONTRA, t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(d.altas).toEqual([])
  })
  it('si la factura rehecha no es la que está en Diez, no anula a ciegas', async () => {
    const t = conAnulado({ original: enDiez({ ext_invoice_number: 'UBR-CAM-20261001' }) })
    expect(await enviarContraasientoADiez(CONTRA, t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.d.altas).toEqual([])
  })
  it('C0001, nunca; Diez real, solo con lo autorizado (el asiento que anula vale: autorizar escribirla es autorizar anularla)', async () => {
    const vetada = conAnulado({ bd: 'C0001' })
    expect(await enviarContraasientoADiez(CONTRA, vetada.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(vetada.llamadas.cliente).toBe(0)
    const cerrada = conAnulado({ bd: 'C0008' })
    expect((await enviarContraasientoADiez(CONTRA, cerrada.p)).texto).toMatch(/Diez real \(C0008\) está cerrado/)
    expect(cerrada.llamadas.cliente).toBe(0)
    const porElAnulado = conAnulado({ bd: 'C0008', autorizados: [{ alcance: 'asiento', entry: 'e1', bd: 'C0008' }] })
    expect(await enviarContraasientoADiez(CONTRA, porElAnulado.p)).toMatchObject({ estado: 'en_diez' })
    expect(porElAnulado.llamadas.real).toEqual([true])
    const otroAsiento = conAnulado({ bd: 'C0008', autorizados: [{ alcance: 'asiento', entry: 'otro', bd: 'C0008' }] })
    expect(await enviarContraasientoADiez(CONTRA, otroAsiento.p)).toMatchObject({ estado: 'no_llega' })
  })
  it('solo el contraasiento validado de una anulación', async () => {
    const t = conAnulado()
    expect(await enviarContraasientoADiez({ ...CONTRA, origen: 'manual', anula: null }, t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(await enviarContraasientoADiez({ ...CONTRA, estado: 'borrador' }, t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('si Diez no lo acepta, queda la intención apuntada (un intento) y se puede reintentar; el reintento lo encuentra si sí entró', async () => {
    const d = diez()
    d.enviarFactura = async () => { throw new Error('facturas/add → 500') }
    const t = conAnulado({ d })
    expect(await enviarContraasientoADiez(CONTRA, t.p)).toMatchObject({ estado: 'no_llega', reintentar: true })
    expect(t.envios.get('c1')).toMatchObject({ status: 'pendiente', attempts: 1 })
    expect(String(t.envios.get('c1')?.last_error)).toMatch(/Diez no ha aceptado el contraasiento/)
  })
})

// ── C06b R8 · tarea 1: la empresa autorizada «desde» una fecha ─────────────────
describe('C06b R8 · la autorización de empresa con «desde» (0730)', () => {
  // resumen(): el asiento e1 es del 01/10 (fecha 2026-10-01).
  it('desde el mismo día: entra (inclusive)', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false, autorizados: [{ alcance: 'empresa', bd: 'C0008', desde: '2026-10-01' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez' })
    expect(t.llamadas.real).toEqual([true])
  })
  it('un asiento anterior a «desde»: cerrado como sin autorización, sin abrir el cliente', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false, r: resumen({ fecha: '2026-09-30' }), autorizados: [{ alcance: 'empresa', bd: 'C0008', desde: '2026-10-01' }] })
    const x = await enviarAsientoADiez('e1', t.p)
    expect(x.estado === 'no_llega' && x.motivo).toBe('Diez real (C0008) está cerrado: no se escribe nada hasta que Julio lo autorice')
    expect(t.llamadas.cliente).toBe(0); expect(t.d.altas).toEqual([])
  })
  it('sin «desde», la de empresa vale para cualquier fecha (como hasta hoy)', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false, r: resumen({ fecha: '2026-01-15' }), autorizados: [{ alcance: 'empresa', bd: 'C0008' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez' })
  })
  it('la de un asiento vale para ESE asiento, sea de la fecha que sea', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false, r: resumen({ fecha: '2026-09-30' }), autorizados: [{ alcance: 'asiento', entry: 'e1', bd: 'C0008' }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez' })
  })
  it('la fila de C0008 como irá (desde 01/10, sin recibidas): una venta de octubre PASA', async () => {
    const t = puerto({ bd: 'C0008', adjuntar: false, autorizados: [{ alcance: 'empresa', bd: 'C0008', desde: '2026-10-01', recibidas: false }] })
    expect(await enviarAsientoADiez('e1', t.p)).toMatchObject({ estado: 'en_diez' })
  })
  it('autorizacionCubre por tipo: las recibidas solo con incluye_recibidas; las ventas, siempre', () => {
    const sin = [{ alcance: 'empresa', entry_id: null, desde: '2026-10-01', incluye_recibidas: false }]
    expect(autorizacionCubre(sin, 'e1', '2026-10-13', 'ventas')).toBe(true)
    expect(autorizacionCubre(sin, 'e1', '2026-10-13', 'recibidas')).toBe(false)
    expect(autorizacionCubre([{ ...sin[0], incluye_recibidas: true }], 'e1', '2026-10-13', 'recibidas')).toBe(true)
    expect(autorizacionCubre([{ ...sin[0], incluye_recibidas: true }], 'e1', '2026-09-30', 'recibidas')).toBe(false)
    // Sin la columna (antes de la 0740): las recibidas, cerradas.
    expect(autorizacionCubre([{ alcance: 'empresa', entry_id: null, desde: null }], 'e1', '2026-10-13', 'recibidas')).toBe(false)
  })
  it('autorizacionCubre: por id el asiento; la empresa desde su día; nada más', () => {
    const A = [{ alcance: 'empresa', entry_id: null, desde: '2026-10-01' }, { alcance: 'asiento', entry_id: 'e7', desde: null }]
    expect(autorizacionCubre(A, 'e1', '2026-10-01')).toBe(true)
    expect(autorizacionCubre(A, 'e1', '2026-10-31')).toBe(true)
    expect(autorizacionCubre(A, 'e1', '2026-09-30')).toBe(false)
    expect(autorizacionCubre(A, 'e7', '2025-01-01')).toBe(true)
    expect(autorizacionCubre([], 'e1', '2026-10-01')).toBe(false)
    // Lo que devuelve PostgREST de una columna date es AAAA-MM-DD; si viniera con hora, cuenta el día.
    expect(autorizacionCubre([{ alcance: 'empresa', entry_id: null, desde: '2026-10-01T00:00:00' }], 'e1', '2026-10-01')).toBe(true)
  })
})

describe('C06b R8 · el contraasiento, con la fecha de lo que ANULA', () => {
  const enDiez: EnvioFila = {
    id: 's-e1', entry_id: 'e1', account_id: 'acc', company_id: 'emp', account_connector_id: 'k1', kind: 'factura', ext_year: '2026', ext_series: '1', ext_number: 1801,
    ext_invoice_number: 'UBR-FLO-20261001', payload_hash: 'h', status: 'enviado', attempts: 1, last_error: null, sent_at: '2026-10-13T10:00:00Z',
    document_id: 'd1', document_status: 'pendiente_diez', document_error: null, document_attached_at: null,
  }
  function anulado(fechaOriginal: string, desde: string) {
    const t = puerto({ r: resumen({ estado: 'anulado', fecha: fechaOriginal }), bd: 'C0008', adjuntar: false, autorizados: [{ alcance: 'empresa', bd: 'C0008', desde }] })
    const envios = new Map<string, EnvioFila | null>([['e1', { ...enDiez, ext_invoice_number: `UBR-FLO-${fechaOriginal.replaceAll('-', '')}` }]])
    t.p.envio = async (id) => envios.get(id) ?? null
    t.p.guardar = async (f) => { const g = { ...f, id: f.id ?? `s-${f.entry_id}` }; envios.set(f.entry_id, g); return g }
    return t
  }
  // El contraasiento es del 14/10 (posterior a «desde»): lo que decide es la fecha de lo anulado.
  const CONTRA: ContraasientoBD = { id: 'c1', account_id: 'acc', company_id: 'emp', estado: 'validado', fecha: '2026-10-14', origen: 'reversal', anula: 'e1', numero: 1290 }
  it('anular algo de antes de «desde»: cerrado, aunque el contraasiento sea de después', async () => {
    const t = anulado('2026-09-30', '2026-10-01')
    expect(await enviarContraasientoADiez(CONTRA, t.p)).toMatchObject({ estado: 'no_llega', motivo: 'Diez real (C0008) está cerrado: no se escribe nada hasta que Julio lo autorice' })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('anular algo desde «desde»: entra', async () => {
    const t = anulado('2026-10-01', '2026-10-01')
    expect(await enviarContraasientoADiez(CONTRA, t.p)).toMatchObject({ estado: 'en_diez' })
    expect(t.llamadas.real).toEqual([true])
  })
})
