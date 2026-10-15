// D01 · Tarea 5 · Enviar a Diez (serie 2) una FACTURA RECIBIDA validada, con su
// PDF. Los mismos frenos que las ventas (diezEnviar.ts), contra dobles; lo que
// contesta Diez es lo medido en la C0009. Importes inventados.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { enviarRecibidaADiez, PDF_PENDIENTE, TEXTO_CONTENEDOR, type ClienteDiezEnvio, type EnvioFila, type PuertoEnvio, type RecibidaBD } from '../../../supabase/functions/_shared/diezEnviar'
import type { Factura, FacturaData } from '../../../supabase/functions/_shared/diezCliente'

const PDF = new TextEncoder().encode('%PDF-1.4 ' + 'y'.repeat(400))
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

const recibida = (o: Partial<RecibidaBD> = {}): RecibidaBD => ({
  id: 'r1', account_id: 'acc', company_id: 'emp', estado: 'validado', fecha: '2026-10-13',
  factura: { numero: 'PD01/77', fecha: '2026-10-11' }, proveedor: { nombre: 'MAYORISTA INVENTADO, S.L.', nif: 'B00000011' },
  lineas: [
    { cuenta: '60000000', debe: 100, haber: 0, tipoIva: null, baseIva: null },
    { cuenta: '47200010', debe: 10, haber: 0, tipoIva: 10, baseIva: 100 },
    { cuenta: '40000012', debe: 0, haber: 110, tipoIva: null, baseIva: null },
  ],
  documento: { id: 'd1', ruta: 'acc/r1/abcdef0123456789.pdf', nombre: 'PD01-77.pdf', sha256: sha(PDF) },
  ...o,
})

type Diez = ClienteDiezEnvio & { altas: FacturaData[]; subidas: number; guardado: Uint8Array | null; mesesPedidos: string[] }
function diez(o: { facturas?: Factura[]; contenedor?: boolean } = {}): Diez {
  const facturas = [...(o.facturas ?? [{ Ejercicio: '2026', Serie: '2', Documento: 3175, TipoAsiento: 2, Fecha: 20261013, CuentaCliente: '40000099', NumeroFactura: 'OTRA-1' }])]
  const d: Diez = {
    altas: [], subidas: 0, guardado: null, mesesPedidos: [],
    // Una recibida no busca cliente: si la pide, la prueba lo dice.
    async subcuenta() { throw new Error('una recibida no busca la subcuenta del cliente') },
    // Como Diez: el listado del mes filtra por la fecha del ASIENTO (Fecha), y repite filas.
    async facturasDelMes(m) { d.mesesPedidos.push(m); const delMes = facturas.filter((f) => String(f.Fecha ?? '').slice(0, 6) === m); return [...delMes, ...delMes] },
    async enviarFactura(fd) { d.altas.push(fd); const f = { ...fd, Documento: 3176 } as Factura; facturas.push(f); return f },
    async adjuntarDocumentoFactura(x) {
      d.subidas++
      if (o.contenedor === false) return { status: 500, json: { Message: 'The specified container does not exist.' } }
      d.guardado = Uint8Array.from(Buffer.from(x.Archivo, 'base64')); return { status: 200, json: {} }
    },
    async documentoDeFactura() {
      if (o.contenedor === false) return { status: 500, json: { ExceptionMessage: 'The specified container does not exist.' } }
      return d.guardado ? { status: 200, json: b64(d.guardado) } : { status: 404, json: null }
    },
  }
  return d
}

// adjuntar: ¿guarda Diez documentos? (C06b R7). Estas pruebas, como las de R15,
// son «con almacén» salvo la que dice lo contrario. autorizados: lo que Julio ha
// autorizado en conta_diez_autorizo para escribir en una base real.
type Autorizo = { alcance: 'asiento' | 'empresa'; entry?: string; bd: string }
function puerto(o: { r?: RecibidaBD; bd?: string | null; d?: Diez; adjuntar?: boolean; autorizados?: Autorizo[] } = {}) {
  let actual: EnvioFila | null = null
  const llamadas = { conexion: 0, cliente: 0 }
  const d = o.d ?? diez()
  const p: PuertoEnvio & { recibida(id: string): Promise<RecibidaBD> } = {
    resumen: async () => { throw new Error('una recibida no tiene resumen de ventas') },
    recibida: async () => o.r ?? recibida(),
    envio: async () => actual,
    guardar: async (f) => { actual = { ...f, id: f.id ?? 's1' }; return actual },
    conexion: async () => { llamadas.conexion++; return o.bd === null ? null : { id: 'k1', nombreBd: o.bd ?? 'C0009', adjuntar: o.adjuntar ?? true } },
    autorizado: async (id, _emp, bd) => (o.autorizados ?? []).some((a) => a.bd.toUpperCase() === bd.toUpperCase() && (a.alcance === 'empresa' || a.entry === id)),
    cliente: async () => { llamadas.cliente++; return d },
    documento: async () => PDF,
    sha256: async (b) => sha(b),
    correspondencia: () => null,
    ahora: () => new Date('2026-10-13T10:00:00Z'),
  }
  return { p, d, llamadas, get actual() { return actual } }
}

