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
  servicios: { texto: string; detalle: string; importe: string }[]
  sueltos: { texto: string; importe: string }[]
  trabajadores: { nombre: string; desde: string; importe: string | null }[]
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
    .map((t) => ({ nombre: t.nombre, desde: t.desde, importe: t.importe }))
  return {
    cliente: String(r.cliente_nombre ?? f.nombre ?? 'Cliente'), clienteId, empresaId: f.empresaId ?? null,
    emisora: f.empresa ?? null, situacion, desde: m.clienteDesde, personaDeContacto: !!r.de_empresa, aviso,
    mesRecibo: m.mesRecibo,
    recibo: m.recibo.map((l) => ({ texto: l.texto, detalle: l.detalle, importe: l.importe, porque: l.etiquetas })),
    totalRecibo: m.totalRecibo,
    servicios: m.servicios.map((s) => ({ texto: s.texto, detalle: s.detalle, importe: s.importe })),
    sueltos: m.sueltos,
    trabajadores,
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
