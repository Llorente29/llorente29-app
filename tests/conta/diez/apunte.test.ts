// C07 · Todo asiento de Sumied a Diez (Julio, 22/10) · el asiento general (banco,
// manual, liquidación…) y su contraasiento, freno a freno, contra dobles de la
// base y de Diez. Lo que contesta Diez sigue lo MEDIDO en la C0009 (run 143 de
// diez-prueba-c0009): generales con TipoAsiento 0, el listado que repite filas
// y la anulación como contraasiento. Importes y cuentas INVENTADOS.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { autorizacionCubre, enviarApunteADiez, EN_MARCHA, type ClienteDiezApuntes, type EnvioFila, type PuertoApunte } from '../../../supabase/functions/_shared/diezEnviar'
import { apunteDeAsiento, comoVa, esElMismoApunte, porQueNoVa, type AsientoBD } from '../../../supabase/functions/_shared/diezApunte'
import { ErrorDiez, type Apunte, type ApunteSimplificado } from '../../../supabase/functions/_shared/diezCliente'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const banco = (o: Partial<AsientoBD> = {}): AsientoBD => ({
  id: 'b1', account_id: 'acc', company_id: 'emp', estado: 'validado', origen: 'bank', serie: 4, numero: 12, fecha: '2026-10-07',
  concepto: 'Cobro de prueba', anula: null, anulaOrigen: null,
  lineas: [{ cuenta: '57200001', debe: 120.5, haber: 0, concepto: null }, { cuenta: '43000099', debe: 0, haber: 120.5, concepto: 'Cliente de prueba' }],
  ...o,
})
// El contraasiento de Sumied (journal_entry_anular): las mismas cuentas, el debe y el haber cambiados.
const contra = (o: Partial<AsientoBD> = {}): AsientoBD => banco({
  id: 'r1', origen: 'reversal', numero: 13, fecha: '2026-10-08', concepto: 'Anula General nº 12: error', anula: 'b1', anulaOrigen: 'bank',
  lineas: [{ cuenta: '57200001', debe: 0, haber: 120.5, concepto: null }, { cuenta: '43000099', debe: 120.5, haber: 0, concepto: null }], ...o,
})

type Diez = ClienteDiezApuntes & { altas: ApunteSimplificado[] }
function diez(o: { apuntes?: Apunte[]; subcuentas?: string[]; falla?: unknown; sinNumero?: boolean } = {}): Diez {
  const apuntes = [...(o.apuntes ?? [])]
  const subcuentas = new Set(o.subcuentas ?? ['57200001', '43000099'])
  const d: Diez = {
    altas: [],
    async subcuenta(c) { return subcuentas.has(c) ? { Codigo: c, Descripcion: `Cuenta ${c}` } : null },
    // El listado de Diez repite filas (una por línea).
    async apuntesDelMes() { return [...apuntes, ...apuntes] },
    async enviarAsiento(a) {
      if (o.falla) throw o.falla
      d.altas.push(a)
      const creado: Apunte = { Ejercicio: a.Ejercicio, Serie: a.Serie, Documento: 3158, TipoAsiento: 0, Fecha: a.Fecha, Detalles: a.Detalles }
      apuntes.push(creado)
      return o.sinNumero ? ({ Ejercicio: a.Ejercicio, Serie: a.Serie } as Apunte) : creado
    },
  }
  return d
}

