// src/modules/conta/gestoria/g04/datos.ts
//
// G04 · Tarea 4 · Lo que leen y hacen las pantallas nuevas de Clientes, la
// ficha y «Tarifa y paquetes». TODAS las lecturas paginan (Julio, 08/11): de
// 1.000 en 1.000, en un orden fijo, hasta que una página vuelve corta. Así las
// cifras y los recuentos son de todos (el fallo del 07/11: se cortaba en 1.000).
// Lee las vistas de la 0930 (con su RLS: solo lo de la cuenta) y las tablas de
// GoCardless; hace por las funciones de la 0930, que ensayan por defecto.

import { funcion, mensaje, rpc, tabla } from '@/modules/conta/services/bd'

export type Fila = Record<string, unknown>
export const PAGINA = 1000

/** Toda una vista o tabla de la cuenta, página a página, en un orden fijo. */
export async function leerTodo(nombre: string, select: string, cuenta: { columna: string; id: string }, orden: string[],
  filtro?: (q: unknown) => unknown): Promise<Fila[]> {
  const todas: Fila[] = []
  for (let desde = 0; ; desde += PAGINA) {
    let q = (tabla(nombre).select(select) as unknown as { eq: (c: string, v: string) => unknown }).eq(cuenta.columna, cuenta.id)
    if (filtro) q = filtro(q)
    for (const o of orden) q = (q as { order: (c: string, x: { ascending: boolean; nullsFirst: boolean }) => unknown }).order(o, { ascending: true, nullsFirst: true })
    const { data, error } = await (q as { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> }).range(desde, desde + PAGINA - 1)
    if (error) throw new Error(mensaje(`No se ha podido leer ${nombre.replace(/^conta_(consulta_)?/, '').replace(/_/g, ' ')}`, error))
    const filas = (data ?? []) as Fila[]
    todas.push(...filas)
    if (filas.length < PAGINA) return todas
  }
}

/**
 * Toda una función de lectura (de las que comprueban la cuenta una sola vez),
 * página a página y en un orden fijo, como leerTodo.
 */
export async function leerFuncion(nombre: string, args: Record<string, unknown>, orden: string[]): Promise<Fila[]> {
  const todas: Fila[] = []
  for (let desde = 0; ; desde += PAGINA) {
    let q = funcion(nombre, args)
    for (const o of orden) q = (q as { order: (c: string, x: { ascending: boolean; nullsFirst: boolean }) => unknown }).order(o, { ascending: true, nullsFirst: true })
    const { data, error } = await (q as { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> }).range(desde, desde + PAGINA - 1)
    if (error) throw new Error(mensaje(`No se ha podido leer ${nombre.replace(/^conta_(lista_)?/, '').replace(/_/g, ' ')}`, error))
    const filas = (data ?? []) as Fila[]
    todas.push(...filas)
    if (filas.length < PAGINA) return todas
  }
}

export interface DatosClientes {
  clientes: Fila[]
  suscripciones: Fila[]
  cargos: Fila[]
  queHacer: Fila[]
  asignaciones: Fila[]
  precios: Fila[]
  servicios: Fila[]
  niveles: Fila[]
  paquetes: Fila[]
  lineasDePaquete: Fila[]
  ajustes: Fila[]
  fichas: Fila[]
  /** El CRM conectado (su nombre y su portal), para «Ver en …». */
  crm: Fila[]
  /** Los cobros y los mandatos de GoCardless (el último cobro de verdad y la pestaña «Cobros» de la ficha). */
  cobros: Fila[]
  mandatos: Fila[]
}