describe('enviarRecibidaADiez: la serie 2, con los frenos de siempre', () => {
  it('C0009: alta en la serie 2, documento subido y leído de vuelta → En Diez 2/3176', async () => {
    const t = puerto()
    const x = await enviarRecibidaADiez('r1', t.p)
    expect(x).toMatchObject({ estado: 'en_diez', serie: '2', documento: 3176, enlazada: false, texto: 'En Diez: 2/3176, con su documento.' })
    expect(t.d.altas[0]).toMatchObject({ Serie: '2', TipoAsiento: 2, TipoFactura: 1, CuentaCliente: '40000012', NumeroFactura: 'PD01/77', BaseImponible1: 100, PorcentajeIVA1: 10, CuotaIVA1: 10, TotalFactura: 110 })
    expect(t.actual).toMatchObject({ status: 'enviado', ext_series: '2', ext_number: 3176, document_status: 'adjunto' })
  })
  it('SIN DOCUMENTO NO SE ENVÍA: ni se abre la conexión', async () => {
    const t = puerto({ r: recibida({ documento: null }) })
    expect(await enviarRecibidaADiez('r1', t.p)).toMatchObject({ estado: 'no_llega', motivo: 'falta el documento' })
    expect(t.llamadas).toEqual({ conexion: 0, cliente: 0 })
  })
  it('DIEZ NO GUARDA DOCUMENTOS TODAVÍA: no se da de alta y lo dice', async () => {
    const t = puerto({ d: diez({ contenedor: false }) })
    expect(await enviarRecibidaADiez('r1', t.p)).toMatchObject({ estado: 'no_llega', motivo: TEXTO_CONTENEDOR, texto: `No ha llegado a Diez: ${TEXTO_CONTENEDOR}.` })
    expect(t.d.altas).toEqual([]); expect(t.d.subidas).toBe(0)
  })
  it('C06b R7 · sin almacén en Diez: la recibida va sin adjunto y queda «PDF pendiente en Diez»; sin PDF en Folvy, sigue sin ir', async () => {
    const t = puerto({ adjuntar: false })
    const x = await enviarRecibidaADiez('r1', t.p)
    expect(x).toMatchObject({ estado: 'en_diez', serie: '2', documento: 3176, pdfPendiente: true })
    expect(x.texto).toContain(PDF_PENDIENTE)
    expect(t.d.altas).toHaveLength(1); expect(t.d.subidas).toBe(0)
    expect(t.actual).toMatchObject({ status: 'enviado', document_status: 'pendiente_diez' })
    const sin = puerto({ r: recibida({ documento: null }), adjuntar: false })
    expect(await enviarRecibidaADiez('r1', sin.p)).toMatchObject({ estado: 'no_llega', motivo: 'falta el documento' })
    expect(sin.d.altas).toEqual([])
  })
  it('C0008 sin autorizar, cerrada; C0001, nunca (ni autorizada); lo autorizado para OTRO asiento no abre este', async () => {
    for (const [bd, autorizados] of [['C0008', []], ['C0001', [{ alcance: 'empresa', bd: 'C0001' }]], ['C0008', [{ alcance: 'asiento', entry: 'otro', bd: 'C0008' }]]] as [string, Autorizo[]][]) {
      const t = puerto({ bd, autorizados })
      expect(await enviarRecibidaADiez('r1', t.p)).toMatchObject({ estado: 'no_llega' })
      expect(t.llamadas.cliente).toBe(0)
    }
  })
  it('ni C0008 ni C0001', async () => {
    for (const bd of ['C0008', 'C0001']) {
      const t = puerto({ bd })
      expect(await enviarRecibidaADiez('r1', t.p)).toMatchObject({ estado: 'no_llega' })
      expect(t.llamadas.cliente).toBe(0)
    }
  })
  it('NUNCA DOS VECES: si ya está (serie 2, número y su 400), se enlaza', async () => {
    const t = puerto({ d: diez({ facturas: [{ Ejercicio: '2026', Serie: '2', Documento: 3175, TipoAsiento: 2, Fecha: 20261013, CuentaCliente: '40000012', NumeroFactura: 'PD01/77' }] }) })
    expect(await enviarRecibidaADiez('r1', t.p)).toMatchObject({ estado: 'en_diez', documento: 3175, enlazada: true })
    expect(t.d.altas).toEqual([])
  })
  it('lo propuesto no se envía; lo no medido (una retención) tampoco, y dice por qué, sin abrir la conexión', async () => {
    expect(await enviarRecibidaADiez('r1', puerto({ r: recibida({ estado: 'propuesto' }) }).p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    const t = puerto({ r: recibida({ lineas: [...recibida().lineas.slice(0, 2), { cuenta: '47510019', debe: 0, haber: 15, tipoIva: null, baseIva: null }, { cuenta: '40000012', debe: 0, haber: 95, tipoIva: null, baseIva: null }] }) })
    const x = await enviarRecibidaADiez('r1', t.p)
    expect(x.estado === 'no_llega' && x.motivo).toMatch(/retención/)
    expect(t.llamadas.conexion).toBe(0)
  })
})

// D01 · Antes de escribir, se busca la que Julio ya metió a mano en Diez (14/10):
// el mes de la factura y los siguientes hasta hoy, el número normalizado (la
// clave de conta_clave_numero) y el proveedor por su cuenta o por su NIF. Los
// casos son los que la búsqueda de antes no veía. Datos inventados.
const enDiezAMano = (o: Partial<Factura>): Factura => ({ Ejercicio: '2026', Serie: '2', Documento: 3100, TipoAsiento: 2, Fecha: 20261013, CuentaCliente: '40000012', NumeroFactura: 'PD01/77', ...o })

describe('enviarRecibidaADiez: la que ya está en Diez se enlaza, no se duplica', () => {
  it('1 · factura del 30/09 que Julio asentó el 02/10: se busca en septiembre y en octubre, y se enlaza', async () => {
    const d = diez({ facturas: [enDiezAMano({ Fecha: 20261002 })] })
    const t = puerto({ d, r: recibida({ factura: { numero: 'PD01/77', fecha: '2026-09-30' } }) })
    expect(await enviarRecibidaADiez('r1', t.p)).toMatchObject({ estado: 'en_diez', documento: 3100, enlazada: true })
    expect(d.altas).toEqual([])
    expect(d.mesesPedidos).toEqual(['202609', '202610'])
  })
  it('1b · y la del año anterior que se asentó en enero, se enlaza con SU ejercicio', async () => {
    const d = diez({ facturas: [enDiezAMano({ Ejercicio: '2027', Fecha: 20270105, Documento: 12 })] })
    const t = puerto({ d, r: recibida({ fecha: '2026-12-30', factura: { numero: 'PD01/77', fecha: '2026-12-30' } }) })
    t.p.ahora = () => new Date('2027-01-10T10:00:00Z')
    expect(await enviarRecibidaADiez('r1', t.p)).toMatchObject({ estado: 'en_diez', documento: 12, enlazada: true })
    expect(d.altas).toEqual([])
    expect(t.actual).toMatchObject({ status: 'enlazado', ext_year: '2027', ext_number: 12 })
  })
  it('2 · el número escrito de otra forma («PD01-77», «pd01 77») es el mismo: se enlaza', async () => {
    for (const NumeroFactura of ['PD01-77', 'pd01 77', 'PD-01/77']) {
      const d = diez({ facturas: [enDiezAMano({ NumeroFactura })] })
      const t = puerto({ d })
      expect(await enviarRecibidaADiez('r1', t.p), NumeroFactura).toMatchObject({ estado: 'en_diez', documento: 3100, enlazada: true })
      expect(d.altas).toEqual([])
    }
  })
  it('3 · metida en Diez con otra subcuenta pero su NIF: se enlaza; ni su cuenta ni su NIF: es otra, y se da de alta', async () => {
    const conNif = diez({ facturas: [enDiezAMano({ CuentaCliente: '41000007', CifCliente: 'ES-B00000011' })] })
    expect(await enviarRecibidaADiez('r1', puerto({ d: conNif }).p)).toMatchObject({ estado: 'en_diez', documento: 3100, enlazada: true })
    expect(conNif.altas).toEqual([])
    const otra = diez({ facturas: [enDiezAMano({ CuentaCliente: '41000007', CifCliente: 'B00000029' })] })
    expect(await enviarRecibidaADiez('r1', puerto({ d: otra }).p)).toMatchObject({ estado: 'en_diez', documento: 3176, enlazada: false })
    expect(otra.altas).toHaveLength(1)
  })
  it('lo de otra serie, aunque tenga el mismo número y proveedor, no es ella', async () => {
    const d = diez({ facturas: [enDiezAMano({ Serie: '1' })] })
    expect(await enviarRecibidaADiez('r1', puerto({ d }).p)).toMatchObject({ estado: 'en_diez', documento: 3176, enlazada: false })
  })
  it('si hay más de una (en dos meses), no se toca nada', async () => {
    const d = diez({ facturas: [enDiezAMano({ Fecha: 20260930, Documento: 3001 }), enDiezAMano({ Fecha: 20261005, NumeroFactura: 'PD01-77', Documento: 3101 })] })
    const t = puerto({ d, r: recibida({ factura: { numero: 'PD01/77', fecha: '2026-09-30' } }) })
    expect(await enviarRecibidaADiez('r1', t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(d.altas).toEqual([]); expect(d.subidas).toBe(0)
  })
  it('una factura de hace más de un año no se manda sola (no se busca a ciegas tan atrás)', async () => {
    const d = diez({ facturas: [] })
    const t = puerto({ d, r: recibida({ factura: { numero: 'PD01/77', fecha: '2025-09-01' } }) })
    const x = await enviarRecibidaADiez('r1', t.p)
    expect(x.estado === 'no_llega' && x.motivo).toMatch(/más de 12 meses/)
    expect(d.altas).toEqual([]); expect(d.mesesPedidos).toEqual([])
  })
})