type Autorizo = { alcance: 'asiento' | 'empresa'; entry?: string; desde?: string; asientos?: boolean }
function puerto(o: { bd?: string | null; d?: Diez; envios?: Record<string, EnvioFila>; autorizados?: Autorizo[] } = {}) {
  const envios: Record<string, EnvioFila> = { ...(o.envios ?? {}) }
  const llamadas = { cliente: 0, real: [] as boolean[] }
  const d = o.d ?? diez()
  const p: PuertoApunte = {
    envio: async (id) => envios[id] ?? null,
    guardar: async (f) => { const x = { ...f, id: f.id ?? `s-${f.entry_id}` }; envios[f.entry_id] = x; return x },
    conexion: async () => (o.bd === null ? null : { id: 'k1', nombreBd: o.bd ?? 'C0009' }),
    autorizado: async (id, _e, _bd, fecha, tipo) => autorizacionCubre((o.autorizados ?? []).map((a) => ({ alcance: a.alcance, entry_id: a.entry ?? null, desde: a.desde ?? null, incluye_asientos: a.asientos ?? false })), id, fecha, tipo),
    clienteApuntes: async (_c, x) => { llamadas.cliente++; llamadas.real.push(x.real); return d },
    sha256: async (b) => sha(b),
    ahora: () => new Date('2026-10-22T08:00:00Z'),
  }
  return { p, d, envios, llamadas }
}
const enviadoDe = (entry: string, numero = 3100): EnvioFila => ({
  id: `s-${entry}`, entry_id: entry, account_id: 'acc', company_id: 'emp', account_connector_id: 'k1', kind: 'asiento', ext_year: '2026', ext_series: '4', ext_number: numero,
  ext_invoice_number: null, payload_hash: 'h', status: 'enviado', attempts: 1, last_error: null, sent_at: '2026-10-07T10:00:00Z', document_id: null, document_status: null, document_error: null, document_attached_at: null,
})

describe('cómo va cada origen a Diez', () => {
  it('ventas y recibidas como factura; banco, manuales y liquidaciones como asiento; sus contraasientos, como lo anulado', () => {
    expect(comoVa('sales_day')).toBe('ventas')
    expect(comoVa('supplier_invoice')).toBe('recibida')
    for (const o of ['bank', 'manual', 'vat_settlement', 'payroll', 'supplier_payment']) expect(comoVa(o)).toBe('apunte')
    expect(comoVa('reversal', 'bank')).toBe('contra_apunte')
    expect(comoVa('reversal', 'sales_day')).toBe('contra_ventas')
    expect(comoVa('reversal', 'supplier_invoice')).toBe('contra_recibida')
  })
  it('lo traído de Diez, la apertura, el cierre y las plantillas no van, y se dice por qué', () => {
    for (const o of ['migrated', 'opening', 'closing', 'template']) expect(comoVa(o)).toBe('no_va')
    expect(porQueNoVa('migrated')).toMatch(/se trajo de Diez/)
  })
})

describe('el asiento general, como lo escribe Diez', () => {
  it('serie y fecha de Sumied, sin número (lo pone Diez), líneas a cero fuera', () => {
    const ap = apunteDeAsiento(banco({ lineas: [...banco().lineas, { cuenta: '62900001', debe: 0, haber: 0, concepto: null }] }))
    expect(ap).toMatchObject({ Ejercicio: '2026', Serie: '4', Fecha: 20261007, Descripcion: 'Cobro de prueba' })
    expect(ap.Documento).toBeUndefined()
    expect(ap.Detalles.map((l) => [l.Linea, l.Cuenta, l.Debe, l.Haber])).toEqual([[1, '57200001', 120.5, 0], [2, '43000099', 0, 120.5]])
  })
  it('lo que no cuadra o no tiene cuenta no se manda', () => {
    expect(() => apunteDeAsiento(banco({ lineas: [{ cuenta: '57200001', debe: 10, haber: 0, concepto: null }, { cuenta: '43000099', debe: 0, haber: 9.99, concepto: null }] }))).toThrow(/no cuadran/)
    expect(() => apunteDeAsiento(banco({ lineas: [{ cuenta: '', debe: 1, haber: 0, concepto: null }, { cuenta: '43000099', debe: 0, haber: 1, concepto: null }] }))).toThrow(/sin cuenta|no tiene cuenta/)
  })
  it('«el mismo» en Diez: general, mismo día, mismas líneas, en cualquier serie y en cualquier orden', () => {
    const ap = apunteDeAsiento(banco())
    const igual = esElMismoApunte(ap)
    expect(igual({ Ejercicio: '2026', Serie: '9', Documento: 5, TipoAsiento: 0, Fecha: 20261007, Detalles: [...ap.Detalles].reverse() })).toBe(true)
    expect(igual({ Ejercicio: '2026', Serie: '4', Documento: 5, TipoAsiento: 0, Fecha: 20261008, Detalles: ap.Detalles })).toBe(false)
    expect(igual({ Ejercicio: '2026', Serie: '1', Documento: 5, TipoAsiento: 1, Fecha: 20261007, Detalles: ap.Detalles })).toBe(false)
  })
})

