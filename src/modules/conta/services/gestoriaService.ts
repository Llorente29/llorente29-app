// src/modules/conta/services/gestoriaService.ts
//
// G01 · Tarea 4 · Lo que leen y hacen las pantallas de Clientes y cuotas, las
// Tarifas y Ajustes › Cobros (GoCardless y Bitrix24). Lee las tablas de la
// 1530 (con su RLS: solo lo de la cuenta) y la vista conta_consulta_clientes;
// guarda por las funciones de la base (conta_gestoria_tarifa_guardar y
// conta_gocardless_reintentos, de la 1932) y conecta o lee por las funciones
// conta-gocardless-leer y conta-bitrix-leer. Cada cosa vuelve con su frase.

import { supabase } from '@/lib/supabase'
import { hayBase, mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import type { Linea, SuscripcionActiva, Tarifa } from '../../../../supabase/functions/conta-gocardless-leer/comparacion'
import type { ClienteGestoria, Cobro, Diferencia, TipoDiferencia } from '@/modules/conta/gestoria/vista'
import type { CampoMedido, MapaBitrix } from '../../../../supabase/functions/conta-bitrix-leer/mapa'

type Fila = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const cent = (v: unknown): number => Math.round(Number(v ?? 0) * 100)
const mes = (d: unknown): string => String(d ?? '').slice(0, 7)

export interface Servicio { id: string; emisorId: string; clave: string; nombre: string; forma: string }

export interface DatosGestoria {
  filas: ClienteGestoria[]
  lineas: Linea[]
  tarifas: Tarifa[]
  suscripciones: (SuscripcionActiva & { clienteId: string | null; gcClienteId: string | null })[]
  servicios: Servicio[]
}

async function leer(nombre: string, select: string, filtro: (q: ReturnType<typeof tabla>) => unknown): Promise<Fila[]> {
  const q = filtro(tabla(nombre).select(select)) as PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${nombre.replace(/^conta_/, '').replace(/_/g, ' ')}`, error))
  return (data ?? []) as Fila[]
}

/** G01b · La situación en Bitrix24, la dirección (y de qué campo sale) y las otras, de la ficha guardada. */
type ExtraDeFicha = Pick<NonNullable<ClienteGestoria['bitrix']>, 'situacionTexto' | 'direccion' | 'direccionDe' | 'otrasDirecciones'>
function extraDeFicha(f: Fila | undefined): ExtraDeFicha {
  if (!f) return {}
  const otras = Array.isArray(f.otras) ? (f.otras as Fila[]).filter((o) => str(o?.texto)).map((o) => ({ etiqueta: String(o.etiqueta ?? ''), texto: String(o.texto) })) : []
  const direccion = [str(f.calle), str(f.cp) && !String(f.calle ?? '').includes(String(f.cp)) ? str(f.cp) : null, str(f.poblacion), str(f.provincia)].filter(Boolean).join(', ')
  return { situacionTexto: str(f.situacion_texto), direccion: direccion || null, direccionDe: str(f.direccion_de), otrasDirecciones: otras }
}

export async function leerGestoria(accountId: string): Promise<DatosGestoria> {
  const cuenta = (q: ReturnType<typeof tabla>) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq('account_id', accountId)
  const [clientes, lineas, servicios, tarifas, susc, gcClientes, mandatos, cobros, difs, decisiones, fichas] = await Promise.all([
    leer('conta_consulta_clientes', 'cliente_id, cliente, nif, situacion, servicios, forma_de_pago_en_bitrix, emisor_id, emisor, forma_de_cobro, cliente_en_gocardless, mandato',
      (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq('cuenta_id', accountId)),
    leer('conta_linea', 'id, party_id, company_id, servicio_id, tipo, detalle, empleado_nombre, importe_propio, periodo, desde, hasta, suscripcion_gc_id', cuenta),
    leer('conta_servicio', 'id, company_id, clave, nombre, forma', cuenta),
    leer('conta_tarifa', 'company_id, servicio_id, party_id, importe, periodo, desde, hasta', cuenta),
    leer('conta_gc_suscripcion', 'company_id, gc_id, gc_cliente_id, nombre, al_mes, estado, inicio', cuenta),
    leer('conta_gc_cliente', 'company_id, gc_id, nombre, nif, party_id', cuenta),
    leer('conta_gc_mandato', 'company_id, gc_id, gc_cliente_id, estado', cuenta),
    leer('conta_gc_cobro', 'company_id, mandato_gc_id, estado, fecha, importe, motivo', cuenta),
    leer('conta_gestoria_diferencia', 'id, company_id, party_id, gc_cliente_id, tipo, porque, vigente', cuenta),
    leer('conta_gestoria_decision', 'company_id, tipo, suscripcion_gc_id', cuenta),
    // G01b · De la ficha guardada (conta-bitrix-leer/mapa.ts · FichaBitrix): lo que se enseña en «Lo que dice Bitrix24».
    leer('conta_gestoria_cliente', 'party_id, situacion_texto:ficha->>situacionTexto, direccion_de:ficha->>direccionDe, calle:ficha->>calle, cp:ficha->>cp, poblacion:ficha->>poblacion, provincia:ficha->>provincia, otras:ficha->otrasDirecciones', cuenta),
  ])
  const fichaDe = new Map(fichas.map((f) => [String(f.party_id), f]))
  // Lo que una persona dijo que no se cuente (una baja que GoCardless sigue cobrando) no suma al comparar.
  const noContar = new Set(decisiones.filter((d) => d.tipo === 'no_contar').map((d) => `${d.company_id}|${d.suscripcion_gc_id}`))
  const serv = new Map(servicios.map((s) => [String(s.id), { id: String(s.id), emisorId: String(s.company_id), clave: String(s.clave), nombre: String(s.nombre), forma: String(s.forma) }]))
  const delGc = new Map(gcClientes.map((g) => [`${g.company_id}|${g.gc_id}`, g]))
  const ls: Linea[] = lineas.filter((l) => l.tipo === 'cuota' && serv.has(String(l.servicio_id))).map((l) => {
    const s = serv.get(String(l.servicio_id))!
    return {
      id: String(l.id), emisor: String(l.company_id), servicio: s.clave, nombreServicio: s.nombre, detalle: str(l.detalle), empleado: str(l.empleado_nombre),
      importePropioCent: l.importe_propio == null ? null : cent(l.importe_propio), periodo: l.periodo === 'anio' ? 'anio' : 'mes',
      desde: mes(l.desde), hasta: l.hasta ? mes(l.hasta) : null, suscripcionId: str(l.suscripcion_gc_id), clienteId: String(l.party_id),
    } as Linea & { clienteId: string }
  })
  const ts: Tarifa[] = tarifas.filter((t) => serv.has(String(t.servicio_id)) && t.periodo !== 'unidad').map((t) => ({
    emisor: String(t.company_id), servicio: serv.get(String(t.servicio_id))!.clave, clienteId: str(t.party_id), importeCent: cent(t.importe),
    periodo: t.periodo === 'anio' ? 'anio' : 'mes', desde: mes(t.desde), hasta: t.hasta ? mes(t.hasta) : null,
  }))
  const esteMes = new Date().toISOString().slice(0, 7)
  const ss = susc.filter((s) => s.estado === 'active' && mes(s.inicio) <= esteMes && !noContar.has(`${s.company_id}|${s.gc_id}`)).map((s) => ({
    id: String(s.gc_id), emisor: String(s.company_id), nombre: String(s.nombre ?? ''), alMesCent: cent(s.al_mes),
    clienteId: str(delGc.get(`${s.company_id}|${s.gc_cliente_id}`)?.party_id),
    gcClienteId: str(s.gc_cliente_id),
  }))
  const mandatoDe = new Map(mandatos.map((m) => [`${m.company_id}|${m.gc_id}`, String(m.gc_cliente_id ?? '')]))
  const cobrosDe = (emisor: string, gc: string | null): Cobro[] => !gc ? [] : cobros
    .filter((c) => String(c.company_id) === emisor && mandatoDe.get(`${emisor}|${c.mandato_gc_id}`) === gc)
    .map((c) => ({ fecha: String(c.fecha ?? ''), importeCent: cent(c.importe), estado: String(c.estado ?? ''), motivo: str(c.motivo) }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 6)
  const ds: Diferencia[] = difs.filter((d) => d.vigente !== false).map((d) => ({
    id: String(d.id), tipo: d.tipo as TipoDiferencia, porque: String(d.porque ?? ''), clienteId: str(d.party_id), emisorId: str(d.company_id), gcClienteId: str(d.gc_cliente_id),
  }))

  const filas: ClienteGestoria[] = clientes.filter((c) => c.emisor_id).map((c) => {
    const emisor = String(c.emisor_id)
    const id = String(c.cliente_id)
    const gc = str(c.cliente_en_gocardless)
    return {
      id: `${id}|${emisor}`, clienteId: id, nombre: String(c.cliente ?? ''), nif: str(c.nif), emisorId: emisor, emisor: String(c.emisor ?? ''),
      bitrix: { situacion: str(c.situacion), formaPago: str(c.forma_de_pago_en_bitrix), servicios: Array.isArray(c.servicios) ? (c.servicios as unknown[]).map(String) : [], ...extraDeFicha(fichaDe.get(id)) },
      formaCobro: (str(c.forma_de_cobro) as ClienteGestoria['formaCobro']) ?? null, mandato: str(c.mandato), cobros: cobrosDe(emisor, gc),
      diferencias: ds.filter((d) => d.clienteId === id && (d.emisorId === null || d.emisorId === emisor)),
    }
  })
  // Quien solo está en GoCardless (sin ficha en Bitrix24): también es una fila, para verlo y casarlo.
  for (const d of ds.filter((x) => x.tipo === 'gocardless_sin_ficha' && x.gcClienteId && x.emisorId)) {
    const g = delGc.get(`${d.emisorId}|${d.gcClienteId}`)
    const emisor = d.emisorId!
    filas.push({
      id: `gc|${emisor}|${d.gcClienteId}`, clienteId: null, nombre: String(g?.nombre ?? d.gcClienteId), nif: str(g?.nif), emisorId: emisor,
      emisor: filas.find((f) => f.emisorId === emisor)?.emisor ?? '', bitrix: null, formaCobro: 'gocardless',
      mandato: mandatos.find((m) => String(m.company_id) === emisor && m.gc_cliente_id === d.gcClienteId)?.estado as string ?? null,
      cobros: cobrosDe(emisor, d.gcClienteId), diferencias: [d],
    })
  }
  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return { filas, lineas: ls, tarifas: ts, suscripciones: ss, servicios: [...serv.values()] }
}

// ── Ajustes › Cobros ────────────────────────────────────────────────────────

export interface ConexionGc {
  emisorId: string
  entorno: 'real' | 'pruebas'
  conectada: boolean
  conectadaAt: string | null
  conectadaPor: string | null
  ultimaLectura: string | null
  mandatosVivos: number | null
  lineasActivas: number | null
  alMesCent: number | null
  porDefecto: boolean
  reintentos: boolean
  abono: { coincide: boolean | null; porque: string | null }
}
export interface ConexionBitrix {
  entorno: 'real' | 'pruebas'; portal: string | null; conectada: boolean; conectadaAt: string | null; ultimaLectura: string | null; empresasLeidas: number | null
  /** G01b · El mapa guardado (con su «confirmado») y lo medido del portal, para «Qué es cada campo». */
  mapa: MapaBitrix | null
  medidos: Record<string, CampoMedido> | null
}

export async function leerConexiones(accountId: string): Promise<{ gocardless: ConexionGc[]; bitrix: ConexionBitrix | null }> {
  const cuenta = (q: ReturnType<typeof tabla>) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq('account_id', accountId)
  const [gc, bx] = await Promise.all([
    leer('conta_cobro_gocardless', 'company_id, entorno, token_ref, conectada_at, conectada_por_name, ultima_lectura_at, mandatos_vivos, lineas_activas, al_mes, por_defecto, reintentos_inteligentes, abono_coincide, abono_porque', cuenta),
    leer('conta_crm_bitrix', 'entorno, portal, url_ref, conectada_at, ultima_lectura_at, empresas_leidas, mapa, campos_medidos', cuenta),
  ])
  return {
    gocardless: gc.map((g) => ({
      emisorId: String(g.company_id), entorno: g.entorno === 'pruebas' ? 'pruebas' : 'real', conectada: !!g.token_ref, conectadaAt: str(g.conectada_at),
      conectadaPor: str(g.conectada_por_name), ultimaLectura: str(g.ultima_lectura_at), mandatosVivos: g.mandatos_vivos == null ? null : Number(g.mandatos_vivos),
      lineasActivas: g.lineas_activas == null ? null : Number(g.lineas_activas), alMesCent: g.al_mes == null ? null : cent(g.al_mes),
      porDefecto: g.por_defecto !== false, reintentos: g.reintentos_inteligentes === true,
      abono: { coincide: typeof g.abono_coincide === 'boolean' ? g.abono_coincide : null, porque: str(g.abono_porque) },
    })),
    bitrix: bx[0] ? {
      entorno: bx[0].entorno === 'pruebas' ? 'pruebas' : 'real', portal: str(bx[0].portal), conectada: !!bx[0].url_ref, conectadaAt: str(bx[0].conectada_at),
      ultimaLectura: str(bx[0].ultima_lectura_at), empresasLeidas: bx[0].empresas_leidas == null ? null : Number(bx[0].empresas_leidas),
      mapa: (bx[0].mapa as MapaBitrix | null) ?? null, medidos: (bx[0].campos_medidos as Record<string, CampoMedido> | null) ?? null,
    } : null,
  }
}

/** Llama a una de las dos funciones de lectura y devuelve su frase (o el porqué que da, si falla). */
async function funcion(nombre: 'conta-gocardless-leer' | 'conta-bitrix-leer', body: Record<string, unknown>, que: string): Promise<string> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke(nombre, { body })
  if (!error) return String((data as Fila | null)?.frase ?? `${que}: hecho.`)
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) as Fila | null : null
  throw new Error(str(cuerpo?.error) ?? `${que}: ${ctx?.status === 404 ? 'la lectura aún no está publicada en este entorno' : error.message}`)
}

export const conectarGocardless = (empresa: string, entorno: 'real' | 'pruebas', token: string) =>
  funcion('conta-gocardless-leer', { accion: 'conectar', empresa, entorno, token: token.trim() }, 'No se ha conectado GoCardless')
export const leerGocardless = (empresa: string) => funcion('conta-gocardless-leer', { accion: 'leer', empresa }, 'No se ha leído GoCardless')
export const conectarBitrix = (cuenta: string, entorno: 'real' | 'pruebas', url: string) =>
  funcion('conta-bitrix-leer', { accion: 'conectar', cuenta, entorno, url: url.trim() }, 'No se ha conectado Bitrix24')
export const leerBitrix = (cuenta: string) => funcion('conta-bitrix-leer', { accion: 'leer', cuenta }, 'No se ha leído Bitrix24')

/** G01b · «Qué es cada campo»: guarda el mapa confirmado (conta_bitrix_confirmar_mapa) y lee de nuevo. Las dos frases. */
export async function confirmarMapaBitrix(cuenta: string, mapa: MapaBitrix): Promise<string> {
  const r = await rpc<{ frase: string }>('conta_bitrix_confirmar_mapa', { p_account: cuenta, p_mapa: mapa })
  try { return `${r.frase} ${await leerBitrix(cuenta)}` }
  catch (e) { throw new Error(`${r.frase} Pero la lectura no ha salido: ${e instanceof Error ? e.message : String(e)}`, { cause: e }) }
}

export async function cambiarReintentos(empresa: string, encendido: boolean): Promise<string> {
  const r = await rpc<{ frase: string }>('conta_gocardless_reintentos', { p_company: empresa, p_encendido: encendido })
  return r.frase
}

export async function guardarTarifa(a: { empresa: string; servicio: string; cliente: string | null; importe: number; periodo: 'mes' | 'anio'; desde: string; motivo: string | null }): Promise<{ frase: string; afecta: number }> {
  return rpc<{ frase: string; afecta: number }>('conta_gestoria_tarifa_guardar', {
    p_company: a.empresa, p_servicio: a.servicio, p_party: a.cliente, p_importe: a.importe, p_periodo: a.periodo, p_desde: a.desde, p_motivo: a.motivo,
  })
}

// ── Lo que se hace desde la ficha (la 2000): cada una devuelve su frase ──────
const frase = async (nombre: string, args: Record<string, unknown>) => (await rpc<{ frase: string }>(nombre, args)).frase
export const altaEmpleado = (empresa: string, cliente: string, servicio: string, empleado: string, desde: string) =>
  frase('conta_gestoria_alta_empleado', { p_company: empresa, p_party: cliente, p_servicio: servicio, p_empleado: empleado, p_desde: desde })
export const bajaLinea = (linea: string, mes: string) => frase('conta_gestoria_baja_linea', { p_linea: linea, p_mes: mes })
export const lineaDesdeGc = (empresa: string, suscripcion: string, servicio: string, empleado: string | null) =>
  frase('conta_gestoria_linea_desde_gc', { p_company: empresa, p_suscripcion: suscripcion, p_servicio: servicio, p_empleado: empleado })
export const noContar = (empresa: string, suscripcion: string, motivo: string | null) =>
  frase('conta_gestoria_no_contar', { p_company: empresa, p_suscripcion: suscripcion, p_motivo: motivo })
export const enlazar = (empresa: string, gcCliente: string, cliente: string) =>
  frase('conta_gestoria_enlazar', { p_company: empresa, p_gc_cliente: gcCliente, p_party: cliente })
export const revisada = (diferencia: string, motivo: string) => frase('conta_gestoria_revisada', { p_diferencia: diferencia, p_motivo: motivo })
