// G01 · Tarea 3. Una lectura de GoCardless entera con respuestas GRABADAS e
// inventadas (grabadas/gocardless.ts): lo que se pide a la API, lo que se
// escribe en Sumied y las diferencias, con su porqué como dato. Sin red ni
// base: index.ts solo escribe lo que dicen estos núcleos.
import { describe, expect, it } from 'vitest'
import { comprobarToken, leerCuentaGc } from '../../../../../supabase/functions/conta-gocardless-leer/lectura'
import { fraseDeLectura, planDiferencias, planLectura, type Antes } from '../../../../../supabase/functions/conta-gocardless-leer/plan'
import type { Linea, Tarifa } from '../../../../../supabase/functions/conta-gocardless-leer/comparacion'
import { fetchGrabado } from './grabadas/gocardless'

const HOY = '2026-11-06'
const A = 'empresa-a'
const nombre = (id: string) => (id === A ? 'EMISOR PRUEBA ALFA, S.L.' : 'Emisor B de prueba')
const antes = (extra: Partial<Antes> = {}): Antes => ({
  huellas: new Map(), otrosEmisores: [], formaAntes: new Map(), porDefecto: true, importadas: new Set(), tarifasPropias: new Set(),
  fichas: [
    { partyId: 'P1', claveFicha: 'F1', nombre: 'CLIENTE PRUEBA UNO, S.L.', nif: 'B00000001', correos: [], situacion: 'activo', formaPago: 'Emisor Prueba Alfa', emisorSegunCrm: A },
    { partyId: 'P2', claveFicha: 'F2', nombre: 'CLIENTE PRUEBA DOS', nif: null, correos: ['dos@prueba.test'], situacion: 'moroso', formaPago: null, emisorSegunCrm: null },
    { partyId: 'P3', claveFicha: 'F3', nombre: 'CLIENTE PRUEBA TRES', nif: 'B00000003', correos: [], situacion: 'activo', formaPago: null, emisorSegunCrm: null },
  ],
  ...extra,
})

