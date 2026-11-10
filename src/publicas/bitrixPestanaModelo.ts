// src/publicas/bitrixPestanaModelo.ts
//
// GB · La pestaña «Sumied» en la ficha de Bitrix24 · lo que pinta, sin tocar
// la página (lo prueban las unitarias: tests/unit/modules/conta/gb/modelo.test.ts).
//
// No calcula nada propio: lo que llega de conta-bitrix-pestana es lo mismo que
// leen Clientes y la ficha del G04 (conta_pantalla_clientes y
// conta_pantalla_ficha, leídas como la persona), y aquí pasa por el MISMO
// modelo de la ficha del G04 (modeloFicha). Así la pestaña y Sumied dicen
// siempre lo mismo: el recibo línea a línea, los cobros y los servicios.

import { modeloFicha, type Tono } from '../modules/conta/gestoria/g04/modelo'
import type { DatosClientes, DatosFicha, Fila } from '../modules/conta/gestoria/g04/datos'
import { mesSiguiente, totalDelRecibo } from '../../supabase/functions/conta-bitrix-pestana/escribir'

export type Estado = 'ok' | 'sin_acceso' | 'sin_enlazar' | 'portal_desconocido' | 'portal_no_permitido' | 'no_es_sumied' | 'ficha_rara' | 'varias_cuentas' | 'error'

const filas = (x: unknown): Fila[] => (Array.isArray(x) ? (x as Fila[]) : [])
const objeto = (x: unknown): Fila => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Fila) : {})

/** Lo de conta_pantalla_clientes, como lo lee la pantalla de Clientes (g04/datos.ts · leerClientes). */
export function datosDeClientes(x: unknown): DatosClientes {
  const d = objeto(x)
  return {
    clientes: filas(d.clientes), cuotasGc: filas(d.cuotas_gc), proximos: filas(d.proximos), cargos: filas(d.cargos), queHacer: filas(d.que_hacer),
    asignaciones: filas(d.asignaciones), precios: filas(d.precios), servicios: filas(d.servicios), niveles: filas(d.niveles), paquetes: filas(d.paquetes),
    lineasDePaquete: filas(d.lineas_de_paquete), ajustes: filas(d.ajustes), crm: filas(d.crm),
  }
}

/** Lo de conta_pantalla_ficha, como lo lee la ficha (g04/datos.ts · leerFicha). */
export function datosDeFicha(x: unknown): DatosFicha {
  const d = objeto(x)
  return {
    ficha: objeto(d.ficha), leidoAt: typeof d.leido_at === 'string' ? d.leido_at : null,
    mandatos: filas(d.mandatos), cobros: filas(d.cobros), suscripciones: filas(d.suscripciones), pendientes: filas(d.pendientes), personas: filas(d.personas),
  }
}

export interface Pestana {
  cliente: string
  clienteId: string
  empresaId: string | null
  /** «le factura …»: la empresa de la gestoría que le cobra. */
  emisora: string | null
  situacion: { texto: string; tono: Tono }
  desde: string | null
  /** Si es la ficha de una persona de contacto de la empresa cliente. */
  personaDeContacto: boolean
  /** Lo que se le debe (devueltos), en una frase; o nada. */
  aviso: { texto: string; tono: Tono } | null
  mesRecibo: string
  recibo: { texto: string; detalle: string; importe: string; porque: string[] }[]
  totalRecibo: string
  servicios: { texto: string; detalle: string; importe: string; lineaId: string | null; servicioId: string | null; especial: boolean
    /** nº 9 · Para «Cambiar»: sus niveles, el de ahora y si se cobra por trabajador. */
    niveles: { id: string; nombre: string }[]; nivelId: string | null; porTrabajador: boolean }[]
  sueltos: { texto: string; importe: string }[]
  trabajadores: { nombre: string; desde: string; importe: string | null; lineaId: string | null }[]
  /** nº 9 · Los servicios de su empresa que se cobran por trabajador (para dar de alta). */
  serviciosPorTrabajador: { id: string; nombre: string }[]
  mandato: { texto: string; tono: Tono } | null
  cobros: { fecha: string; importe: string; estado: string; tono: Tono }[]
  hayMasCobros: number
  pendientes: { porque: string }[]
}

const COBROS_A_LA_VISTA = 4

