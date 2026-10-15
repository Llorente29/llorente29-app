// D01 · Anular en Diez una FACTURA RECIBIDA ya enviada (15/10): su contraasiento
// va a la serie 2 como la recibida con «-ANUL», igual que las ventas, con los
// mismos frenos (nunca dos veces, C0001 nunca, solo lo autorizado). Contra
// dobles; Diez lista por la fecha del ASIENTO, como el de verdad. Importes y
// nombres inventados.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { enviarContraasientoRecibidaADiez, type ClienteDiezEnvio, type ContraasientoBD, type EnvioFila, type PuertoEnvio, type RecibidaBD } from '../../../supabase/functions/_shared/diezEnviar'
import { facturaRecibida, facturaRecibidaQueAnula } from '../../../supabase/functions/_shared/diezRecibida'
import { MAX_INTENTOS, type Factura, type FacturaData } from '../../../supabase/functions/_shared/diezCliente'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const recibida = (o: Partial<RecibidaBD> = {}): RecibidaBD => ({
  id: 'r1', account_id: 'acc', company_id: 'emp', estado: 'anulado', fecha: '2026-10-13',
  factura: { numero: 'PD01/77', fecha: '2026-10-11' }, proveedor: { nombre: 'MAYORISTA INVENTADO, S.L.', nif: 'B00000011' },
  lineas: [
    { cuenta: '60000000', debe: 100, haber: 0, tipoIva: null, baseIva: null },
    { cuenta: '60200000', debe: 50, haber: 0, tipoIva: null, baseIva: null },
    { cuenta: '47200010', debe: 10, haber: 0, tipoIva: 10, baseIva: 100 },
    { cuenta: '47200021', debe: 10.5, haber: 0, tipoIva: 21, baseIva: 50 },
    { cuenta: '40000012', debe: 0, haber: 170.5, tipoIva: null, baseIva: null },
  ],
  documento: { id: 'd1', ruta: 'acc/r1/abcdef0123456789.pdf', nombre: 'PD01-77.pdf', sha256: 'x' },
  ...o,
})
const contra = (o: Partial<ContraasientoBD> = {}): ContraasientoBD => ({ id: 'c1', account_id: 'acc', company_id: 'emp', estado: 'validado', fecha: '2026-10-14', origen: 'reversal', anula: 'r1', numero: 1902, ...o })
const enviada = (o: Partial<EnvioFila> = {}): EnvioFila => ({
  id: 's-r1', entry_id: 'r1', account_id: 'acc', company_id: 'emp', account_connector_id: 'k1', kind: 'factura', ext_year: '2026', ext_series: '2', ext_number: 3176,
  ext_invoice_number: 'PD01/77', payload_hash: 'h', status: 'enviado', attempts: 1, sent_at: '2026-10-13T10:00:00Z', document_id: 'd1', document_status: 'adjunto', document_error: null, document_attached_at: null, ...o,
} as EnvioFila)

type Diez = ClienteDiezEnvio & { altas: FacturaData[]; mesesPedidos: string[] }
function diez(o: { facturas?: Factura[]; falla?: boolean } = {}): Diez {
  const facturas = [...(o.facturas ?? [{ Ejercicio: '2026', Serie: '2', Documento: 3176, TipoAsiento: 2, Fecha: 20261013, CuentaCliente: '40000012', NumeroFactura: 'PD01/77' }])]
  const d: Diez = {
    altas: [], mesesPedidos: [],
    async subcuenta() { throw new Error('una recibida no busca la subcuenta del cliente') },
    async facturasDelMes(m) { d.mesesPedidos.push(m); const delMes = facturas.filter((f) => String(f.Fecha ?? '').slice(0, 6) === m); return [...delMes, ...delMes] },
    async enviarFactura(fd) {
      if (o.falla) throw new Error('500 de Diez')
      d.altas.push(fd); const f = { ...fd, Documento: 3190 } as Factura; facturas.push(f); return f
    },
    async adjuntarDocumentoFactura() { throw new Error('un contraasiento no lleva PDF') },
    async documentoDeFactura() { throw new Error('un contraasiento no lleva PDF') },
  }
  return d
}