describe('G01 · una lectura de GoCardless con respuestas grabadas', () => {
  it('pide al sandbox, con su cabecera, todas las páginas y los cobros de 6 meses', async () => {
    const pedidas: string[] = []
    const d = await leerCuentaGc(fetchGrabado(pedidas), 'pruebas', 'token-de-prueba', HOY)
    expect(pedidas.every((u) => u.startsWith('https://api-sandbox.gocardless.com/'))).toBe(true)
    expect(pedidas.filter((u) => u.includes('/customers'))).toHaveLength(2)
    expect(pedidas.find((u) => u.includes('/payments'))).toContain('charge_date%5Bgte%5D=2026-05-01')
    expect(d.clientes.map((c) => c.id)).toEqual(['CU001', 'CU002', 'CU003'])
    expect(d.cobros.find((c) => c.id === 'PM002')?.motivo).toBe('La cuenta no tenía saldo.')
    expect(d.abonos).toHaveLength(1)
  })

  it('comprueba el token antes de guardarlo', async () => {
    expect(await comprobarToken(fetchGrabado(), 'pruebas', 'token-de-prueba')).toEqual({ ok: true })
    expect(await comprobarToken(fetchGrabado(), 'pruebas', 'otro')).toEqual({ ok: false, porque: 'GoCardless no acepta ese token en pruebas (el sandbox).' })
    await expect(leerCuentaGc(fetchGrabado(), 'pruebas', 'otro', HOY)).rejects.toThrow('GoCardless no acepta el token (Invalid token).')
  })

  it('casa, importa una vez y deja la forma de cobro y los mandatos', async () => {
    const d = await leerCuentaGc(fetchGrabado(), 'pruebas', 'token-de-prueba', HOY)
    const p = planLectura(A, 'cuenta', d, antes(), HOY, nombre)
    expect({ nuevos: p.nuevos, cambiados: p.cambiados, iguales: p.iguales }).toEqual({ nuevos: 3, cambiados: 0, iguales: 0 })
    expect(p.parejas.map((x) => [x.clienteGcId, x.claveFicha, x.por])).toEqual([['CU001', 'F1', 'nif'], ['CU002', 'F2', 'correo']])
    expect(p.cobroCliente.map((c) => [c.party_id, c.forma_cobro, c.gc_cliente_id])).toEqual([['P1', 'gocardless', 'CU001'], ['P2', 'gocardless', 'CU002']])
    expect(p.mandatosSumied.map((m) => [m.gcMandatoId, m.fila.status, m.fila.origen])).toEqual([['MD001', 'firmado', 'gocardless'], ['MD002', 'firmado', 'gocardless']])
    // El cliente con 7 líneas y el de B: 8 líneas; la laboral sin nombre no se convierte; la cancelada no se importa.
    expect(p.lineas).toHaveLength(8)
    expect(p.lineas.filter((l) => l.partyId === 'P1')).toHaveLength(7)
    expect(p.noConvertidas.map((n) => [n.suscripcionId, n.codigo, n.partyId])).toEqual([['SB008', 'laboral_sin_empleado', 'P2']])
    expect(p.tarifas.map((t) => [t.partyId, t.servicio, t.importeCent, t.periodo, t.desde])).toEqual([
      ['P1', 'gestoria_mensual', 6050, 'mes', '2026-01'], ['P1', 'gestion_laboral', 2420, 'mes', '2026-01'],
      ['P1', 'servicios mensuales de prueba', 1500, 'mes', '2026-01'], ['P2', 'vigilancia de prueba', 60500, 'anio', '2026-01']])
    expect(p.resumen).toMatchObject({ mandatosVivos: 2, lineasActivas: 9, alMesCent: 34372 })
    expect(fraseDeLectura('EMISOR PRUEBA ALFA, S.L.', p, 8, 3, true))
      .toBe('Conectada la cuenta de GoCardless de EMISOR PRUEBA ALFA, S.L.: 2 mandatos activos y 9 líneas leídas (343,72 € al mes). 8 convertidas en línea, 1 sin convertir; 3 con diferencias.')
  })

  it('la segunda lectura no vuelve a importar, ni pisa la forma de cobro, ni crea otra tarifa', async () => {
    const d = await leerCuentaGc(fetchGrabado(), 'pruebas', 'token-de-prueba', HOY)
    const p1 = planLectura(A, 'cuenta', d, antes(), HOY, nombre)
    const p2 = planLectura(A, 'cuenta', d, antes({
      huellas: new Map(p1.filas.clientes.map((c) => [String(c.gc_id), String(c.huella)])),
      importadas: new Set([...p1.lineas.map((l) => l.suscripcionId), ...p1.noConvertidas.map((n) => n.suscripcionId)]),
      tarifasPropias: new Set(p1.tarifas.map((t) => `${t.partyId}|${t.servicio}`)),
      formaAntes: new Map([['P1', 'transferencia']]),
    }), HOY, nombre)
    expect({ nuevos: p2.nuevos, iguales: p2.iguales }).toEqual({ nuevos: 0, iguales: 3 })
    expect(p2.lineas).toEqual([])
    expect(p2.tarifas).toEqual([])
    expect(p2.cobroCliente.find((c) => c.party_id === 'P1')?.forma_cobro).toBe('transferencia')
  })

  it('4b · lo enlazado a mano en la ficha manda sobre el casado y ya no sale «sin ficha»', async () => {
    const d = await leerCuentaGc(fetchGrabado(), 'pruebas', 'token-de-prueba', HOY)
    // Sin la ficha de P2 en Bitrix24, CU002 (con mandato vivo) sale «sin ficha».
    const fichas = antes().fichas.filter((f) => f.partyId !== 'P2')
    const sin = planLectura(A, 'cuenta', d, antes({ fichas }), HOY, nombre)
    expect(sin.diferenciasDelCasado.some((x) => x.tipo === 'gocardless_sin_ficha' && x.clienteGcId === 'CU002')).toBe(true)
    const con = planLectura(A, 'cuenta', d, antes({ fichas, enlaces: new Map([['CU002', 'P2']]) }), HOY, nombre)
    expect(con.partyDeCliente.get('CU002')).toBe('P2')
    expect(con.cobroCliente.find((c) => c.gc_cliente_id === 'CU002')).toMatchObject({ party_id: 'P2', gc_casado_por: 'persona' })
    expect(con.diferenciasDelCasado.some((x) => x.tipo === 'gocardless_sin_ficha' && x.clienteGcId === 'CU002')).toBe(false)
  })

  it('las diferencias, cada una con su porqué como dato', async () => {
    const d = await leerCuentaGc(fetchGrabado(), 'pruebas', 'token-de-prueba', HOY)
    const p = planLectura(A, 'cuenta', d, antes(), HOY, nombre)
    // Lo importado, como quedaría en Sumied (el servicio por su clave hace de id).
    const lineasDe = (party: string): Linea[] => p.lineas.filter((l) => l.partyId === party).map((l) => ({ id: l.suscripcionId, emisor: A, servicio: l.servicio,
      nombreServicio: l.servicio, detalle: l.detalle, empleado: l.empleado, importePropioCent: l.importePropioCent, periodo: l.periodo, desde: l.desdeMes, hasta: null,
      suscripcionId: l.suscripcionId }))
    const tarifas: Tarifa[] = p.tarifas.map((t) => ({ emisor: A, servicio: t.servicio, clienteId: t.partyId, importeCent: t.importeCent, periodo: t.periodo, desde: t.desde, hasta: null }))
    const tes = [{ id: 't1', nombre: 'Banco de prueba', iban: 'ES0099990000000000000034' }]
    const r = planDiferencias(A, d, p, HOY,
      p.noConvertidas.map((n) => ({ suscripcion: n.suscripcionId, gcCliente: n.clienteGcId, partyId: n.partyId, nombre: n.nombre, codigo: n.codigo, porque: n.porque })),
      lineasDe, tarifas, tes)
    expect(r.diferencias.map((x) => [x.tipo, x.porque_codigo, x.party_id ?? x.gc_cliente_id])).toEqual([
      ['bitrix_sin_cobro', 'bitrix_sin_cobro', 'P3'],
      ['suscripcion_sin_convertir', 'laboral_sin_empleado', 'P2'],
      ['mandato_por_firmar', 'pending_customer_approval', 'CU003'],
      ['falla_a_menudo', 'tres_o_mas_fallos', 'P2'],
      ['totales_distintos', 'gocardless_mas', 'P2'],
    ])
    expect(r.diferencias.find((x) => x.tipo === 'totales_distintos')?.porque)
      .toBe('Sumied 50,42 € y GoCardless 74,62 € al mes. GoCardless cobra «GESTION LABORAL» (24,20 € al mes), que no es ninguna línea en Sumied.')
    expect(r.diferencias.find((x) => x.tipo === 'falla_a_menudo')?.datos).toEqual({ fallidos: 3, desde: '2026-05-01' })
    expect(r.abono).toEqual({ coincide: true, tesoreriaId: 't1', nombre: 'Banco de prueba' })
    // El cliente con 7 líneas cuadra con GoCardless: no sale.
    expect(r.diferencias.some((x) => x.party_id === 'P1')).toBe(false)
    // Sin una cuenta del emisor que termine como la de abono, sale.
    const sin = planDiferencias(A, d, p, HOY, [], lineasDe, tarifas, [])
    expect(sin.diferencias.find((x) => x.tipo === 'abono_en_otra_cuenta')?.porque_codigo).toBe('abono_no_casa')
  })

  it('en vivo se vio: una suscripción que empieza el mes que viene no cuenta este mes, ni cuenta como activo un mandato camino del banco', async () => {
    const d = await leerCuentaGc(fetchGrabado(), 'pruebas', 'token-de-prueba', HOY)
    const nuevas = { ...d,
      suscripciones: d.suscripciones.map((x) => ({ ...x, inicio: '2026-12-05' })),
      mandatos: d.mandatos.map((m) => (m.id === 'MD002' ? { ...m, estado: 'pending_submission' } : m)) }
    const p = planLectura(A, 'cuenta', nuevas, antes(), HOY, nombre)
    expect(p.resumen.mandatosVivos).toBe(1)
    expect(p.parejas).toHaveLength(2)
    const lineasDe = (party: string): Linea[] => p.lineas.filter((l) => l.partyId === party).map((l) => ({ id: l.suscripcionId, emisor: A, servicio: l.servicio,
      nombreServicio: l.servicio, detalle: l.detalle, empleado: l.empleado, importePropioCent: l.importePropioCent, periodo: l.periodo, desde: l.desdeMes, hasta: null,
      suscripcionId: l.suscripcionId }))
    const tarifas: Tarifa[] = p.tarifas.map((t) => ({ emisor: A, servicio: t.servicio, clienteId: t.partyId, importeCent: t.importeCent, periodo: t.periodo, desde: t.desde, hasta: null }))
    const r = planDiferencias(A, nuevas, p, HOY, [], lineasDe, tarifas, [{ id: 't1', nombre: 'Banco de prueba', iban: 'ES0099990000000000000034' }])
    expect(r.diferencias.filter((x) => x.tipo === 'totales_distintos')).toEqual([])
  })
})
