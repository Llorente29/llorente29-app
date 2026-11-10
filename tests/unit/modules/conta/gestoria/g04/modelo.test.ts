// G04 · Tarea 4 · El modelo de la pantalla de Clientes
// (src/modules/conta/gestoria/g04/modelo.ts): lo leído de las vistas de la
// 0930, con una empresa y con «Las dos». Clientes, NIF de ceros e importes
// inventados (T11).
import { describe, expect, it } from 'vitest'
import { modeloClientes, referenciasDelCrm } from '@/modules/conta/gestoria/g04/modelo'
import type { DatosClientes } from '@/modules/conta/gestoria/g04/datos'

const Q = 'emp-qbo'
const A = 'emp-anny'
const EMPRESAS = [{ id: Q, nombre: 'QBO Prueba' }, { id: A, nombre: 'Anny Prueba' }]
const cli = (id: string, empresa: string | null, x: Record<string, unknown> = {}) => ({
  cliente_id: id, empresa_id: empresa, cliente: `Cliente ${id}`, nif: 'B00000011', situacion: 'activo', crm: 'bitrix24',
  forma_de_cobro: 'gocardless', cliente_en_gocardless: `CU-${id}`, mandato: 'active', gocardless_al_mes: null, ultimo_cobro_fecha: '2026-11-04', pendientes: 0, trabajadores: [], ...x,
})
const datos = (): DatosClientes => ({
  clientes: [
    cli('1', Q, { gocardless_al_mes: 496.10, servicios_gc: 'GESTORIA', ultimo_cargo_estado: 'paid_out', ultimo_cargo_fecha: '2026-11-04', ultimo_cargo_importe: 496.10,
      telefonos: ['600000000'], correos: ['admin@ejemplo.es'] }),
    cli('2', Q, { gocardless_al_mes: 108.90, servicios_gc: 'GESTORIA' }),
    cli('2', A, { gocardless_al_mes: 60.50, servicios_gc: 'RENTA' }),
    cli('3', Q, { cliente_en_gocardless: null, mandato: null, forma_de_cobro: null, ultimo_cobro_fecha: null }), // activo sin cuota
    cli('4', null, { situacion: 'baja', cliente_en_gocardless: null }),
  ],
  // Lo de GoCardless, ya sumado por la base (2308): S1 Q 496,10 (próximo 04/12), S2 Q 108,90 (alta este mes, próximo 16/11), S3 A 60,50 (próximo 04/12).
  cuotasGc: [
    { empresa_id: Q, al_mes: 605.00, altas_n: 1, altas_euros: 108.90, bajas_n: 0, bajas_euros: 0 },
    { empresa_id: A, al_mes: 60.50, altas_n: 0, altas_euros: 0, bajas_n: 0, bajas_euros: 0 },
  ],
  proximos: [
    { empresa_id: Q, fecha: '2026-11-16', n: 1, euros: 108.90 }, { empresa_id: Q, fecha: '2026-12-04', n: 1, euros: 496.10 }, { empresa_id: A, fecha: '2026-12-04', n: 1, euros: 60.50 },
  ],
  cargos: [
    { empresa_id: Q, gc_id: 'P1', suscripcion_gc_id: 'S2', estado: 'failed', fecha: '2026-08-04', importe: 108.90, clientes: ['2'], mandato_activo: true, cobrado_despues: false, otra_via: null },
  ],
  queHacer: [
    { empresa_id: Q, tipo: 'gocardless_sin_cliente', n: 3, euros: 200 },
    { empresa_id: Q, tipo: 'recibos_devueltos', n: 1, euros: 500 },
    { empresa_id: A, tipo: 'gocardless_sin_cliente', n: 1, euros: 50 },
  ],
  asignaciones: [
    { id: 'l1', tipo: 'cuota', cliente_id: '1', empresa_id: Q, servicio_id: 'ges', nivel_id: null, paquete_id: null, empleado_nombre: null, importe_propio: null, periodo: 'mes', desde: '2024-01-01', hasta: null },
    ...Array.from({ length: 18 }, (_, i) => ({ id: `w${i}`, tipo: 'cuota', cliente_id: '1', empresa_id: Q, servicio_id: 'lab', nivel_id: null, paquete_id: null,
      empleado_nombre: `Persona Prueba ${i}`, importe_propio: null, periodo: 'mes', desde: '2024-01-01', hasta: null })),
  ],
  precios: [
    { id: 'tarifa:g', empresa_id: Q, servicio_id: 'ges', nivel_id: null, paquete_id: null, cliente_id: null, forma: 'fijo', periodo: 'mes', importe: 60.50, tramos: [], desde: '2024-01-01', hasta: null },
    { id: 'tarifa:l', empresa_id: Q, servicio_id: 'lab', nivel_id: null, paquete_id: null, cliente_id: '1', forma: 'por_trabajador', periodo: null, importe: 24.20, tramos: [], desde: '2024-01-01', hasta: null },
  ],
  servicios: [{ id: 'ges', company_id: Q, nombre: 'Gestoría mensual', forma: 'fijo_mes' }, { id: 'lab', company_id: Q, nombre: 'Gestión laboral', forma: 'por_empleado' }],
  niveles: [], paquetes: [], lineasDePaquete: [], ajustes: [],
  crm: [{ crm: 'bitrix24', portal: 'portal-de-prueba.bitrix24.es' }],
})
/** Lo de la ficha del cliente 1, en su propia llamada (conta_pantalla_ficha). */
const suyo = () => ({
  ficha: { telefonos: ['600000000'], correos: ['admin@ejemplo.es'], cuotasReferencia: [{ etiqueta: 'Tarifa recurrente', importeCent: 6050 }, { etiqueta: 'Laboral', importeCent: 0 }] },
  leidoAt: null,
  cobros: [{ company_id: Q, gc_id: 'PB1', mandato_gc_id: 'MD1', estado: 'paid_out', fecha: '2026-11-04', importe: 496.10 }, { company_id: Q, gc_id: 'PB0', mandato_gc_id: 'MD1', estado: 'failed', fecha: '2026-10-04', importe: 496.10 }],
  mandatos: [{ company_id: Q, gc_id: 'MD1', gc_cliente_id: 'CU-1', estado: 'active' }],
  suscripciones: [{ company_id: Q, gc_id: 'S1', gc_cliente_id: 'CU-1', nombre: 'GESTORIA', al_mes: 496.10, estado: 'active', inicio: '2020-01-01' }],
  pendientes: [], personas: [],
})

