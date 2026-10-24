// C11c (24/10) · El asiento de ventas REHECHO después de anular llega a Diez.
// El caso de producción: «Ventas Uber · Foodint Carabanchel» del 10/10. El 1821
// se envió (2026/1/1820, «UBR-CAM-20261010»), se anuló (el 1895 lo anuló en
// Diez: «UBR-CAM-20261010-ANUL») y se rehízo (el 1896). Al validar el 1896, el
// envío encontraba en Diez la factura del 1821, la enlazaba y chocaba con su
// envío (external_send_ext_uq). Importes inventados; los números de Diez, los
// de producción.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { enviarAsientoADiez, enviarContraasientoADiez, type ClienteDiezEnvio, type EnvioFila, type PuertoEnvio } from '../../../supabase/functions/_shared/diezEnviar'
import { CORRESPONDENCIA_LLORENTE29 } from '../../../supabase/functions/_shared/diezAnalitica'
import { type ResumenBD } from '../../../supabase/functions/_shared/resumenDeAsiento'
import { type Factura, type FacturaData } from '../../../supabase/functions/_shared/diezCliente'
import { esNumeroDe, numeroDeLaVez } from '../../../supabase/functions/_shared/diezFactura'

const PDF = new TextEncoder().encode('%PDF-1.3 ' + 'x'.repeat(400))
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const rehecho = (o: Partial<ResumenBD> = {}): ResumenBD => ({
  id: 'e1896', account_id: 'acc', company_id: 'emp', estado: 'validado', serie: 1, numero: 1896, fecha: '2026-10-10',
  empresa: { nombre: 'Empresa de Prueba SL', nif: 'B00000000' }, local: { id: 'l2', nombre: 'Foodint Carabanchel' }, canal: { id: 'c1', slug: 'uber', nombre: 'Uber Eats' },
  pedidos: [{ hora: '13:05', codigo: 'A1', marca: 'Meraki Pita', total: 33, base: 30, cuota: 3 }],
  lineas: [{ cuenta: '43000002', debe: 33, haber: 0, marca: null, tipoIva: null, documento: null }, { cuenta: '70000002', debe: 0, haber: 30, marca: 'Meraki Pita', tipoIva: null, documento: null },
    { cuenta: '47700010', debe: 0, haber: 3, marca: null, tipoIva: 10, documento: null }],
  documento: { id: 'd1', ruta: 'acc/e1896/abc.pdf', nombre: 'ResumenDeVentas_UBR-CAM-20261010.pdf', sha256: sha(PDF), bytes: PDF.length, creado_en: '', creado_por: 'Julio' },
  ...o,
})

