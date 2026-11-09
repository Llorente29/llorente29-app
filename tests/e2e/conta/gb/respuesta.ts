// tests/e2e/conta/gb/respuesta.ts
//
// GB · Lo que contesta conta-bitrix-pestana (estado «ok»), con la forma de
// conta_pantalla_clientes y conta_pantalla_ficha. Lo usan la unitaria del
// modelo y la e2e de la página. Clientes, NIF de ceros e importes inventados (T11).

export const Q = 'emp-qbo'
const cli = (id: string, x: Record<string, unknown> = {}) => ({
  cliente_id: id, empresa_id: Q, cliente: `Cliente ${id}`, nif: 'B00000011', situacion: 'activo', crm: 'bitrix24',
  forma_de_cobro: 'gocardless', cliente_en_gocardless: `CU-${id}`, mandato: 'active', gocardless_al_mes: 496.10, ultimo_cobro_fecha: '2026-11-04', pendientes: 0, trabajadores: [], ...x,
})
export const clientes = {
  clientes: [cli('1', { servicios_gc: 'GESTORIA', ultimo_cargo_estado: 'paid_out', ultimo_cargo_fecha: '2026-11-04', ultimo_cargo_importe: 496.10 }),
    cli('2', { gocardless_al_mes: 108.90, servicios_gc: 'GESTORIA' })],
  cuotas_gc: [{ empresa_id: Q, al_mes: 605.00, altas_n: 0, altas_euros: 0, bajas_n: 0, bajas_euros: 0 }],
  proximos: [{ empresa_id: Q, fecha: '2026-12-04', n: 1, euros: 496.10 }],
  cargos: [{ empresa_id: Q, gc_id: 'P1', suscripcion_gc_id: 'S2', estado: 'failed', fecha: '2026-08-04', importe: 108.90, clientes: ['2'], mandato_activo: true, cobrado_despues: false, otra_via: null }],
  que_hacer: [],
  asignaciones: [
    { id: 'l1', tipo: 'cuota', cliente_id: '1', empresa_id: Q, servicio_id: 'ges', nivel_id: null, paquete_id: null, empleado_nombre: null, importe_propio: null, periodo: 'mes', desde: '2024-01-01', hasta: null },
    ...Array.from({ length: 18 }, (_, i) => ({ id: `w${i}`, tipo: 'cuota', cliente_id: '1', empresa_id: Q, servicio_id: 'lab', nivel_id: null, paquete_id: null,
      empleado_nombre: `Persona Prueba ${String(i).padStart(2, '0')}`, importe_propio: null, periodo: 'mes', desde: '2024-01-01', hasta: null })),
  ],
  precios: [
    { id: 'tarifa:g', empresa_id: Q, servicio_id: 'ges', nivel_id: null, paquete_id: null, cliente_id: null, forma: 'fijo', periodo: 'mes', importe: 60.50, tramos: [], desde: '2024-01-01', hasta: null },
    { id: 'tarifa:l', empresa_id: Q, servicio_id: 'lab', nivel_id: null, paquete_id: null, cliente_id: '1', forma: 'por_trabajador', periodo: null, importe: 24.20, tramos: [], desde: '2024-01-01', hasta: null },
  ],
  servicios: [{ id: 'ges', company_id: Q, nombre: 'Gestoría mensual', forma: 'fijo_mes' }, { id: 'lab', company_id: Q, nombre: 'Gestión laboral', forma: 'por_empleado' }],
  niveles: [], paquetes: [], lineas_de_paquete: [], ajustes: [],
  crm: [{ crm: 'bitrix24', portal: 'portal-de-prueba.bitrix24.es' }],
}
export const ficha = {
  ficha: { telefonos: [], correos: [] }, leido_at: null,
  cobros: [
    { company_id: Q, gc_id: 'PB5', mandato_gc_id: 'MD1', estado: 'paid_out', fecha: '2026-11-04', importe: 496.10 },
    { company_id: Q, gc_id: 'PB4', mandato_gc_id: 'MD1', estado: 'failed', fecha: '2026-10-04', importe: 496.10 },
    { company_id: Q, gc_id: 'PB3', mandato_gc_id: 'MD1', estado: 'paid_out', fecha: '2026-09-04', importe: 496.10 },
    { company_id: Q, gc_id: 'PB2', mandato_gc_id: 'MD1', estado: 'paid_out', fecha: '2026-08-04', importe: 496.10 },
    { company_id: Q, gc_id: 'PB1', mandato_gc_id: 'MD1', estado: 'paid_out', fecha: '2026-07-04', importe: 496.10 },
  ],
  mandatos: [{ company_id: Q, gc_id: 'MD1', gc_cliente_id: 'CU-1', estado: 'active' }],
  suscripciones: [{ company_id: Q, gc_id: 'S1', gc_cliente_id: 'CU-1', nombre: 'GESTORIA', al_mes: 496.10, estado: 'active', inicio: '2020-01-01' }],
  pendientes: [{ id: 'd1', company_id: Q, tipo: 'totales_distintos', porque: 'GoCardless cobra 496,10 € y Sumied calcula otra cifra.' }],
  personas: [],
}
export const respuesta = (x: Record<string, unknown> = {}) => ({
  estado: 'ok', cuenta: 'cuenta', cuenta_nombre: 'Gestoría Demo', quien: 'Quien Prueba', cliente: '1', cliente_nombre: 'Cliente Prueba, S.L.', de_empresa: null,
  empresas: [{ id: Q, nombre: 'QBO Prueba' }], clientes, ficha, ...x,
})