describe('enviarApunteADiez: los frenos', () => {
  it('lo propuesto no se envía', async () => {
    const t = puerto()
    expect(await enviarApunteADiez(banco({ estado: 'propuesto' }), t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('C0001 nunca', async () => {
    const t = puerto({ bd: 'C0001' })
    expect(await enviarApunteADiez(banco(), t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.llamadas.cliente).toBe(0)
  })
  it('C0008 cerrado sin «incluye_asientos»: ni la autorización de empresa de las ventas lo abre', async () => {
    const t = puerto({ bd: 'C0008', autorizados: [{ alcance: 'empresa', desde: '2026-10-01' }] })
    const r = await enviarApunteADiez(banco(), t.p)
    expect(r).toMatchObject({ estado: 'no_llega', reintentar: true })
    expect(r.estado === 'no_llega' && r.motivo).toMatch(/cerrado para asientos de banco, manuales y liquidaciones/)
    expect(t.llamadas.cliente).toBe(0)
    expect(t.envios.b1.last_error).toMatch(/cerrado/)
  })
  it('C0008 con el primero autorizado por asiento (Julio lo mira en Diez): sale, y con escribirEnReal', async () => {
    const t = puerto({ bd: 'C0008', autorizados: [{ alcance: 'asiento', entry: 'b1', asientos: true }] })
    expect(await enviarApunteADiez(banco(), t.p)).toMatchObject({ estado: 'en_diez', serie: '4', documento: 3158 })
    expect(t.llamadas.real).toEqual([true])
  })
  it('en la C0009: se escribe una vez, con la intención antes, y queda enviado con su número', async () => {
    const t = puerto()
    const r = await enviarApunteADiez(banco(), t.p)
    expect(r).toMatchObject({ estado: 'en_diez', serie: '4', documento: 3158, enlazada: false, texto: 'En Diez: 4/3158.' })
    expect(t.d.altas).toHaveLength(1)
    expect(t.envios.b1).toMatchObject({ kind: 'asiento', status: 'enviado', ext_series: '4', ext_number: 3158, attempts: 1, last_error: null, next_try_at: null })
    // Otra vez: ya estaba, no se escribe otro.
    expect(await enviarApunteADiez(banco(), t.p)).toMatchObject({ estado: 'en_diez', texto: 'Ya estaba en Diez: 4/3158.' })
    expect(t.d.altas).toHaveLength(1)
  })
  it('nunca dos veces: si la gestoría ya lo tiene (el mismo día, las mismas líneas), se enlaza', async () => {
    const ap = apunteDeAsiento(banco())
    const t = puerto({ d: diez({ apuntes: [{ Ejercicio: '2026', Serie: '4', Documento: 3001, TipoAsiento: 0, Fecha: ap.Fecha, Detalles: ap.Detalles }] }) })
    expect(await enviarApunteADiez(banco(), t.p)).toMatchObject({ estado: 'en_diez', documento: 3001, enlazada: true })
    expect(t.d.altas).toHaveLength(0)
    expect(t.envios.b1.status).toBe('enlazado')
  })
  it('dos iguales en Diez: no se toca nada', async () => {
    const ap = apunteDeAsiento(banco())
    const dos = [3001, 3002].map((n) => ({ Ejercicio: '2026', Serie: '4', Documento: n, TipoAsiento: 0, Fecha: ap.Fecha, Detalles: ap.Detalles }))
    const t = puerto({ d: diez({ apuntes: dos }) })
    expect(await enviarApunteADiez(banco(), t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.d.altas).toHaveLength(0)
  })
  it('una subcuenta que Diez no tiene: no se inventa, se dice cuál, y se puede reintentar', async () => {
    const t = puerto({ d: diez({ subcuentas: ['57200001'] }) })
    const r = await enviarApunteADiez(banco(), t.p)
    expect(r).toMatchObject({ estado: 'no_llega', reintentar: true })
    expect(r.estado === 'no_llega' && r.motivo).toMatch(/la subcuenta 43000099 no está en Diez/)
    expect(t.d.altas).toHaveLength(0)
  })
  it('Diez no lo acepta: el asiento sigue validado, el motivo queda escrito y cuenta el intento', async () => {
    const t = puerto({ d: diez({ falla: new ErrorDiez('apuntes/add → 400', 400, { Message: 'Subcuenta bloqueada' }) }) })
    const r = await enviarApunteADiez(banco(), t.p)
    expect(r).toMatchObject({ estado: 'no_llega', reintentar: true })
    expect(t.envios.b1).toMatchObject({ status: 'pendiente', attempts: 1 })
    expect(t.envios.b1.last_error).toMatch(/Diez no ha aceptado el asiento.*Subcuenta bloqueada/)
  })
  it('Diez lo acepta sin decir su número: se busca el que acaba de escribir y se apunta', async () => {
    const t = puerto({ d: diez({ sinNumero: true }) })
    expect(await enviarApunteADiez(banco(), t.p)).toMatchObject({ estado: 'en_diez', documento: 3158 })
  })
  it('con 3 intentos ya no escribe: lo tiene que mirar una persona', async () => {
    const t = puerto({ envios: { b1: { ...enviadoDe('b1'), status: 'pendiente', ext_year: null, ext_series: null, ext_number: null, attempts: 3, last_error: 'x' } } })
    expect(await enviarApunteADiez(banco(), t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.d.altas).toHaveLength(0)
  })
  it('antes de hablar con Diez deja su fila (si se corta, queda dicho)', async () => {
    const vistas: string[] = []
    const t = puerto()
    const guardar = t.p.guardar
    t.p.guardar = async (f) => { vistas.push(String(f.last_error)); return guardar(f) }
    await enviarApunteADiez(banco(), t.p)
    expect(vistas[0]).toBe(EN_MARCHA)
  })
})

describe('la anulación: el contraasiento de Sumied, como contraasiento en Diez', () => {
  it('si lo anulado no está en Diez, no hay nada que anular allí', async () => {
    const t = puerto()
    expect(await enviarApunteADiez(contra(), t.p)).toMatchObject({ estado: 'no_llega', reintentar: false })
    expect(t.d.altas).toHaveLength(0)
  })
  it('con lo anulado en Diez, sale el contraasiento: las mismas cuentas al revés', async () => {
    const t = puerto({ envios: { b1: enviadoDe('b1', 3100) } })
    const r = await enviarApunteADiez(contra(), t.p)
    expect(r).toMatchObject({ estado: 'en_diez', texto: 'Anulado también en Diez: 4/3100 con 4/3158.' })
    expect(t.d.altas[0].Detalles.map((l) => [l.Cuenta, l.Debe, l.Haber])).toEqual([['57200001', 0, 120.5], ['43000099', 120.5, 0]])
  })
  it('en C0008 vale la autorización del asiento que anula', async () => {
    const t = puerto({ bd: 'C0008', envios: { b1: enviadoDe('b1') }, autorizados: [{ alcance: 'asiento', entry: 'b1', asientos: true }] })
    expect(await enviarApunteADiez(contra(), t.p)).toMatchObject({ estado: 'en_diez' })
  })
})

describe('autorizacionCubre: los asientos generales van aparte', () => {
  it('la de empresa sin incluye_asientos no los abre; con él, sí, desde su «desde»', () => {
    const emp = { alcance: 'empresa', entry_id: null, desde: '2026-10-01' }
    expect(autorizacionCubre([emp], 'x', '2026-10-07', 'asientos')).toBe(false)
    expect(autorizacionCubre([{ ...emp, incluye_asientos: true }], 'x', '2026-10-07', 'asientos')).toBe(true)
    expect(autorizacionCubre([{ ...emp, incluye_asientos: true }], 'x', '2026-09-30', 'asientos')).toBe(false)
    // Y no cambia lo de antes: las ventas, con la de empresa; las recibidas, solo con lo suyo.
    expect(autorizacionCubre([emp], 'x', '2026-10-07', 'ventas')).toBe(true)
    expect(autorizacionCubre([{ ...emp, incluye_asientos: true }], 'x', '2026-10-07', 'recibidas')).toBe(false)
  })
})