// Lo que tiene Diez ese mes: la factura del anulado (1820) y su anulación (1895).
const enDiez = (): Factura[] => [
  { Ejercicio: '2026', Serie: '1', Documento: 1820, TipoAsiento: 1, Fecha: 20261010, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-CAM-20261010' },
  { Ejercicio: '2026', Serie: '1', Documento: 1895, TipoAsiento: 1, Fecha: 20261024, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-CAM-20261010-ANUL' },
]

function diez(facturas = enDiez()) {
  const d: ClienteDiezEnvio & { altas: FacturaData[] } = {
    altas: [],
    async subcuenta(codigo) { return codigo === '43000002' ? { Codigo: '43000002', Descripcion: 'UBER EATS' } : null },
    async facturasDelMes() { return [...facturas, ...facturas] },   // el listado de Diez repite filas
    async enviarFactura(fd) { d.altas.push(fd); const f = { ...fd, Documento: 1901, Fecha: Number(fd.FechaFactura) } as Factura; facturas.push(f); return f },
    async adjuntarDocumentoFactura() { return { status: 500, json: { Message: 'The specified container does not exist.' } } },
    async documentoDeFactura() { return { status: 500, json: { ExceptionMessage: 'The specified container does not exist.' } } },
  }
  return d
}

// conC11c: el puerto de ahora (enlazados y vez); sin él, el de antes.
function puerto(o: { r?: ResumenBD; envios?: Record<string, EnvioFila>; conC11c?: boolean; vez?: number; d?: ReturnType<typeof diez> } = {}) {
  const envios: Record<string, EnvioFila> = { ...(o.envios ?? {}) }
  const d = o.d ?? diez()
  const p: PuertoEnvio = {
    resumen: async () => o.r ?? rehecho(),
    envio: async (id) => envios[id] ?? null,
    guardar: async (f) => { const g = { ...f, id: f.id ?? `s-${f.entry_id}` }; envios[f.entry_id] = g; return g },
    conexion: async () => ({ id: 'k1', nombreBd: 'C0009', adjuntar: false }),
    autorizado: async () => true,
    cliente: async () => d,
    documento: async () => PDF,
    sha256: async (b) => sha(b),
    correspondencia: () => CORRESPONDENCIA_LLORENTE29,
    ahora: () => new Date('2026-10-24T07:30:00Z'),
    ...(o.conC11c === false ? {} : {
      // Los documentos de Diez que ya son de otro asiento: los de los envíos de los demás.
      enlazados: async (_emp: string, menos: string) => new Set(Object.values(envios).filter((e) => e.entry_id !== menos && e.ext_number != null).map((e) => `${e.ext_series}/${e.ext_number}`)),
      vezDelNumero: async () => o.vez ?? 2,
    }),
  }
  return { p, d, envios }
}

// Los envíos de producción del 1821 (anulado) y del 1895 (su contraasiento).
const fila = (entry: string, doc: number, numero: string): EnvioFila => ({
  id: `s-${entry}`, entry_id: entry, account_id: 'acc', company_id: 'emp', account_connector_id: 'k1', kind: 'factura',
  ext_year: '2026', ext_series: '1', ext_number: doc, ext_invoice_number: numero, payload_hash: 'h', status: 'enviado', attempts: 1,
  sent_at: '2026-10-15T08:03:03Z', document_id: null, document_status: 'pendiente_diez', document_error: null, document_attached_at: null,
} as EnvioFila)
const ANTES = { e1821: fila('e1821', 1820, 'UBR-CAM-20261010'), e1895: fila('e1895', 1895, 'UBR-CAM-20261010-ANUL') }

describe('el número de la vez', () => {
  it('la primera, el de siempre; después, «-2», «-3»', () => {
    expect(numeroDeLaVez('UBR-CAM-20261010', 1)).toBe('UBR-CAM-20261010')
    expect(numeroDeLaVez('UBR-CAM-20261010', 2)).toBe('UBR-CAM-20261010-2')
    expect(numeroDeLaVez('UBR-CAM-20261010', 3)).toBe('UBR-CAM-20261010-3')
  })
  it('qué números son de qué base (la anulación no)', () => {
    expect(esNumeroDe('UBR-CAM-20261010', 'UBR-CAM-20261010')).toBe(true)
    expect(esNumeroDe('UBR-CAM-20261010', 'UBR-CAM-20261010-2')).toBe(true)
    expect(esNumeroDe('UBR-CAM-20261010', 'UBR-CAM-20261010-ANUL')).toBe(false)
    expect(esNumeroDe('UBR-CAM-20261010', 'UBR-CAM-20261011')).toBe(false)
  })
})

describe('el rehecho del 1821 (el 1896)', () => {
  it('ANTES: enlazaba la factura del anulado (2026/1/1820), la que chocaba en external_send_ext_uq', async () => {
    const t = puerto({ envios: ANTES, conC11c: false })
    const x = await enviarAsientoADiez('e1896', t.p)
    expect(x).toMatchObject({ estado: 'en_diez', documento: 1820, enlazada: true })
    expect(t.d.altas).toEqual([])
    expect(t.envios.e1896).toMatchObject({ status: 'enlazado', ext_number: 1820 })   // el mismo documento que el 1821
  })

  it('AHORA: va a Diez como factura nueva, «UBR-CAM-20261010-2», con su propio documento', async () => {
    const t = puerto({ envios: ANTES })
    const x = await enviarAsientoADiez('e1896', t.p)
    expect(x).toMatchObject({ estado: 'en_diez', documento: 1901, enlazada: false })
    expect(t.d.altas).toHaveLength(1)
    expect(t.d.altas[0]).toMatchObject({ NumeroFactura: 'UBR-CAM-20261010-2', CuentaCliente: '43000002' })
    expect(t.envios.e1896).toMatchObject({ status: 'enviado', ext_number: 1901, ext_invoice_number: 'UBR-CAM-20261010-2' })
    // Los envíos del anulado y de su contraasiento, como estaban.
    expect(t.envios.e1821).toEqual(ANTES.e1821)
    expect(t.envios.e1895).toEqual(ANTES.e1895)
  })

  it('reenviarlo no escribe otra: el envío ya enviado se reconoce', async () => {
    const t = puerto({ envios: ANTES })
    await enviarAsientoADiez('e1896', t.p)
    await enviarAsientoADiez('e1896', t.p)
    expect(t.d.altas).toHaveLength(1)
  })

  it('si la gestoría ya metió a mano «UBR-CAM-20261010-2», se enlaza esa, no la del anulado', async () => {
    const d = diez([...enDiez(), { Ejercicio: '2026', Serie: '1', Documento: 1950, TipoAsiento: 1, Fecha: 20261010, CuentaCliente: '43000002', NombreCliente: 'UBER EATS', NumeroFactura: 'UBR-CAM-20261010-2' }])
    const t = puerto({ envios: ANTES, d })
    expect(await enviarAsientoADiez('e1896', t.p)).toMatchObject({ estado: 'en_diez', documento: 1950, enlazada: true })
    expect(t.d.altas).toEqual([])
  })

  it('un asiento que nunca se anuló sigue con el número de siempre', async () => {
    const t = puerto({ vez: 1, d: diez([]) })
    await enviarAsientoADiez('e1896', t.p)
    expect(t.d.altas[0]).toMatchObject({ NumeroFactura: 'UBR-CAM-20261010' })
  })
})

describe('y si un día se anula el rehecho', () => {
  it('su contraasiento va con el número que se mandó: «UBR-CAM-20261010-2-ANUL», y no enlaza la anulación del 1821', async () => {
    const t = puerto({ envios: { ...ANTES, e1896: fila('e1896', 1901, 'UBR-CAM-20261010-2') }, r: rehecho({ estado: 'anulado' }) })
    const x = await enviarContraasientoADiez({ id: 'e1990', account_id: 'acc', company_id: 'emp', estado: 'validado', fecha: '2026-10-25', origen: 'reversal', anula: 'e1896', numero: 1990 }, t.p)
    expect(x).toMatchObject({ estado: 'en_diez', enlazada: false })
    expect(t.d.altas).toHaveLength(1)
    expect(t.d.altas[0]).toMatchObject({ NumeroFactura: 'UBR-CAM-20261010-2-ANUL' })
  })
})
