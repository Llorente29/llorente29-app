// src/modules/conta/gestoria/g04/datos.ts
//
// G04 · Tarea 4 · Lo que leen y hacen las pantallas nuevas de Clientes, la
// ficha y «Tarifa y paquetes».
//
// Leer (Julio, nº 21, 08/11: toda pantalla abre en menos de 1 s, medido en el
// navegador con datos reales): UNA llamada por pantalla, ya agregada en la
// base, a las funciones de la 2308 (SECURITY DEFINER, el permiso de la cuenta
// comprobado una vez y cada tabla filtrada por la cuenta). Nada de leer los
// cobros o las suscripciones enteros en el navegador:
//   · conta_pantalla_clientes: todo lo que pinta Clientes (y «Tarifa y paquetes»);
//   · conta_pantalla_ficha: lo que solo hace falta al abrir un cliente;
//   · conta_pantalla_asignar: «Asignar a un cliente».
// Hacer, por las funciones de la 0930, que ensayan por defecto.

import { rpc } from '@/modules/conta/services/bd'

export type Fila = Record<string, unknown>

export interface DatosClientes {
  /** La lista (conta_lista_clientes), con los nombres de sus suscripciones activas (servicios_gc) y su último cargo. */
  clientes: Fila[]
  /** Por empresa: lo que cobra GoCardless al mes, y las altas y las bajas de este mes. */
  cuotasGc: Fila[]
  /** Por empresa y día: cuántos cobros y cuánto (el próximo cobro de cada suscripción activa). */
  proximos: Fila[]
  cargos: Fila[]
  queHacer: Fila[]
  asignaciones: Fila[]
  precios: Fila[]
  servicios: Fila[]
  niveles: Fila[]
  paquetes: Fila[]
  lineasDePaquete: Fila[]
  ajustes: Fila[]
  /** El CRM conectado (su nombre y su portal), para «Ver en …». */
  crm: Fila[]
}

const filas = (x: unknown): Fila[] => (Array.isArray(x) ? (x as Fila[]) : [])

/** Todo lo de Clientes, el panel y la tarifa, de toda la cuenta, en una llamada (cada empresa lo filtra en la pantalla). */
export async function leerClientes(accountId: string): Promise<DatosClientes> {
  const d = (await rpc<Fila | null>('conta_pantalla_clientes', { p_cuenta: accountId })) ?? {}
  return {
    clientes: filas(d.clientes), cuotasGc: filas(d.cuotas_gc), proximos: filas(d.proximos), cargos: filas(d.cargos), queHacer: filas(d.que_hacer),
    asignaciones: filas(d.asignaciones), precios: filas(d.precios), servicios: filas(d.servicios), niveles: filas(d.niveles), paquetes: filas(d.paquetes),
    lineasDePaquete: filas(d.lineas_de_paquete), ajustes: filas(d.ajustes), crm: filas(d.crm),
  }
}

/** Lo que solo hace falta al abrir un cliente: su ficha del CRM, sus mandatos, sus cobros (13 meses), sus suscripciones, lo pendiente y sus personas. */
export interface DatosFicha {
  ficha: Fila
  leidoAt: string | null
  mandatos: Fila[]
  cobros: Fila[]
  suscripciones: Fila[]
  pendientes: Fila[]
  personas: Fila[]
}

export async function leerFicha(accountId: string, cliente: string): Promise<DatosFicha> {
  const d = (await rpc<Fila | null>('conta_pantalla_ficha', { p_cuenta: accountId, p_cliente: cliente })) ?? {}
  return {
    ficha: d.ficha && typeof d.ficha === 'object' ? (d.ficha as Fila) : {}, leidoAt: typeof d.leido_at === 'string' ? d.leido_at : null,
    mandatos: filas(d.mandatos), cobros: filas(d.cobros), suscripciones: filas(d.suscripciones), pendientes: filas(d.pendientes), personas: filas(d.personas),
  }
}

/** «Asignar a un cliente»: las suscripciones activas de GoCardless y los clientes de GoCardless que las pagan. */
export async function leerAsignar(accountId: string): Promise<{ suscripciones: Fila[]; gcClientes: Fila[] }> {
  const d = (await rpc<Fila | null>('conta_pantalla_asignar', { p_cuenta: accountId })) ?? {}
  return { suscripciones: filas(d.suscripciones), gcClientes: filas(d.gc_clientes) }
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
  /** G05 · El «Qué incluye» de un servicio (vacío: el de siempre). */
  queIncluye: (empresa: string, servicio: string, texto: string, ensayo: boolean) =>
    hacer('conta_tarifa_servicio_incluye', { p_company: empresa, p_servicio: servicio, p_incluye: texto, p_ensayo: ensayo }),
  guardarPaquete: (empresa: string, paquete: string | null, nombre: string, descripcion: string | null, exceso: number | null,
    lineas: { servicio: string; nivel: string | null; limiteTrabajadores: number | null }[], ensayo: boolean) =>
    hacer('conta_tarifa_paquete_guardar', { p_company: empresa, p_paquete: paquete, p_nombre: nombre, p_descripcion: descripcion, p_exceso: exceso, p_lineas: lineas, p_ensayo: ensayo }),
  ensayarCambio: (empresa: string, operacion: unknown, resultado: unknown) => hacer('conta_tarifa_cambio_ensayar', { p_company: empresa, p_operacion: operacion, p_resultado: resultado }),
  aplicarCambio: (id: string) => hacer('conta_tarifa_cambio_aplicar', { p_cambio: id }),
  deshacerCambio: (id: string) => hacer('conta_tarifa_cambio_deshacer', { p_cambio: id }),
  enlazar: (empresa: string, gcCliente: string, cliente: string) => hacer('conta_gestoria_enlazar', { p_company: empresa, p_gc_cliente: gcCliente, p_party: cliente }),
}