/** De la respuesta de conta-bitrix-pestana (estado «ok») a lo que se pinta. null si el cliente no sale en Clientes. */
export function modeloPestana(r: Fila, hoy: string): Pestana | null {
  const clienteId = String(r.cliente ?? '')
  if (!clienteId) return null
  const empresas = filas(r.empresas).map((e) => ({ id: String(e.id), nombre: String(e.nombre ?? '') }))
  const d = datosDeClientes(r.clientes)
  const suyo = datosDeFicha(r.ficha)
  const pendientes = suyo.pendientes.map((x) => ({ id: String(x.id), tipo: String(x.tipo), porque: String(x.porque ?? '') }))
  const m = modeloFicha(d, suyo, empresas, clienteId, null, hoy, pendientes)
  if (!m) return null
  const f = m.fila
  const situacion = { texto: f.situacionTexto, tono: f.situacionTono }
  const debe = f.debeCent || f.devueltos.reduce((s, x) => s + x.importeCent, 0)
  const aviso = f.devueltos.length
    ? { texto: `Tiene ${f.devueltos.length === 1 ? 'un recibo devuelto' : `${f.devueltos.length} recibos devueltos`} sin cobrar: ${euros(debe)}.`, tono: 'mal' as Tono }
    : f.aviso ? { texto: [f.aviso.titulo, f.aviso.texto].filter(Boolean).join('. '), tono: 'aviso' as Tono } : null
  const vistos = new Set<string>()
  const trabajadores = m.recibo.flatMap((l) => l.trabajadores).filter((t) => (vistos.has(t.nombre) ? false : (vistos.add(t.nombre), true)))
    .map((t) => ({ nombre: t.nombre, desde: t.desde, importe: t.importe, lineaId: t.lineaId }))
  return {
    cliente: String(r.cliente_nombre ?? f.nombre ?? 'Cliente'), clienteId, empresaId: f.empresaId ?? null,
    emisora: f.empresa ?? null, situacion, desde: m.clienteDesde, personaDeContacto: !!r.de_empresa, aviso,
    mesRecibo: m.mesRecibo,
    recibo: m.recibo.map((l) => ({ texto: l.texto, detalle: l.detalle, importe: l.importe, porque: l.etiquetas })),
    totalRecibo: m.totalRecibo,
    servicios: m.servicios.map((s) => {
      const fila = d.asignaciones.find((a) => String(a.id).replace(/^linea:/, '') === s.lineaId)
      return { texto: s.texto, detalle: s.detalle, importe: s.importe, lineaId: s.lineaId, servicioId: s.servicioId, especial: s.especial,
        niveles: d.niveles.filter((n) => String(n.servicio_id) === s.servicioId && n.activo !== false)
          .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0)).map((n) => ({ id: String(n.id), nombre: String(n.nombre) })),
        nivelId: fila?.nivel_id ? String(fila.nivel_id) : null,
        porTrabajador: d.servicios.some((x) => String(x.id) === s.servicioId && x.forma === 'por_empleado') }
    }),
    sueltos: m.sueltos,
    trabajadores,
    serviciosPorTrabajador: d.servicios.filter((x) => String(x.company_id) === String(f.empresaId) && x.forma === 'por_empleado' && x.activo !== false)
      .map((x) => ({ id: String(x.id), nombre: String(x.nombre) })),
    mandato: m.mandato,
    cobros: m.cobros.slice(0, COBROS_A_LA_VISTA), hayMasCobros: Math.max(0, m.cobros.length - COBROS_A_LA_VISTA),
    pendientes: m.pendientes.map((p) => ({ porque: p.porque || 'Sin detalle' })),
  }
}