describe('G04 · el modelo de Clientes', () => {
  it('con una empresa, sus filas; los sin empresa, solo en «Las dos»', () => {
    expect(modeloClientes(datos(), EMPRESAS, [Q], '2026-11-08').filas.map((f) => f.clienteId)).toEqual(['1', '2', '3'])
    const dos = modeloClientes(datos(), EMPRESAS, [Q, A], '2026-11-08').filas
    expect(dos.map((f) => `${f.clienteId}|${f.empresa ?? '-'}`)).toEqual(['1|QBO Prueba', '2|QBO Prueba', '2|Anny Prueba', '3|QBO Prueba', '4|-'])
    expect(dos.find((f) => f.clienteId === '4')!.estado.texto).toBe('Sin empresa que le facture')
  })
  it('«Este mes»: manda GoCardless; Sumied al lado (60,50 + 18 × 24,20 = 496,10: coinciden)', () => {
    const f = modeloClientes(datos(), EMPRESAS, [Q], '2026-11-08').filas[0]
    expect([f.esteMes.principalCent, f.esteMes.comparacionCent, f.esteMes.alLado, f.servicios]).toEqual([49610, 49610, null, 'Gestoría mensual · Gestión laboral (18)'])
    expect(f.lineas.at(-1)).toEqual({ texto: 'Total', importe: '496,10 €' })
  })
  it('el estado de cada fila: devuelto, activo sin cuota, cobrado', () => {
    const fs = modeloClientes(datos(), EMPRESAS, [Q], '2026-11-08').filas
    expect(fs.map((f) => [f.clienteId, f.estado.texto, f.debeCent])).toEqual([['1', 'Cobrado', 0], ['2', 'Devuelto', 10890], ['3', 'Activo sin cuota', 0]])
    expect(fs[2].estado.detalle).toBe('Activo en Bitrix24 · no se le cobra')
  })
  it('la banda: el total de 30 días; las cuotas: lo de GoCardless, con Sumied al lado', () => {
    const m = modeloClientes(datos(), EMPRESAS, [Q], '2026-11-08')
    expect(m.banda.titulo).toBe('2 cobros · 605,00 €')
    expect(m.banda.desglose).toEqual(['4 dic.: 1 cobro · 496 € · otros días: 1 cobro · 109 €'])
    expect([m.cuotas.principal.principalCent, m.cuotas.principal.alLado, m.cuotas.altas]).toEqual([60500, 'Sumied calcula 496,10 €', { n: 1, cent: 10890 }])
  })
  it('te deben y dejas de cobrar (solo el número de clientes)', () => {
    const m = modeloClientes(datos(), EMPRESAS, [Q], '2026-11-08')
    expect(m.teDeben).toEqual({ totalCent: 10890, clientes: 1, masDe60Cent: 10890 })
    expect(m.dejasDeCobrar).toEqual({ activosSinCuota: 1 })
  })
  it('«Lo que tienes que hacer»: primero los cobros sin cliente; después, por el dinero que mueve', () => {
    const t = modeloClientes(datos(), EMPRESAS, [Q, A], '2026-11-08').tareas
    expect(t.map((x) => [x.id, x.n])).toEqual([['sin-cliente', 4], ['devueltos', 1], ['activos-sin-cuota', 1]])
    expect(t[0].texto).toBe('4 suscripciones de GoCardless (250,00 € al mes) que aún no están unidas a su cliente en Sumied.')
  })
  it('el panel: la situación del cliente, el último cobro de verdad y la acción concreta del aviso', () => {
    const fs = modeloClientes(datos(), EMPRESAS, [Q], '2026-11-08').filas
    expect([fs[0].situacionTexto, fs[0].ultimoCargo]).toEqual(['Activo', { estado: 'Cobrado', tono: 'bien', fecha: '2026-11-04', importeCent: 49610 }])
    expect([fs[1].aviso?.accion, fs[1].aviso?.boton, fs[1].devueltos]).toEqual(['otra_via', 'Cobrado por otra vía', [{ id: 'P1', fecha: '2026-08-04', importeCent: 10890 }]])
    expect(fs[2].aviso?.accion).toBe('poner_cuota')
  })
  it('«sin altas» y «sin bajas»', async () => {
    const { altasYBajas } = await import('@/modules/conta/gestoria/g04/modelo')
    expect([altasYBajas({ n: 0, cent: 0 }, 'alta'), altasYBajas({ n: 0, cent: 0 }, 'baja'), altasYBajas({ n: 2, cent: 12100 }, 'baja'), altasYBajas({ n: 1, cent: 10890 }, 'alta')])
      .toEqual(['sin altas', 'sin bajas', '−2 bajas (121 €)', '+1 alta (109 €)'])
  })
  it('los importes de referencia del CRM, cada uno con su etiqueta, sin sumar', () => {
    expect(referenciasDelCrm(suyo().ficha)).toEqual(['Tarifa recurrente: 60,50 €'])
  })
})

