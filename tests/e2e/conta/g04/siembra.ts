// tests/e2e/conta/g04/siembra.ts
//
// G04 · La siembra inventada de la e2e de Clientes, la ficha y «Tarifa y
// paquetes»: los clientes, cobros y suscripciones del tablero Main, y los
// niveles (Básica, Estándar, Premium), la laboral por tramos y los paquetes
// del tablero Tarifa. Todo inventado (T11): nombres «de Prueba», «Ejemplo» o
// «Ficticio», NIF de ceros. Las fechas, alrededor de hoy, para que no caduquen.
//
// Por qué simulada y no sembrada en staging: las tablas del G04 solo se
// escriben por sus funciones, y las de la tarifa piden los «cambios de tarifa»
// encendidos; la cuenta de prueba no puede sembrar con su sesión (y la clave de
// servicio no se usa en una e2e). Las funciones las prueban sus pruebas de
// staging (20261108_g04_tarifa_y_clientes_prueba.sql y
// 20261108_g04_servicio_crear_prueba.sql), en ROLLBACK.

type Fila = Record<string, unknown>

const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
export const dia = (d: number) => { const x = new Date(`${hoyMadrid()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }

/** Las filas que devuelve cada tabla o vista, por su nombre en la API. Q y A: las dos empresas de la cuenta de prueba. */
export function siembra(Q: string, A: string): Record<string, Fila[]> {
  const cliente = (id: string, emp: string | null, nombre: string, nif: string, x: Fila = {}): Fila => ({
    cliente_id: `c${id}`, empresa_id: emp, cliente: nombre, nif, situacion: 'activo', crm: 'bitrix24', tipo_ficha: 'empresa', ficha_en_el_crm: id,
    forma_de_cobro: 'gocardless', cliente_en_gocardless: `CU${id}`, mandato: 'active', gocardless_al_mes: null, ultimo_cobro_fecha: dia(-4), pendientes: 0, trabajadores: [], ...x,
  })
  const sub = (emp: string, gc: string, al: number, fecha: string, nombre = 'GESTORIA MENSUAL'): Fila => ({
    company_id: emp, gc_id: `S${gc}-${fecha}`, gc_cliente_id: `CU${gc}`, nombre, importe: al, al_mes: al, estado: 'active', inicio: '2024-01-01', fin: null,
    proximo_cobro_fecha: fecha, proximo_cobro_importe: al,
  })
  const linea = (id: string, cli: string, emp: string, x: Fila): Fila => ({
    id, tipo: 'cuota', cliente_id: `c${cli}`, empresa_id: emp, servicio_id: null, nivel_id: null, paquete_id: null, empleado_nombre: null, importe_propio: null, periodo: 'mes', desde: '2024-01-01', hasta: null, ...x,
  })
  const trabajadores = (cli: string, emp: string, n: number) => Array.from({ length: n }, (_, i) => linea(`w${cli}-${i}`, cli, emp, { servicio_id: `lab-${emp}`, empleado_nombre: `Persona Prueba ${cli}-${i + 1}` }))
  const precio = (id: string, emp: string, x: Fila): Fila => ({ id, empresa_id: emp, servicio_id: null, nivel_id: null, paquete_id: null, cliente_id: null, forma: 'fijo', periodo: 'mes', importe: null, tramos: [], desde: '2024-01-01', hasta: null, ...x })
  const laboral = [{ desde: 1, hasta: 5, importe: 100, porUnidad: false }, { desde: 6, hasta: null, importe: 18, porUnidad: true }]
  // El catálogo del tablero Tarifa, igual en las dos empresas (cada una con sus ids).
  const catalogo = (e: string) => ({
    servicios: [
      { id: `ges-${e}`, company_id: e, clave: 'gestoria_mensual', nombre: 'Gestoría mensual', forma: 'fijo_mes', activo: true },
      { id: `lab-${e}`, company_id: e, clave: 'gestion_laboral', nombre: 'Gestión laboral', forma: 'por_empleado', activo: true },
      { id: `ren-${e}`, company_id: e, clave: 'renta', nombre: 'Renta', forma: 'fijo_mes', activo: true },
      { id: `vig-${e}`, company_id: e, clave: 'vigilancia', nombre: 'Vigilancia de la salud', forma: 'fijo_anio', activo: true },
    ],
    niveles: [
      { id: `b-${e}`, servicio_id: `ges-${e}`, nombre: 'Básica', orden: 1, incluye: ['Contabilidad hasta 30 facturas al mes', 'Impuestos trimestrales', 'Atención por correo'], mas_elegido: false, activo: true },
      { id: `e-${e}`, servicio_id: `ges-${e}`, nombre: 'Estándar', orden: 2, incluye: ['Contabilidad hasta 100 facturas al mes', 'Impuestos trimestrales y anuales', 'Cuentas anuales', 'Atención por teléfono'], mas_elegido: true, activo: true },
      { id: `p-${e}`, servicio_id: `ges-${e}`, nombre: 'Premium', orden: 3, incluye: ['Facturas sin límite', 'Todo lo de Estándar', 'Cierre mensual con informe', 'Gestor asignado'], mas_elegido: false, activo: true },
    ],
    paquetes: [{ id: `pyme-${e}`, company_id: e, nombre: 'Pack Pyme', descripcion: 'Para empresas pequeñas: la cuota Estándar y la laboral de hasta 5 trabajadores.', exceso_por_trabajador: 18, activo: true }],
    lineasDePaquete: [
      { id: `pl1-${e}`, paquete_id: `pyme-${e}`, servicio_id: `ges-${e}`, nivel_id: `e-${e}`, limite_trabajadores: null, orden: 1 },
      { id: `pl2-${e}`, paquete_id: `pyme-${e}`, servicio_id: `lab-${e}`, nivel_id: null, limite_trabajadores: 5, orden: 2 },
    ],
    precios: [
      precio(`pb-${e}`, e, { servicio_id: `ges-${e}`, nivel_id: `b-${e}`, importe: 45 }),
      precio(`pe-${e}`, e, { servicio_id: `ges-${e}`, nivel_id: `e-${e}`, importe: 60.5 }),
      precio(`pp-${e}`, e, { servicio_id: `ges-${e}`, nivel_id: `p-${e}`, importe: 95 }),
      precio(`pl-${e}`, e, { servicio_id: `lab-${e}`, forma: 'tramo_y_por_trabajador', periodo: null, tramos: laboral }),
      precio(`pr-${e}`, e, { servicio_id: `ren-${e}`, periodo: 'vez', importe: 60 }),
      precio(`pv-${e}`, e, { servicio_id: `vig-${e}`, periodo: 'anio', importe: 605 }),
      precio(`pq-${e}`, e, { paquete_id: `pyme-${e}`, importe: 150 }),
    ],
  })
  const cq = catalogo(Q)
  const ca = catalogo(A)
  const proximo = dia(26)
  return {
    conta_consulta_cliente_empresa: [
      cliente('1', Q, 'Panadería Muestra, S.L.', 'B00000022', { gocardless_al_mes: 108.9, pendientes: 1 }),
      cliente('2', A, 'Cliente Ejemplo Uno', '00000033T', { cliente_en_gocardless: null, mandato: null, forma_de_cobro: null, ultimo_cobro_fecha: null }),
      cliente('3', Q, 'Estudio de Prueba, S.L.', 'B00000044', { gocardless_al_mes: 109.1 }),
      cliente('5', Q, 'Talleres Ejemplo, S.L.', 'B00000066', { gocardless_al_mes: 133.1 }),
      cliente('6', Q, 'Construcciones Ficticias, S.A.', 'A00000077', { gocardless_al_mes: 151.8 }),
      cliente('7', A, 'Cliente Ejemplo Dos', '00000088M', { gocardless_al_mes: 48.4 }),
      cliente('8', Q, 'Transportes de Ejemplo, S.L.', 'B00000011', { gocardless_al_mes: 496.1 }),
      cliente('9', null, 'Antiguo Cliente Ejemplo', 'B00000099', { situacion: 'baja', cliente_en_gocardless: null }),
    ],
    conta_gc_suscripcion: [sub(Q, '1', 108.9, proximo), sub(Q, '3', 109.1, proximo), sub(Q, '5', 133.1, proximo), sub(Q, '6', 151.8, proximo), sub(Q, '8', 496.1, proximo),
      sub(A, '7', 48.4, proximo), sub(Q, '1x', 145.2, dia(10), 'GESTION LABORAL Persona Prueba'), sub(Q, '2x', 60.5, dia(10))],
    conta_consulta_cargo_devuelto: [{ cuenta_id: 'x', empresa_id: Q, gc_id: 'PM1', suscripcion_gc_id: 'S1', estado: 'failed', fecha: dia(-70), importe: 108.9, clientes: ['c1'], mandato_activo: true, cobrado_despues: false, otra_via: null }],
    conta_consulta_que_hacer: [{ empresa_id: Q, tipo: 'gocardless_sin_cliente', n: 2, euros: 205.7 }, { empresa_id: Q, tipo: 'recibos_devueltos', n: 1, euros: 108.9 }],
    conta_consulta_asignacion: [
      linea('g1', '1', Q, { servicio_id: `ges-${Q}`, nivel_id: `b-${Q}` }), ...trabajadores('1', Q, 2),
      linea('g3', '3', Q, { servicio_id: `ges-${Q}`, nivel_id: `e-${Q}` }), ...trabajadores('3', Q, 2),
      linea('g5', '5', Q, { paquete_id: `pyme-${Q}` }),
      linea('g6', '6', Q, { servicio_id: `ges-${Q}`, nivel_id: `e-${Q}` }), ...trabajadores('6', Q, 4),
      linea('g7', '7', A, { servicio_id: `ges-${A}`, nivel_id: `b-${A}` }), ...trabajadores('7', A, 6),
      linea('g8', '8', Q, { servicio_id: `ges-${Q}`, nivel_id: `p-${Q}` }), ...trabajadores('8', Q, 18),
    ],
    conta_consulta_tarifa_precio: [...cq.precios, ...ca.precios,
      precio('c6e', Q, { servicio_id: `ges-${Q}`, nivel_id: `e-${Q}`, cliente_id: 'c6', importe: 55, desde: '2026-03-01' })],
    conta_servicio: [...cq.servicios, ...ca.servicios],
    conta_servicio_nivel: [...cq.niveles, ...ca.niveles],
    conta_paquete: [...cq.paquetes, ...ca.paquetes],
    conta_paquete_linea: [...cq.lineasDePaquete, ...ca.lineasDePaquete],
    conta_gestoria_ajustes: [],
    conta_gestoria_cliente: [{ party_id: 'c1', ficha: { telefonos: ['600 000 000'], correos: ['admin@ejemplo.es'], cuotasReferencia: [{ etiqueta: 'Tarifa recurrente', importeCent: 10890 }] }, leido_at: `${dia(0)}T05:00:00Z` }],
    conta_crm: [{ crm: 'bitrix24', portal: 'portal-de-prueba.bitrix24.es' }],
    conta_gc_cobro: [
      ...[-120, -90, -60, -30].map((d, i) => ({ company_id: Q, gc_id: `PB8-${i}`, mandato_gc_id: 'MD8', suscripcion_gc_id: 'SB8', estado: i === 2 ? 'failed' : 'paid_out', fecha: dia(d), importe: 496.1, motivo: null })),
      { company_id: Q, gc_id: 'PB8', mandato_gc_id: 'MD8', suscripcion_gc_id: 'SB8', estado: 'paid_out', fecha: dia(-4), importe: 496.1, motivo: null },
    ],
    conta_gc_mandato: [{ company_id: Q, gc_id: 'MD1', gc_cliente_id: 'CU1', estado: 'active', creado: '2024-01-01' }, { company_id: Q, gc_id: 'MD8', gc_cliente_id: 'CU8', estado: 'active', creado: '2020-01-01' }],
    conta_gc_cliente: [
      { company_id: Q, gc_id: 'CU1x', nombre: 'TRANSPORTES DE EJEMPLO SL', correo: null, nif: 'B-00000011' },
      { company_id: Q, gc_id: 'CU2x', nombre: 'Persona Inventada', correo: 'nadie@ejemplo.es', nif: null },
    ],
    conta_gestoria_diferencia: [],
    conta_gestoria_ficha: [],
  }
}

/** Las frases que devuelve cada acción simulada (lo que dice la base de verdad, con datos inventados). */
export const FRASES: Record<string, (cuerpo: Fila) => Fila> = {
  conta_gc_cobro_otra_via: () => ({ frase: 'Guardado: ese cargo ya no sale en «Te deben». En GoCardless no cambia nada.' }),
  conta_gestoria_enlazar: () => ({ frase: 'Enlazado: TRANSPORTES DE EJEMPLO SL de GoCardless es Transportes de Ejemplo, S.L.. Desde ahora sus cobros salen en su ficha.' }),
  conta_tarifa_precio_guardar: () => ({ id: 'x', frase: 'Guardado Gestoría mensual · Estándar (precio de tarifa): 62,00 € al mes desde diciembre de 2026.' }),
  conta_tarifa_servicio_crear: (c) => ({ id: 'nuevo', frase: `Creado el servicio «${String(c.p_nombre)}», que se cobra un precio fijo cada mes. Guardado ${String(c.p_nombre)} (precio de tarifa): 30,00 € al mes desde diciembre de 2026.` }),
  conta_tarifa_cambio_ensayar: () => ({ id: 'cambio-1', ensayo: true, frase: 'Ensayo guardado.' }),
  conta_tarifa_cambio_aplicar: () => ({ frase: 'Aplicado: Gestión laboral sube un 3 % desde enero de 2027 para 3 clientes.' }),
}