/** Todo lo de la lista, el panel y la ficha, de toda la cuenta (cada empresa lo filtra en la pantalla). */
export async function leerClientes(accountId: string): Promise<DatosClientes> {
  const cuenta = { columna: 'cuenta_id', id: accountId }
  const deCuenta = { columna: 'account_id', id: accountId }
  const [clientes, suscripciones, cargos, queHacer, asignaciones, precios, servicios, niveles, paquetes, lineasDePaquete, ajustes, fichas, crm, cobros, mandatos] = await Promise.all([
    // La lista y «Lo que tienes que hacer», por sus funciones de lectura (la 2209): las vistas, con la RLS fila
    // a fila, tardaban 5 s y 0,7 s en QBO; las funciones comprueban la cuenta una vez (61 ms la lista).
    leerFuncion('conta_lista_clientes', { p_cuenta: accountId }, ['cliente_id', 'empresa_id']),
    leerTodo('conta_gc_suscripcion', 'company_id, gc_id, gc_cliente_id, nombre, importe, al_mes, estado, inicio, fin, proximo_cobro_fecha, proximo_cobro_importe', deCuenta, ['company_id', 'gc_id'],
      (q) => (q as { eq: (c: string, v: string) => unknown }).eq('estado', 'active')),
    leerTodo('conta_consulta_cargo_devuelto', '*', cuenta, ['empresa_id', 'gc_id']),
    leerFuncion('conta_lista_que_hacer', { p_cuenta: accountId }, ['empresa_id', 'tipo']),
    leerTodo('conta_consulta_asignacion', '*', cuenta, ['cliente_id', 'id']),
    leerTodo('conta_consulta_tarifa_precio', '*', cuenta, ['id']),
    leerTodo('conta_servicio', 'id, company_id, clave, nombre, forma, activo', deCuenta, ['id']),
    leerTodo('conta_servicio_nivel', 'id, servicio_id, nombre, orden, incluye, mas_elegido, activo', deCuenta, ['id']),
    leerTodo('conta_paquete', 'id, company_id, nombre, descripcion, exceso_por_trabajador, activo', deCuenta, ['id']),
    leerTodo('conta_paquete_linea', 'id, paquete_id, servicio_id, nivel_id, limite_trabajadores, orden', deCuenta, ['id']),
    leerTodo('conta_gestoria_ajustes', 'company_id, mitad_de_mes, cambios_de_tarifa', deCuenta, ['company_id']),
    // Lo leído del CRM de cada cliente (contacto, dirección, referencia), para el panel y la ficha.
    leerTodo('conta_gestoria_cliente', 'party_id, ficha, leido_at', deCuenta, ['party_id']),
    leerTodo('conta_crm', 'crm, portal', deCuenta, ['crm']),
    leerTodo('conta_gc_cobro', 'company_id, gc_id, mandato_gc_id, suscripcion_gc_id, estado, fecha, importe, motivo', deCuenta, ['company_id', 'gc_id']),
    leerTodo('conta_gc_mandato', 'company_id, gc_id, gc_cliente_id, estado, creado', deCuenta, ['company_id', 'gc_id']),
  ])
  return { clientes, suscripciones, cargos, queHacer, asignaciones, precios, servicios, niveles, paquetes, lineasDePaquete, ajustes, fichas, crm, cobros, mandatos }
}

/** Los cobros de GoCardless de un cliente en una empresa (la pestaña «Cobros» de la ficha), con su mandato. */
export async function leerCobrosDe(accountId: string, empresaId: string, gcClienteId: string): Promise<Fila[]> {
  const mandatos = await leerTodo('conta_gc_mandato', 'gc_id, estado, creado', { columna: 'account_id', id: accountId }, ['gc_id'],
    (q) => (q as { eq: (c: string, v: string) => { eq: (c: string, v: string) => unknown } }).eq('company_id', empresaId).eq('gc_cliente_id', gcClienteId))
  const ids = mandatos.map((m) => String(m.gc_id))
  if (!ids.length) return []
  return leerTodo('conta_gc_cobro', 'gc_id, mandato_gc_id, estado, fecha, importe, motivo', { columna: 'account_id', id: accountId }, ['fecha', 'gc_id'],
    (q) => (q as { eq: (c: string, v: string) => { in: (c: string, v: string[]) => unknown } }).eq('company_id', empresaId).in('mandato_gc_id', ids))
}

type Respuesta = { frase: string; id?: string; ensayo?: boolean }
const hacer = (nombre: string, args: Record<string, unknown>) => rpc<Respuesta>(nombre, args)