type Autorizo = { alcance: 'asiento' | 'empresa'; entry?: string; bd: string }
function puerto(o: { r?: RecibidaBD; orig?: EnvioFila | null; bd?: string | null; d?: Diez; autorizados?: Autorizo[]; previo?: EnvioFila | null; ahora?: string } = {}) {
  const filas = new Map<string, EnvioFila | null>([['r1', o.orig === undefined ? enviada() : o.orig], ['c1', o.previo ?? null]])
  const llamadas = { conexion: 0, cliente: 0, guardar: 0 }
  const d = o.d ?? diez()
  const p: PuertoEnvio & { recibida(id: string): Promise<RecibidaBD> } = {
    resumen: async () => { throw new Error('una recibida no tiene resumen de ventas') },
    recibida: async (id) => { if (id !== 'r1') throw new Error(`se ha pedido otra recibida: ${id}`); return o.r ?? recibida() },
    envio: async (id) => filas.get(id) ?? null,
    guardar: async (f) => { llamadas.guardar++; const g = { ...f, id: f.id ?? 's-c1' }; filas.set(String(f.entry_id), g); return g },
    conexion: async () => { llamadas.conexion++; return o.bd === null ? null : { id: 'k1', nombreBd: o.bd ?? 'C0009', adjuntar: true } },
    autorizado: async (id, _emp, bd) => (o.autorizados ?? []).some((a) => a.bd.toUpperCase() === bd.toUpperCase() && (a.alcance === 'empresa' || a.entry === id)),
    cliente: async () => { llamadas.cliente++; return d },
    documento: async () => { throw new Error('un contraasiento no lleva PDF') },
    sha256: async (b) => sha(b),
    correspondencia: () => null,
    ahora: () => new Date(o.ahora ?? '2026-10-14T10:00:00Z'),
  }
  return { p, d, llamadas, get envio() { return filas.get('c1') ?? null } }
}

describe('facturaRecibidaQueAnula: la recibida con «-ANUL», como las ventas', () => {
  const original = facturaRecibida({ fecha: '2026-10-13', fechaFactura: '2026-10-11', numero: 'PD01/77', proveedor: { nombre: 'MAYORISTA INVENTADO, S.L.', nif: 'B00000011' }, lineas: recibida().lineas }, { hoy: '2026-10-13' }).factura
  const a = facturaRecibidaQueAnula(original, { fecha: '2026-10-14', hoy: '2026-10-15' })
  it('el número con «-ANUL», la descripción con «ANUL », la fecha del contraasiento; la cuenta, el NIF y el nombre, los de la original', () => {
    expect(a).toMatchObject({
      Serie: '2', TipoAsiento: 2, TipoFactura: 1, Ejercicio: '2026', NumeroFactura: 'PD01/77-ANUL', Fecha: 20261014, FechaFactura: 20261014, FechaIntroduccionFactura: 20261015,
      CuentaCliente: '40000012', CifCliente: 'B00000011', NombreCliente: 'MAYORISTA INVENTADO, S.L.',
    })
    expect(String(a.Descripcion)).toBe('ANUL PD01/77-MAYORISTA INVENTADO, S.L.')
    expect(a.Documento).toBeUndefined()
  })
  it('los tres tipos, el total y cada apunte, en negativo; el porcentaje se queda', () => {
    expect(a).toMatchObject({ BaseImponible1: -50, PorcentajeIVA1: 21, CuotaIVA1: -10.5, BaseImponible2: -100, PorcentajeIVA2: 10, CuotaIVA2: -10, TotalFactura: -170.5, TotalGastosIngresos: -150 })
    expect((a.Apuntes as { Cuenta: string; Importe: number; Concepto: string; Fecha: number }[]).map((x) => [x.Cuenta, x.Importe, x.Concepto, x.Fecha])).toEqual([
      ['60000000', -100, a.Descripcion, 20261014], ['60200000', -50, a.Descripcion, 20261014],
    ])
    // Anular dos veces devuelve los importes de la original: nada se pierde en el redondeo.
    const b = facturaRecibidaQueAnula({ ...a, NumeroFactura: 'PD01/77' }, { fecha: '2026-10-14', hoy: '2026-10-15' })
    expect([b.BaseImponible1, b.CuotaIVA1, b.BaseImponible2, b.CuotaIVA2, b.TotalFactura]).toEqual([50, 10.5, 100, 10, 170.5])
  })
  it('sin campos de rectificativa (lo medido en las ventas: no se inventa)', () => {
    for (const k of ['FacturaRectificativa', 'TipoRectificativa', 'NumeroFacturaRectificativa', 'FechaFacturaRectificativa']) expect(a[k]).toBeUndefined()
  })
  it('una que no es de la serie 2, o sin número, no se anula como recibida', () => {
    expect(() => facturaRecibidaQueAnula({ ...original, Serie: '1' }, { fecha: '2026-10-14', hoy: '2026-10-15' })).toThrow(/serie 2/)
    expect(() => facturaRecibidaQueAnula({ ...original, NumeroFactura: ' ' }, { fecha: '2026-10-14', hoy: '2026-10-15' })).toThrow(/número/)
  })
})