// Una anual de GoCardless que se cobra por primera vez en junio: no está en el recibo del mes que viene, y la
// ficha la pintaba «Servicio · Sin precio · desde jun. 2027». Ahora, con su nombre y su precio de la tarifa.
describe('la ficha · un servicio que empieza más adelante', () => {
  it('sale con su nombre y su precio, no «Servicio · Sin precio»', async () => {
    const { modeloFicha } = await import('@/modules/conta/gestoria/g04/modelo')
    const d = datos()
    const conAnual: DatosClientes = {
      ...d,
      asignaciones: [...d.asignaciones, { id: 'soc', tipo: 'cuota', cliente_id: '1', empresa_id: Q, servicio_id: 'soc', nivel_id: null, paquete_id: null,
        empleado_nombre: null, importe_propio: null, periodo: 'anio', desde: '2027-06-01', hasta: null }],
      precios: [...d.precios, { id: 'tarifa:s', empresa_id: Q, servicio_id: 'soc', nivel_id: null, paquete_id: null, cliente_id: null, forma: 'fijo', periodo: 'anio',
        importe: 300, tramos: [], desde: '2026-01-01', hasta: null }],
      servicios: [...d.servicios, { id: 'soc', company_id: Q, nombre: 'Impuesto de sociedades', forma: 'fijo_anio' }],
    }
    const f = modeloFicha(conAnual, suyo(), EMPRESAS, '1', Q, '2026-11-10', [])!
    const s = f.servicios.find((x) => x.lineaId === 'soc')!
    expect([s.texto, s.detalle]).toEqual(['Impuesto de sociedades', 'Precio de tarifa · 300,00 € al año, 25,00 € al mes · desde jun. 2027'])
    expect(f.servicios.some((x) => x.texto === 'Servicio')).toBe(false)
  })
})

describe('G04 · el modelo de la ficha', () => {
  it('el recibo del mes que viene, con los trabajadores agrupados y desplegables', async () => {
    const { modeloFicha } = await import('@/modules/conta/gestoria/g04/modelo')
    const f = modeloFicha(datos(), suyo(), EMPRESAS, '1', Q, '2026-11-08', [])!
    expect([f.mesRecibo, f.totalRecibo, f.recibo.map((l) => l.texto)]).toEqual(['diciembre de 2026', '496,10 €', ['Gestoría mensual', 'Gestión laboral · 18 trabajadores']])
    expect(f.recibo[1].detalle).toBe('18 × 24,20 € · este mes: ninguna alta, ninguna baja')
    expect([f.recibo[1].trabajadores.length, f.recibo[1].trabajadores[0].importe, f.recibo[1].trabajadores[0].lineaId]).toEqual([18, '24,20 €', 'w0'])
    expect(f.cobros.map((c) => [c.estado, c.importe])).toEqual([['Cobrado', '496,10 €'], ['Devuelto', '496,10 €']])
    expect([f.mandato, f.devoluciones12, f.clienteDesde]).toEqual([{ texto: 'firmado', tono: 'bien' }, 1, 'Cobra desde enero de 2020'])
    expect(f.servicios.map((s) => [s.texto, s.detalle, s.importe])).toEqual([
      ['Gestoría mensual', 'Precio de tarifa · desde ene. 2024', '60,50 €'],
      ['Gestión laboral', 'Precio de este cliente · 18 × 24,20 € · desde ene. 2024', '435,60 €'],
    ])
  })
})