export function euros(cent: number): string {
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(cent / 100)} €`
}

/** Lo que dice la pestaña cuando no enseña nada (si el servidor no ha mandado su frase). */
export const FRASE_DE: Record<Exclude<Estado, 'ok'>, string> = {
  sin_acceso: 'Pide acceso a Sumied a tu administrador.',
  sin_enlazar: 'Esta ficha no está enlazada con ningún cliente de Sumied.',
  portal_desconocido: 'Este Bitrix24 no está conectado con ninguna cuenta de Sumied.',
  portal_no_permitido: 'La pestaña de Sumied no está activada en este Bitrix24.',
  no_es_sumied: 'No se ha podido comprobar que eres tú. Cierra la ficha y vuelve a abrirla.',
  ficha_rara: 'Esta pestaña solo funciona en la ficha de una empresa o de un contacto.',
  varias_cuentas: 'Tu correo está en más de una cuenta de Sumied con este Bitrix24. Pide a tu administrador que lo revise.',
  error: 'No se ha podido leer Sumied. Vuelve a abrir la pestaña en un momento.',
}

/** Lo que llega detrás del «#»: el token, el portal y la ficha (o la instalación). */
export function leerAlmohadilla(hash: string): { a: string | null; p: string | null; t: string | null; id: string | null; instalar: string | null; que: string | null } {
  const h = new URLSearchParams(hash.replace(/^#/, ''))
  return { a: h.get('a'), p: h.get('p'), t: h.get('t'), id: h.get('id'), instalar: h.get('instalar'), que: h.get('que') }
}

// ── nº 9 · El recibo nuevo antes de guardar ─────────────────────────────────

export type Cambio =
  | { accion: 'alta'; servicio: string; nombre: string; desde: string }
  | { accion: 'baja'; linea: string; mes: string }
  | { accion: 'tarifa'; linea: string; servicio: string; nivel: string | null; precio: number | null; porTrabajador: boolean; motivo: string; desde: string }
  | { accion: 'solicitud'; solicitud: string; tipo: 'alta' | 'baja'; nombre: string; servicio: string | null; desde: string }

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const nombreDelMes = (mes: string) => MES[Number(mes.slice(5, 7)) - 1] ?? mes

/** Las asignaciones de Clientes como quedarían con el cambio (sin guardar nada). */
function conElCambio(clientes: unknown, clienteId: string, empresaId: string, c: Cambio): Fila {
  const d = objeto(clientes)
  const asignaciones = filas(d.asignaciones)
  // Lo que pide el cliente en su portal es un alta o una baja como las de la pestaña.
  if (c.accion === 'solicitud') {
    if (c.tipo === 'alta') return c.servicio ? conElCambio(clientes, clienteId, empresaId, { accion: 'alta', servicio: c.servicio, nombre: c.nombre, desde: c.desde }) : d
    const linea = asignaciones.find((a) => String(a.cliente_id) === clienteId && String(a.empleado_nombre ?? '').toUpperCase() === c.nombre.toUpperCase() && !a.hasta)
    return linea ? conElCambio(clientes, clienteId, empresaId, { accion: 'baja', linea: String(linea.id).replace(/^linea:/, ''), mes: c.desde }) : d
  }
  if (c.accion === 'alta') {
    return { ...d, asignaciones: [...asignaciones, { id: 'prevista', tipo: 'cuota', cliente_id: clienteId, empresa_id: empresaId, servicio_id: c.servicio,
      nivel_id: null, paquete_id: null, empleado_nombre: c.nombre.trim().toUpperCase(), importe_propio: null, periodo: 'mes', desde: c.desde, hasta: null }] }
  }
  if (c.accion === 'baja') return { ...d, asignaciones: asignaciones.map((a) => (String(a.id).replace(/^linea:/, '') === c.linea ? { ...a, hasta: c.mes } : a)) }
  // Nivel y precio especial: solo cuenta el mes que viene, así que basta con poner el nivel nuevo en su línea y añadir el precio suyo.
  const conNivel = asignaciones.map((a) => (String(a.id).replace(/^linea:/, '') === c.linea && c.nivel ? { ...a, nivel_id: c.nivel } : a))
  const precios = filas(d.precios)
  return { ...d, asignaciones: conNivel, precios: c.precio === null ? precios : [...precios, { id: 'prevista', empresa_id: empresaId, servicio_id: c.servicio,
    nivel_id: c.nivel, paquete_id: null, cliente_id: clienteId, forma: c.porTrabajador ? 'por_trabajador' : 'fijo', periodo: c.porTrabajador ? null : 'mes',
    importe: c.precio, tramos: [], desde: c.desde, hasta: null }] }
}

/** «El recibo de diciembre pasa de 225,00 € a 250,00 € (+25,00 €)», con la misma cuenta que la ficha del G04. */
export function reciboPrevisto(r: Fila, hoy: string, empresaId: string, c: Cambio): { mes: string; antes: number; despues: number; frase: string } {
  const clienteId = String(r.cliente ?? '')
  const mes = mesSiguiente(hoy)
  const antes = totalDelRecibo(r.clientes, clienteId, empresaId, mes)
  const despues = totalDelRecibo(conElCambio(r.clientes, clienteId, empresaId, c), clienteId, empresaId, mes)
  const dif = despues - antes
  const frase = dif === 0
    ? `El recibo de ${nombreDelMes(mes)} no cambia: ${euros(antes)}.`
    : `El recibo de ${nombreDelMes(mes)} pasa de ${euros(antes)} a ${euros(despues)} (${dif > 0 ? '+' : '−'}${euros(Math.abs(dif))}).`
  return { mes, antes, despues, frase }
}

// ── nº 9, punto 5 · Su portal ───────────────────────────────────────────────

export interface Portal {
  accesos: { nombre: string; permiso: string; entro: boolean }[]
  solicitudes: { id: string; tipo: 'alta' | 'baja'; nombre: string; fecha: string; texto: string }[]
  mensajesSinLeer: number
}

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

/** Lo que devuelve conta-bitrix-pestana (paso «portal»), para pintar «Su portal». */
export function modeloPortal(x: unknown): Portal | null {
  const d = objeto(x)
  if (d.estado !== 'ok') return null
  return {
    accesos: filas(d.accesos).map((a) => ({ nombre: String(a.nombre ?? a.correo ?? ''), permiso: a.permiso === 'todo' ? 'Todo' : 'Solo facturas y documentos', entro: !!a.entro })),
    solicitudes: filas(d.solicitudes).map((s) => {
      const tipo = s.tipo === 'baja' ? 'baja' : 'alta'
      const fecha = String(s.fecha ?? '')
      return { id: String(s.id), tipo, nombre: String(s.nombre ?? ''), fecha,
        texto: `Pide ${tipo === 'alta' ? 'un alta' : 'una baja'}: ${String(s.nombre ?? '')}, ${tipo === 'alta' ? 'desde el' : 'el'} ${fechaCorta(fecha)}` }
    }),
    mensajesSinLeer: Number(d.mensajes_sin_leer ?? 0),
  }
}

/**
 * nº 10 · Las pestañas por área de la pestaña Sumied (maqueta «Trabajar desde
 * Bitrix24», versión 27): Resumen · Cuotas y cobros · Laboral · Portal. Solo
 * las que tienen algo hoy: Impuestos, Contabilidad y Documentos llegarán
 * cuando existan. Todo sale de lo ya leído (la lectura y la del portal): ni
 * una lectura más.
 */
export type Area = 'resumen' | 'cobros' | 'laboral' | 'portal'

export interface Pendiente { area: Exclude<Area, 'resumen'>; etiqueta: string; tono: Tono; texto: string; boton: string }

/** «Lo pendiente con este cliente»: cada línea lleva a su pestaña. */
export function pendientesDe(p: Pestana, pt: Portal | null): Pendiente[] {
  const out: Pendiente[] = []
  const devueltos = p.cobros.filter((c) => c.tono === 'mal')
  for (const c of devueltos) out.push({ area: 'cobros', etiqueta: 'Cobros', tono: 'mal', texto: `Recibo del ${c.fecha} ${c.estado.toLowerCase()} · ${c.importe}`, boton: 'Ver' })
  if (!devueltos.length && p.aviso?.tono === 'mal') out.push({ area: 'cobros', etiqueta: 'Cobros', tono: 'mal', texto: p.aviso.texto, boton: 'Ver' })
  for (const x of p.pendientes) out.push({ area: 'cobros', etiqueta: 'Revisar', tono: 'aviso', texto: x.porque, boton: 'Ver' })
  for (const s of pt?.solicitudes ?? []) out.push({ area: 'portal', etiqueta: 'Portal', tono: 'aviso', texto: s.texto, boton: 'Ver' })
  if (pt?.mensajesSinLeer) out.push({ area: 'portal', etiqueta: 'Portal', tono: 'neutro',
    texto: `${pt.mensajesSinLeer} ${pt.mensajesSinLeer === 1 ? 'mensaje sin contestar' : 'mensajes sin contestar'}`, boton: 'Contestar' })
  return out
}

/** Las pestañas, con su aviso en la que tiene algo pendiente (y cuántos trabajadores en Laboral). */
export function areasDe(p: Pestana, pt: Portal | null): { id: Area; nombre: string; chip: string; tono: Tono | null }[] {
  const pend = pendientesDe(p, pt)
  const de = (a: Area) => pend.filter((x) => x.area === a)
  const cobros = de('cobros'); const portal = de('portal')
  return [
    { id: 'resumen', nombre: 'Resumen', chip: '', tono: null },
    { id: 'cobros', nombre: 'Cuotas y cobros', chip: cobros.length ? String(cobros.length) : '', tono: cobros.length ? (cobros.some((x) => x.tono === 'mal') ? 'mal' : 'aviso') : null },
    { id: 'laboral', nombre: 'Laboral', chip: String(p.trabajadores.length), tono: 'neutro' },
    { id: 'portal', nombre: 'Portal', chip: portal.length ? String(portal.length) : '', tono: portal.length ? 'aviso' : null },
  ]
}

/** En qué pestaña va cada formulario: abrir uno lleva a la suya. */
export const AREA_DE: Record<'alta' | 'baja' | 'tarifa' | 'solicitud', Area> = { alta: 'laboral', baja: 'laboral', tarifa: 'cobros', solicitud: 'portal' }