describe('enviarContraasientoRecibidaADiez: la anulación de una recibida, a Diez', () => {
  it('C0009: alta de la «-ANUL» en la serie 2, sin PDF, y el envío del contraasiento apuntado', async () => {
    const t = puerto()
    const x = await enviarContraasientoRecibidaADiez(contra(), t.p)
    expect(x).toMatchObject({ estado: 'en_diez', serie: '2', documento: 3190, enlazada: false, pdfPendiente: false })
    expect(x.texto).toBe('Anulada también en Diez: 2/3176 (PD01/77) con 2/3190 (PD01/77-ANUL).')
    expect(t.d.altas).toHaveLength(1)
    expect(t.d.altas[0]).toMatchObject({ Serie: '2', NumeroFactura: 'PD01/77-ANUL', TotalFactura: -170.5, CuentaCliente: '40000012' })
    expect(t.envio).toMatchObject({ entry_id: 'c1', status: 'enviado', ext_year: '2026', ext_series: '2', ext_number: 3190, ext_invoice_number: 'PD01/77-ANUL', attempts: 1, document_id: null, document_status: null })
    // Se busca del mes del contraasiento a hoy.
    expect([...new Set(t.d.mesesPedidos)]).toEqual(['202610'])
  })

  it('NUNCA DOS VECES: con el envío del contraasiento ya hecho, ni se abre la conexión', async () => {
    const t = puerto({ previo: enviada({ id: 's-c1', entry_id: 'c1', ext_number: 3190, ext_invoice_number: 'PD01/77-ANUL' }) })
    const x = await enviarContraasientoRecibidaADiez(contra(), t.p)
    expect(x).toMatchObject({ estado: 'en_diez', documento: 3190 })
    expect(x.texto).toMatch(/^Ya estaba anulada en Diez/)
    expect(t.llamadas).toMatchObject({ conexion: 0, cliente: 0, guardar: 0 })
  })

  it('NUNCA DOS VECES: si la «-ANUL» ya está en Diez (otra forma de escribir el número, el mes siguiente), se enlaza con su ejercicio', async () => {
    const d = diez({ facturas: [{ Ejercicio: '2026', Serie: '2', Documento: 3188, TipoAsiento: 2, Fecha: 20261102, CuentaCliente: '40000012', NumeroFactura: 'pd01 77 anul' }] })
    const t = puerto({ d, ahora: '2026-11-03T10:00:00Z' })
    expect(await enviarContraasientoRecibidaADiez(contra(), t.p)).toMatchObject({ estado: 'en_diez', documento: 3188, enlazada: true })
    expect(d.altas).toEqual([])
    expect([...new Set(d.mesesPedidos)]).toEqual(['202610', '202611'])
    expect(t.envio).toMatchObject({ status: 'enlazado', ext_year: '2026', ext_number: 3188, attempts: 0 })
  })

  it('NUNCA DOS VECES: por el NIF aunque Julio la metiera en otra subcuenta', async () => {
    const d = diez({ facturas: [{ Ejercicio: '2026', Serie: '2', Documento: 3189, TipoAsiento: 2, Fecha: 20261014, CuentaCliente: '41000003', CifCliente: 'ES-B00000011', NumeroFactura: 'PD01/77-ANUL' }] })
    expect(await enviarContraasientoRecibidaADiez(contra(), puerto({ d }).p)).toMatchObject({ estado: 'en_diez', documento: 3189, enlazada: true })
    expect(d.altas).toEqual([])
  })

  it('la ORIGINAL (sin «-ANUL») no cuenta como su anulación; más de una «-ANUL» → no se toca nada', async () => {
    const t = puerto()
    await enviarContraasientoRecibidaADiez(contra(), t.p)
    expect(t.d.altas).toHaveLength(1)
    const d = diez({ facturas: [
      { Ejercicio: '2026', Serie: '2', Documento: 3188, TipoAsiento: 2, Fecha: 20261014, CuentaCliente: '40000012', NumeroFactura: 'PD01/77-ANUL' },
      { Ejercicio: '2026', Serie: '2', Documento: 3189, TipoAsiento: 2, Fecha: 20261014, CuentaCliente: '40000012', NumeroFactura: 'PD01-77-ANUL' },
    ] })
    const u = puerto({ d })
    expect(await enviarContraasientoRecibidaADiez(contra(), u.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(d.altas).toEqual([])
    expect(u.envio).toMatchObject({ status: 'pendiente', attempts: 0 })
  })

  it('si Diez no contesta, la intención queda apuntada (un intento) y el siguiente la encuentra y la enlaza; a los 3, para', async () => {
    const t = puerto({ d: diez({ falla: true }) })
    expect(await enviarContraasientoRecibidaADiez(contra(), t.p)).toMatchObject({ estado: 'no_llega', reintentar: true })
    expect(t.envio).toMatchObject({ status: 'pendiente', attempts: 1 })
    const tope = puerto({ previo: enviada({ id: 's-c1', entry_id: 'c1', status: 'pendiente', attempts: MAX_INTENTOS, ext_number: null, ext_series: null }) })
    expect(await enviarContraasientoRecibidaADiez(contra(), tope.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(tope.llamadas.cliente).toBe(0)
  })

  it('C0001 nunca (ni autorizada); C0008 sin autorizar, cerrada; lo autorizado para OTRO asiento no la abre', async () => {
    for (const [bd, autorizados] of [['C0001', [{ alcance: 'empresa', bd: 'C0001' }]], ['C0008', []], ['C0008', [{ alcance: 'asiento', entry: 'otro', bd: 'C0008' }]]] as [string, Autorizo[]][]) {
      const t = puerto({ bd, autorizados })
      expect(await enviarContraasientoRecibidaADiez(contra(), t.p)).toMatchObject({ estado: 'no_llega' })
      expect(t.llamadas.cliente).toBe(0)
      expect(t.d.altas).toEqual([])
    }
  })

  it('C0008 autorizada para la recibida que anula, o para el contraasiento: se escribe', async () => {
    for (const entry of ['r1', 'c1']) {
      const t = puerto({ bd: 'C0008', autorizados: [{ alcance: 'asiento', entry, bd: 'C0008' }] })
      expect(await enviarContraasientoRecibidaADiez(contra(), t.p)).toMatchObject({ estado: 'en_diez', documento: 3190 })
    }
  })

  it('solo el contraasiento validado de una anulación, y solo si la recibida llegó a Diez (y a la serie 2)', async () => {
    for (const [c, orig] of [
      [contra({ estado: 'propuesto' }), enviada()],
      [contra({ origen: 'manual' }), enviada()],
      [contra({ anula: null }), enviada()],
      [contra(), null],
      [contra(), enviada({ status: 'pendiente' })],
      [contra(), enviada({ ext_series: '1' })],
    ] as [ContraasientoBD, EnvioFila | null][]) {
      const t = puerto({ orig })
      expect(await enviarContraasientoRecibidaADiez(c, t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
      expect(t.llamadas).toMatchObject({ conexion: 0, cliente: 0, guardar: 0 })
    }
  })

  it('si la recibida rehecha no es la que está en Diez (otro número), no se anula a ciegas', async () => {
    const t = puerto({ orig: enviada({ ext_invoice_number: 'PD01/78' }) })
    const x = await enviarContraasientoRecibidaADiez(contra(), t.p)
    expect(x).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(x.estado === 'no_llega' && x.motivo).toMatch(/no se anula a ciegas/)
    expect(t.llamadas.cliente).toBe(0)
  })

  it('un contraasiento con fecha posterior a hoy, o de hace más de 12 meses, no se manda solo', async () => {
    const fut = puerto()
    expect(await enviarContraasientoRecibidaADiez(contra({ fecha: '2026-11-02' }), fut.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(fut.llamadas.cliente).toBe(0)
    const viejo = puerto({ ahora: '2027-11-20T10:00:00Z' })
    const x = await enviarContraasientoRecibidaADiez(contra(), viejo.p)
    expect(x.estado === 'no_llega' && x.motivo).toMatch(/más de 12 meses/)
    expect(viejo.llamadas.cliente).toBe(0)
  })
})