/** Las acciones (todas ensayan si no se dice lo contrario; escriben con ensayo = false). */
export const acciones = {
  cobradoPorOtraVia: (empresa: string, cobro: string, via: 'transferencia' | 'efectivo', fecha: string) =>
    hacer('conta_gc_cobro_otra_via', { p_company: empresa, p_gc_cobro: cobro, p_via: via, p_fecha: fecha }),
  quitarOtraVia: (empresa: string, cobro: string) => hacer('conta_gc_cobro_otra_via_quitar', { p_company: empresa, p_gc_cobro: cobro }),
  anadir: (empresa: string, cliente: string, o: { servicio?: string | null; nivel?: string | null; paquete?: string | null }, desde: string, precio: Record<string, unknown> | null, ensayo: boolean) =>
    hacer('conta_tarifa_servicio_anadir', { p_company: empresa, p_party: cliente, p_servicio: o.servicio ?? null, p_nivel: o.nivel ?? null, p_paquete: o.paquete ?? null, p_desde: desde, p_precio: precio, p_ensayo: ensayo }),
  cambiarNivel: (linea: string, nivel: string, desde: string, ensayo: boolean) =>
    hacer('conta_tarifa_nivel_cambiar', { p_linea: linea, p_nivel: nivel, p_desde: desde, p_ensayo: ensayo }),
  guardarPrecio: (empresa: string, o: { servicio?: string | null; nivel?: string | null; paquete?: string | null }, cliente: string | null,
    forma: string, periodo: string | null, importe: number | null, tramos: unknown[] | null, desde: string, ensayo: boolean) =>
    hacer('conta_tarifa_precio_guardar', { p_company: empresa, p_servicio: o.servicio ?? null, p_nivel: o.nivel ?? null, p_paquete: o.paquete ?? null, p_party: cliente,
      p_forma: forma, p_periodo: periodo, p_importe: importe, p_tramos: tramos, p_desde: desde, p_ensayo: ensayo }),
  crearServicio: (empresa: string, nombre: string, forma: string, periodo: string | null, importe: number | null, tramos: unknown[] | null, desde: string | null, ensayo: boolean) =>
    hacer('conta_tarifa_servicio_crear', { p_company: empresa, p_nombre: nombre, p_forma: forma, p_periodo: periodo, p_importe: importe, p_tramos: tramos, p_desde: desde, p_ensayo: ensayo }),
  guardarNivel: (empresa: string, servicio: string, nivel: string | null, nombre: string, orden: number, incluye: string[], masElegido: boolean, ensayo: boolean) =>
    hacer('conta_tarifa_nivel_guardar', { p_company: empresa, p_servicio: servicio, p_nivel: nivel, p_nombre: nombre, p_orden: orden, p_incluye: incluye, p_mas_elegido: masElegido, p_ensayo: ensayo }),
  guardarPaquete: (empresa: string, paquete: string | null, nombre: string, descripcion: string | null, exceso: number | null,
    lineas: { servicio: string; nivel: string | null; limiteTrabajadores: number | null }[], ensayo: boolean) =>
    hacer('conta_tarifa_paquete_guardar', { p_company: empresa, p_paquete: paquete, p_nombre: nombre, p_descripcion: descripcion, p_exceso: exceso, p_lineas: lineas, p_ensayo: ensayo }),
  ensayarCambio: (empresa: string, operacion: unknown, resultado: unknown) => hacer('conta_tarifa_cambio_ensayar', { p_company: empresa, p_operacion: operacion, p_resultado: resultado }),
  aplicarCambio: (id: string) => hacer('conta_tarifa_cambio_aplicar', { p_cambio: id }),
  deshacerCambio: (id: string) => hacer('conta_tarifa_cambio_deshacer', { p_cambio: id }),
  enlazar: (empresa: string, gcCliente: string, cliente: string) => hacer('conta_gestoria_enlazar', { p_company: empresa, p_gc_cliente: gcCliente, p_party: cliente }),
}
