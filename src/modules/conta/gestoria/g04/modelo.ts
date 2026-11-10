// src/modules/conta/gestoria/g04/modelo.ts
//
// G04 · Tarea 4 · De lo leído (datos.ts) a lo que pinta la pantalla de
// Clientes, el panel y la ficha. Puro: lo prueba
// tests/unit/modules/conta/gestoria/g04/modelo.test.ts. Usa los núcleos de
// supabase/functions/_shared/tarifa/: el cálculo del precio (precio.ts), la
// lista (lista.ts), quién manda en los cobros (mandaEnLosCobros.ts: hasta el
// G05, GoCardless; Sumied al lado) y el próximo cobro (proximoCobro.ts).
//
// Ninguna cifra se inventa (Julio, 07/11): lo que aún no tiene de dónde salir
// lo dice en palabras («Aún sin dato: …»).

import { figura } from '../vista'
import { euros, reciboDelMes } from '../../../../../supabase/functions/_shared/tarifa/precio'
import { catalogoYAsignaciones } from '../../../../../supabase/functions/_shared/cobro/datos'
import { SE_COBRA, SIN_EMPRESA, teDeben, type CargoDeGoCardless, type FilaDeCliente, type Situacion } from '../../../../../supabase/functions/_shared/tarifa/lista'
import { cifraDeCobro, type CifraDeCobro } from '../../../../../supabase/functions/_shared/tarifa/mandaEnLosCobros'
import { proximoCobro, type ProximoCobro } from '../../../../../supabase/functions/_shared/tarifa/proximoCobro'
import type { DatosClientes, DatosFicha, Fila } from './datos'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const cent = (v: unknown): number => Math.round(Number(v ?? 0) * 100)
const mesDe = (d: unknown): string => String(d ?? '').slice(0, 7)

// El catálogo y las asignaciones salen de las filas de la base con el mismo
// código en la pantalla y en el servidor (G05: el recibo lo calcula el servidor).
export { catalogoYAsignaciones }

export interface Empresa { id: string; nombre: string }
export type Tono = 'bien' | 'aviso' | 'mal' | 'neutro'

export interface FilaDeLaLista extends FilaDeCliente {
  empresa: string | null
  figura: string
  servicios: string
  esteMes: CifraDeCobro
  estado: { texto: string; detalle: string; tono: Tono }
  gcClienteId: string | null
  telefono: string | null
  correo: string | null
  ultimoCobro: string | null
  /** Lo que se le cobra el mes que viene, línea a línea (Sumied). */
  lineas: { texto: string; importe: string }[]
  /** La situación del cliente (en su CRM), con su color: «Activo», «Moroso», «Sin clasificar»… */
  situacionTexto: string
  situacionTono: Tono
  /** El último cobro de verdad en GoCardless, con su estado. */
  ultimoCargo: { estado: string; tono: Tono; fecha: string; importeCent: number } | null
  /** Los cargos devueltos que cuentan en «Debe» (para «Cobrado por otra vía»). */
  devueltos: { id: string; fecha: string; importeCent: number }[]
  /** El aviso del panel, con su acción concreta. */
  aviso: { titulo: string; texto: string; accion: 'otra_via' | 'poner_cuota' | null; boton: string | null } | null
}

export interface Tarea { id: string; n: number; titulo: string; texto: string; boton: string; centimos: number | null; tono: Tono; filtro: 'necesitan_algo' | 'devueltos' | 'sin_mandato' | null }

export interface ModeloClientes {
  filas: FilaDeLaLista[]
  banda: ProximoCobro & { sumiedCent: number; porRevisar: number }
  cuotas: { principal: CifraDeCobro; clientes: number; altas: { n: number; cent: number }; bajas: { n: number; cent: number } }
  teDeben: { totalCent: number; clientes: number; masDe60Cent: number }
  dejasDeCobrar: { activosSinCuota: number }
  tareas: Tarea[]
}

/** El nombre del CRM conectado, para «Ver en …» y «Activa en …» (nunca «CRM» a secas). */
export const nombreDelCrmDe = (crm: string | null) => (crm === 'bitrix24' ? 'Bitrix24' : crm ? crm : 'tu CRM')

const PALABRA_SITUACION: Record<string, string> = { baja: 'De baja', solo_renta: 'Solo renta' }
export const SITUACION: Record<string, { texto: string; tono: Tono }> = {
  activo: { texto: 'Activo', tono: 'bien' }, moroso: { texto: 'Moroso', tono: 'mal' }, sin_clasificar: { texto: 'Sin clasificar', tono: 'aviso' },
  baja: { texto: 'De baja', tono: 'neutro' }, solo_renta: { texto: 'Solo renta', tono: 'neutro' },
}
/** El estado de un cobro de GoCardless, en palabras de oficina. */
export const ESTADO_DEL_COBRO: Record<string, { texto: string; tono: Tono }> = {
  paid_out: { texto: 'Cobrado', tono: 'bien' }, confirmed: { texto: 'Cobrado', tono: 'bien' }, failed: { texto: 'Devuelto', tono: 'mal' },
  charged_back: { texto: 'Retrocedido', tono: 'mal' }, cancelled: { texto: 'Cancelado', tono: 'neutro' }, pending_submission: { texto: 'En curso', tono: 'neutro' },
  submitted: { texto: 'En curso', tono: 'neutro' }, pending_customer_approval: { texto: 'Pendiente de aprobar', tono: 'neutro' }, customer_approval_denied: { texto: 'Rechazado', tono: 'mal' },
}
/** «+1 alta (109 €)», «sin altas»; «−2 bajas (121 €)», «sin bajas». */
export function altasYBajas(x: { n: number; cent: number }, que: 'alta' | 'baja'): string {
  if (x.n === 0) return que === 'alta' ? 'sin altas' : 'sin bajas'
  const signo = que === 'alta' ? '+' : '−'
  return `${signo}${x.n} ${x.n === 1 ? que : `${que}s`} (${String(Math.round(x.cent / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €)`
}
const mesSiguiente = (m: string) => { const a = Number(m.slice(0, 4)); const n = Number(m.slice(5, 7)); return n === 12 ? `${a + 1}-01` : `${a}-${String(n + 1).padStart(2, '0')}` }
const fechaCorta = (f: string) => `${Number(f.slice(8, 10))}/${f.slice(5, 7)}/${f.slice(0, 4)}`

/** El texto de «Qué le cobras»: los servicios de Sumied, con los trabajadores entre paréntesis. */
function serviciosEnTexto(lineas: ReturnType<typeof reciboDelMes>['lineas']): string {
  return lineas.map((l) => (l.trabajadores !== null ? `${l.texto.replace(/ · \d+ trabajadores?$/, '')} (${l.trabajadores})` : l.texto)).join(' · ')
}

export function modeloClientes(d: DatosClientes, empresas: readonly Empresa[], elegidas: readonly string[], hoy: string): ModeloClientes {
  const mes = hoy.slice(0, 7)
  const { catalogo, asignaciones } = catalogoYAsignaciones(d)
  const nombreEmpresa = new Map(empresas.map((e) => [e.id, e.nombre]))
  const enElegidas = (empresa: unknown) => elegidas.includes(String(empresa))

  // «Te deben», por cliente y empresa.
  const cargos: (CargoDeGoCardless & { clientes: string[] })[] = d.cargos.map((c) => ({
    id: String(c.gc_id), empresaId: String(c.empresa_id), clienteId: Array.isArray(c.clientes) && c.clientes.length === 1 ? String(c.clientes[0]) : null,
    clientes: Array.isArray(c.clientes) ? (c.clientes as string[]).map(String) : [], suscripcionId: str(c.suscripcion_gc_id), estado: String(c.estado),
    fecha: String(c.fecha), importeCent: cent(c.importe), mandatoActivo: c.mandato_activo === true, cobradoDespues: c.cobrado_despues === true,
  }))
  const otraVia = new Set(d.cargos.filter((c) => c.otra_via).map((c) => String(c.gc_id)))
  const deben = teDeben(cargos.filter((c) => enElegidas(c.empresaId)), otraVia, hoy)
  const debeDe = new Map<string, { cent: number; n: number; masAntiguo: string }>()
  for (const c of deben.cargos as typeof cargos) {
    for (const cl of c.clientes) {
      const k = `${cl}|${c.empresaId}`
      const x = debeDe.get(k) ?? { cent: 0, n: 0, masAntiguo: c.fecha }
      x.cent += c.importeCent; x.n++; if (c.fecha < x.masAntiguo) x.masAntiguo = c.fecha
      debeDe.set(k, x)
    }
  }

  const devueltosDe = new Map<string, { id: string; fecha: string; importeCent: number }[]>()
  for (const c of deben.cargos as typeof cargos) for (const cl of c.clientes) {
    const k = `${cl}|${c.empresaId}`
    devueltosDe.set(k, [...(devueltosDe.get(k) ?? []), { id: c.id, fecha: c.fecha, importeCent: c.importeCent }])
  }

  // nº 82 · Lo que GoCardless cobra EN el mes, por cliente y empresa (la anual, entera en su mes). La media
  // (gocardless_al_mes, la anual entre 12) ya no se compara con nada: solo dice si tiene cuota.
  const delMes = (d.gcDelMes ?? []).filter((x) => mesDe(x.mes) === mes)
  const gcDelMesDe = new Map(delMes.filter((x) => x.que === 'cliente')
    .map((x) => [`${String(x.cliente_id)}|${String(x.empresa_id)}`, cent(x.gocardless_del_mes)]))
  // Y por empresa, todo lo suyo del mes, también lo que aún no está unido a ningún cliente: el total de las cuotas.
  const gcDelMesEmpresa = delMes.filter((x) => x.que === 'empresa' && enElegidas(x.empresa_id)).reduce((t, x) => t + cent(x.gocardless_del_mes), 0)

  const filas: FilaDeLaLista[] = []
  let sumiedTotal = 0
  let porRevisar = 0
  for (const r of d.clientes) {
    const empresaId = str(r.empresa_id)
    if (empresaId !== null && !enElegidas(empresaId)) continue
    if (empresaId === null && elegidas.length < 2) continue // sin empresa: solo en «Las dos»
    const clienteId = String(r.cliente_id)
    const situacion = (str(r.situacion) ?? null) as Situacion
    const recibo = empresaId ? reciboDelMes(catalogo, asignaciones, clienteId, empresaId, mes) : null
    const siguiente = empresaId ? reciboDelMes(catalogo, asignaciones, clienteId, empresaId, mesSiguiente(mes)) : null
    const gcAlMes = r.gocardless_al_mes == null ? null : cent(r.gocardless_al_mes)
    const gcDelMes = empresaId ? gcDelMesDe.get(`${clienteId}|${empresaId}`) ?? null : null
    const sumied = recibo && recibo.lineas.length ? recibo.totalCent : null
    const esteMes = cifraDeCobro({ gocardlessCent: gcDelMes, sumiedCent: sumied })
    if (empresaId) sumiedTotal += sumied ?? 0
    if (esteMes.diferenciaCent !== null && esteMes.diferenciaCent !== 0) porRevisar++
    const debe = debeDe.get(`${clienteId}|${empresaId}`) ?? null
    const mandatoGc = str(r.mandato)
    const mandato = mandatoGc === 'active' ? 'firmado' : mandatoGc && /^pending|^submitted/.test(mandatoGc) ? 'por_firmar' : r.forma_de_cobro === 'gocardless' ? 'sin_mandato' : null
    const seCobra = empresaId !== null && SE_COBRA.includes(situacion)
    const sinCuota = seCobra && (gcAlMes ?? 0) === 0 && !(recibo && recibo.lineas.length)
    const crm = nombreDelCrmDe(str(r.crm))
    const estado: FilaDeLaLista['estado'] = !seCobra
      ? { texto: empresaId === null ? SIN_EMPRESA : PALABRA_SITUACION[situacion ?? ''] ?? 'Sin situación', detalle: '', tono: 'neutro' }
      : debe ? { texto: 'Devuelto', detalle: `${debe.n} ${debe.n === 1 ? 'recibo' : 'recibos'} · el más antiguo, ${fechaCorta(debe.masAntiguo)}`, tono: 'mal' }
      : sinCuota ? { texto: 'Activo sin cuota', detalle: `Activo en ${crm} · no se le cobra`, tono: 'aviso' }
      : mandato === 'por_firmar' ? { texto: 'Mandato por firmar', detalle: 'Sin mandato firmado no entra en el cobro', tono: 'neutro' }
      : str(r.ultimo_cobro_fecha) ? { texto: 'Cobrado', detalle: fechaCorta(String(r.ultimo_cobro_fecha)), tono: 'bien' }
      : { texto: 'Sin cobros', detalle: 'Ninguno en GoCardless', tono: 'neutro' }
    const servicios = recibo && recibo.lineas.length ? serviciosEnTexto(recibo.lineas)
      : str(r.servicios_gc) ?? 'Sin cuota en Sumied' // los nombres de sus suscripciones activas de GoCardless (los junta la base)
    const tel = Array.isArray(r.telefonos) ? str((r.telefonos as unknown[])[0]) : null
    const correo = Array.isArray(r.correos) ? str((r.correos as unknown[])[0]) : null
    filas.push({
      clienteId, empresaId, empresa: empresaId ? nombreEmpresa.get(empresaId) ?? null : null,
      nombre: String(r.cliente ?? ''), nif: str(r.nif), situacion, figura: figura(str(r.nif)) ?? 'Sin NIF',
      pendientes: Number(r.pendientes ?? 0) + (debe ? 1 : 0) + (sinCuota ? 1 : 0) + (mandato === 'por_firmar' ? 1 : 0),
      devuelto: !!debe, debeCent: debe?.cent ?? 0, mandato, trabajadores: Array.isArray(r.trabajadores) ? (r.trabajadores as string[]).filter(Boolean) : [],
      servicios, esteMes, estado, gcClienteId: str(r.cliente_en_gocardless), telefono: tel, correo, ultimoCobro: str(r.ultimo_cobro_fecha),
      lineas: (siguiente?.lineas ?? []).map((l) => ({ texto: l.texto, importe: l.importeCent === null ? 'Sin precio' : euros(l.importeCent) }))
        .concat(siguiente && siguiente.lineas.length ? [{ texto: 'Total', importe: euros(siguiente.totalCent) }] : []),
      situacionTexto: empresaId === null ? SIN_EMPRESA : SITUACION[situacion ?? '']?.texto ?? 'Sin situación',
      situacionTono: SITUACION[situacion ?? '']?.tono ?? 'neutro',
      // El último cobro de verdad en GoCardless (lo elige la base: el más reciente; el mismo día, el cobrado).
      ultimoCargo: (() => {
        const estado = empresaId && r.cliente_en_gocardless ? str(r.ultimo_cargo_estado) : null
        const fecha = str(r.ultimo_cargo_fecha)
        if (!estado || !fecha) return null
        const e = ESTADO_DEL_COBRO[estado] ?? { texto: estado, tono: 'neutro' as Tono }
        return { estado: e.texto, tono: e.tono, fecha, importeCent: cent(r.ultimo_cargo_importe) }
      })(),
      devueltos: devueltosDe.get(`${clienteId}|${empresaId}`) ?? [],
      aviso: debe ? { titulo: `Debe ${debe.n} ${debe.n === 1 ? 'recibo' : 'recibos'} (${euros(debe.cent)})`,
          texto: 'Devuelto en GoCardless y sin cobrar después. Si te lo pagó por transferencia o en efectivo, márcalo: solo se guarda en Sumied.', accion: 'otra_via', boton: 'Cobrado por otra vía' }
        : sinCuota ? { titulo: `Activo en ${crm}, pero no se le cobra nada`, texto: 'Ni en Sumied ni en GoCardless tiene una cuota este mes.', accion: 'poner_cuota', boton: 'Ponerle la cuota' }
        : mandato === 'por_firmar' ? { titulo: 'El mandato SEPA está sin firmar', texto: 'Sin mandato firmado no entra en el cobro de GoCardless. Se firma desde el enlace que le envía GoCardless.', accion: null, boton: null }
        : null,
    })
  }

  // Las cuotas: lo que cobra GoCardless este mes (manda hasta el G05; la base lo da sumado por empresa, nº 82) y lo que calcula Sumied, al lado.
  const gcDe = d.cuotasGc.filter((x) => enElegidas(x.empresa_id))
  const sumar = (k: string) => gcDe.reduce((s, x) => s + cent(x[k]), 0)
  const contar = (k: string) => gcDe.reduce((s, x) => s + Number(x[k] ?? 0), 0)
  const clientesConCuota = new Set(filas.filter((f) => f.empresaId && ((f.esteMes.principalCent ?? 0) > 0 || (f.esteMes.comparacionCent ?? 0) > 0)).map((f) => f.clienteId)).size
  const cuotas = {
    principal: cifraDeCobro({ gocardlessCent: gcDelMesEmpresa, sumiedCent: sumiedTotal }),
    clientes: clientesConCuota,
    altas: { n: contar('altas_n'), cent: sumar('altas_euros') },
    bajas: { n: contar('bajas_n'), cent: sumar('bajas_euros') },
  }

  const elegidasConNombre = elegidas.map((id) => ({ id, nombre: nombreEmpresa.get(id) ?? '' }))
  const banda = {
    ...proximoCobro(d.proximos.map((p) => ({ empresaId: String(p.empresa_id), fecha: str(p.fecha), importeCent: cent(p.euros), cobros: Number(p.n ?? 0) })), elegidasConNombre, hoy),
    sumiedCent: sumiedTotal, porRevisar,
  }

  // «Lo que tienes que hacer»: primero los cobros de GoCardless sin cliente (Julio, 08/11); después, por el dinero que mueve cada una.
  const qh = (tipo: string) => d.queHacer.filter((q) => q.tipo === tipo && enElegidas(q.empresa_id))
  const suma = (xs: Fila[]) => ({ n: xs.reduce((s, x) => s + Number(x.n ?? 0), 0), cent: xs.some((x) => x.euros != null) ? xs.reduce((s, x) => s + cent(x.euros), 0) : null })
  const sinCliente = suma(qh('gocardless_sin_cliente'))
  const varios = suma(qh('gocardless_varios_clientes'))
  const devueltos = suma(qh('recibos_devueltos'))
  const porFirmar = suma(qh('mandatos_por_firmar'))
  const activosSinCuota = filas.filter((f) => f.estado.texto === 'Activo sin cuota').length
  const crm = nombreDelCrmDe(str(d.clientes[0]?.crm))
  const resto: Tarea[] = ([
    { id: 'activos-sin-cuota', n: activosSinCuota, titulo: 'Activos sin cuota', texto: `Activos en ${crm} a los que no se cobra nada, ni en Sumied ni en GoCardless.`, boton: 'Revisarlos', centimos: null, tono: 'aviso', filtro: 'necesitan_algo' },
    { id: 'devueltos', n: devueltos.n, titulo: 'Recibos devueltos', texto: `${devueltos.cent !== null ? euros(devueltos.cent) : 'Lo'} devuelto este mes en GoCardless. Llama antes del próximo cobro.`, boton: 'Ver quiénes', centimos: devueltos.cent, tono: 'mal', filtro: 'devueltos' },
    { id: 'por-firmar', n: porFirmar.n, titulo: 'Mandatos por firmar', texto: `Sin mandato firmado no entran en el cobro${porFirmar.cent ? `: ${euros(porFirmar.cent)} al mes` : ''}.`, boton: 'Ver quiénes', centimos: porFirmar.cent, tono: 'neutro', filtro: 'sin_mandato' },
    { id: 'varios-clientes', n: varios.n, titulo: 'Clientes de GoCardless unidos a más de un cliente', texto: 'Un mismo cliente de GoCardless está unido a varios de Sumied: su cobro se cuenta en cada uno.', boton: 'Revisarlos', centimos: null, tono: 'aviso', filtro: null },
  ] as Tarea[]).filter((t) => t.n > 0).sort((a, b) => (b.centimos ?? 0) - (a.centimos ?? 0))
  const tareas: Tarea[] = [
    ...(sinCliente.n ? [{ id: 'sin-cliente', n: sinCliente.n, titulo: 'Cobros de GoCardless sin cliente',
      texto: `${sinCliente.n} ${sinCliente.n === 1 ? 'suscripción' : 'suscripciones'} de GoCardless${sinCliente.cent !== null ? ` (${euros(sinCliente.cent)} al mes)` : ''} que aún no ${sinCliente.n === 1 ? 'está unida' : 'están unidas'} a su cliente en Sumied.`,
      boton: 'Asignar a un cliente', centimos: sinCliente.cent, tono: 'mal' as Tono, filtro: null }] : []),
    ...resto,
  ]

  return {
    filas, banda, cuotas, tareas,
    teDeben: { totalCent: deben.totalCent, clientes: deben.clientes, masDe60Cent: deben.masDe60Cent },
    dejasDeCobrar: { activosSinCuota },
  }
}

/** Los importes de referencia de la ficha del CRM, cada uno con su etiqueta tal cual (Julio, 08/11): no se suman. */
export function referenciasDelCrm(ficha: Fila | undefined): string[] {
  const xs = Array.isArray(ficha?.cuotasReferencia) ? (ficha!.cuotasReferencia as Fila[]) : []
  return xs.filter((x) => Number(x.importeCent) > 0).map((x) => `${String(x.etiqueta ?? 'Referencia')}: ${euros(Number(x.importeCent))}`)
}

// ── La ficha completa de un cliente con una empresa ─────────────────────────

export interface LineaDeLaFicha {
  texto: string
  detalle: string
  importe: string
  trabajadores: { nombre: string; desde: string; importe: string | null; lineaId: string | null }[]
  etiquetas: string[]
}

export interface ModeloFicha {
  fila: FilaDeLaLista
  clienteDesde: string | null
  mesRecibo: string
  recibo: LineaDeLaFicha[]
  totalRecibo: string
  cobros: { fecha: string; importe: string; estado: string; tono: Tono; factura: FacturaDelCobro }[]
  mandato: { texto: string; tono: Tono } | null
  devoluciones12: number
  servicios: { texto: string; detalle: string; importe: string; lineaId: string | null; servicioId: string | null; tieneNiveles: boolean; especial: boolean }[]
  sueltos: { texto: string; importe: string }[]
  /** Lo de «Pendiente de revisar» de este cliente, vigente. */
  pendientes: { id: string; tipo: string; porque: string }[]
  /** Las suscripciones de GoCardless que no son ninguna línea en Sumied (para «Añadirla como línea» o «No la cuentes»). */
  sinLinea: { id: string; nombre: string; alMes: string }[]
}

const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesLargo = (m: string) => `${MES_LARGO[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
const MES_CORTO = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.']
const mesCorto = (m: string) => `${MES_CORTO[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const MANDATO: Record<string, { texto: string; tono: Tono }> = {
  active: { texto: 'firmado', tono: 'bien' }, pending_customer_approval: { texto: 'por firmar', tono: 'aviso' }, pending_submission: { texto: 'en curso', tono: 'neutro' },
  submitted: { texto: 'en curso', tono: 'neutro' }, cancelled: { texto: 'cancelado', tono: 'mal' }, failed: { texto: 'fallido', tono: 'mal' }, expired: { texto: 'caducado', tono: 'mal' },
}

/** nº 84 · La factura de un cobro, en la pestaña «Cobros»: su número (con enlace) o por qué no la tiene. */
export interface FacturaDelCobro { texto: string; facturaId: string | null }

const SIN_FACTURA: Record<string, string> = {
  preparado: 'Sin factura', enviado: 'Se factura al cobrarse', en_el_banco: 'Se factura al cobrarse', cobrado: 'Por facturar',
  devuelto: 'Sin factura: devuelto', retrocedido: 'Sin factura: reclamado', cancelado: 'Sin factura: cancelado',
}

export function facturaDelCobro(x: Fila | undefined): FacturaDelCobro {
  if (!x) return { texto: 'Sin factura en Sumied', facturaId: null }
  if (x.factura_id) return { texto: str(x.factura) ?? 'Factura', facturaId: String(x.factura_id) }
  return { texto: SIN_FACTURA[String(x.recibo_estado ?? '')] ?? 'Sin factura', facturaId: null }
}

/** La ficha de un cliente con una empresa: lo que se le cobra el mes que viene, sus cobros, su contacto, lo del CRM y sus servicios. Lo suyo (mandatos, cobros, suscripciones) llega en su propia llamada, al abrirla (conta_pantalla_ficha). */
export function modeloFicha(d: DatosClientes, suyo: DatosFicha, empresas: readonly Empresa[], clienteId: string, empresaId: string | null, hoy: string,
  pendientes: { id: string; tipo: string; porque: string }[]): ModeloFicha | null {
  const elegidas = empresaId ? [empresaId] : empresas.map((e) => e.id)
  const m = modeloClientes(d, empresas, elegidas, hoy)
  const fila = m.filas.find((f) => f.clienteId === clienteId && f.empresaId === empresaId) ?? m.filas.find((f) => f.clienteId === clienteId)
  if (!fila) return null
  const { catalogo, asignaciones } = catalogoYAsignaciones(d)
  const mes = hoy.slice(0, 7)
  const siguiente = (() => { const a = Number(mes.slice(0, 4)); const n = Number(mes.slice(5, 7)); return n === 12 ? `${a + 1}-01` : `${a}-${String(n + 1).padStart(2, '0')}` })()
  const e = fila.empresaId
  const suyas = e ? asignaciones.filter((a) => a.clienteId === clienteId && a.empresaId === e) : []
  const recibo = e ? reciboDelMes(catalogo, asignaciones, clienteId, e, siguiente) : null
  const nivel = (id: string) => catalogo.niveles.find((n) => n.id === id)
  const lineas: LineaDeLaFicha[] = (recibo?.lineas ?? []).map((l) => {
    const a = suyas.find((x) => x.id === l.asignacionId)
    const precioPorUno = l.trabajadores && l.importeCent !== null && l.trabajadores > 0 ? Math.round(l.importeCent / l.trabajadores) : null
    const incluye = a?.objetivo.tipo === 'nivel' ? nivel(a.objetivo.nivelId)?.incluye.join(', ') : null
    const palabra = l.dePrecio === 'sin_precio' ? 'sin precio' : l.dePrecio === 'tarifa' ? 'precio de tarifa' : l.dePrecio === 'especial' ? 'precio especial' : 'precio de este cliente'
    const cambios = l.trabajadores !== null ? ` · este mes: ${l.altasDelMes.length ? `${l.altasDelMes.length} ${l.altasDelMes.length === 1 ? 'alta' : 'altas'}` : 'ninguna alta'}, ${l.bajasDelMes.length ? `${l.bajasDelMes.length} ${l.bajasDelMes.length === 1 ? 'baja' : 'bajas'}` : 'ninguna baja'}` : ''
    return {
      texto: l.texto,
      detalle: [incluye, l.trabajadores !== null ? `${l.cuenta}${cambios}` : palabra].filter(Boolean).join(' · '),
      importe: l.importeCent === null ? 'Sin precio' : euros(l.importeCent),
      trabajadores: (a?.trabajadores ?? []).filter((t) => t.hasta === null || t.hasta >= siguiente).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'))
        .map((t) => ({ nombre: t.nombre, desde: t.desde === siguiente ? `Alta en ${mesLargo(t.desde)}` : `Desde ${mesLargo(t.desde)}`, importe: precioPorUno === null ? null : euros(precioPorUno), lineaId: t.lineaId ?? null })),
      etiquetas: [...l.altasDelMes.map((n) => `Alta en ${MES_LARGO[Number(siguiente.slice(5, 7)) - 1]} · ${n}`), ...l.bajasDelMes.map((n) => `Baja en ${MES_LARGO[Number(siguiente.slice(5, 7)) - 1]} · ${n}`)],
    }
  })
  // Los cobros de los últimos 12 meses (lo leído de GoCardless), con el estado del mandato.
  const gc = fila.gcClienteId
  const mandatos = suyo.mandatos.filter((x) => x.company_id === e && gc && x.gc_cliente_id === gc)
  const ids = new Set(mandatos.map((x) => String(x.gc_id)))
  const hace12 = `${Number(hoy.slice(0, 4)) - 1}${hoy.slice(4)}`
  const facturaDe = new Map((suyo.facturas ?? []).map((x) => [`${String(x.empresa_id)}|${String(x.cobro_gc_id)}`, x]))
  const cobros = suyo.cobros.filter((b) => b.company_id === e && ids.has(String(b.mandato_gc_id)) && String(b.fecha ?? '') >= hace12)
    .sort((a, b) => (String(a.fecha) < String(b.fecha) ? 1 : -1))
    .map((b) => { const x = ESTADO_DEL_COBRO[String(b.estado)] ?? { texto: String(b.estado), tono: 'neutro' as Tono }
      return { fecha: `${Number(String(b.fecha).slice(8, 10))} ${MES_CORTO[Number(String(b.fecha).slice(5, 7)) - 1]} ${String(b.fecha).slice(0, 4)}`, importe: euros(cent(b.importe)), estado: x.texto, tono: x.tono,
        factura: facturaDelCobro(facturaDe.get(`${String(b.company_id)}|${String(b.gc_id)}`)) } })
  const ultimoMandato = [...mandatos].sort((a, b) => (String(a.creado ?? '') < String(b.creado ?? '') ? 1 : -1))[0]
  // Lo que tiene, a la derecha: cada asignación vigente con su precio.
  // Una que aún no ha empezado (la anual de GoCardless que se cobra por primera vez en junio) no está en el recibo
  // del mes que viene: se busca en el de su primer mes, para que tenga su nombre y su precio, no «Servicio · Sin precio».
  const servicios = suyas.filter((a) => a.hasta === null || a.hasta >= mes).map((a) => {
    const l = recibo?.lineas.find((x) => x.asignacionId === a.id)
      ?? (e && mesDe(a.desde) > siguiente ? reciboDelMes(catalogo, asignaciones, clienteId, e, mesDe(a.desde)).lineas.find((x) => x.asignacionId === a.id) : undefined)
    const servicioId = a.objetivo.tipo === 'paquete' ? null : a.objetivo.servicioId.split('#')[0]
    const palabra = !l || l.dePrecio === 'sin_precio' ? 'Sin precio' : l.dePrecio === 'tarifa' ? 'Precio de tarifa' : l.dePrecio === 'especial' ? 'Precio especial' : 'Precio de este cliente'
    return {
      texto: l?.texto.replace(/ · \d+ trabajadores?$/, '') ?? catalogo.servicios.find((x) => x.id === servicioId)?.nombre ?? 'Servicio',
      detalle: `${palabra}${(l?.trabajadores !== null && l?.trabajadores !== undefined) || / al año/.test(l?.cuenta ?? '') ? ` · ${l!.cuenta}` : ''} · desde ${mesCorto(a.desde)}`,
      importe: l?.importeCent == null ? '—' : euros(l.importeCent),
      lineaId: a.objetivo.tipo === 'paquete' ? null : a.id.replace(/^linea:/, ''), servicioId,
      tieneNiveles: !!servicioId && catalogo.niveles.some((n) => n.servicioId === servicioId), especial: l?.dePrecio === 'especial',
    }
  })
  const sueltos = d.asignaciones.filter((a) => a.tipo === 'suelto' && String(a.cliente_id) === clienteId && a.empresa_id === e && mesDe(a.desde) >= mes)
    .map((a) => ({ texto: `${String(a.detalle ?? 'Trabajo suelto')} · ${mesLargo(mesDe(a.desde))}`, importe: a.importe_propio == null ? '—' : euros(cent(a.importe_propio)) }))
  const conLinea = new Set(d.asignaciones.map((a) => str(a.suscripcion_gc_id)).filter(Boolean))
  const sinLinea = suyo.suscripciones.filter((s) => s.company_id === e && gc && s.gc_cliente_id === gc && s.estado === 'active' && !conLinea.has(String(s.gc_id)))
    .map((s) => ({ id: String(s.gc_id), nombre: String(s.nombre ?? 'Suscripción'), alMes: euros(cent(s.al_mes)) }))
  const desdes = [...suyas.map((a) => a.desde), ...suyo.suscripciones.filter((s) => s.company_id === e && gc && s.gc_cliente_id === gc).map((s) => mesDe(s.inicio)).filter(Boolean)].sort()
  return {
    fila, clienteDesde: desdes[0] ? `Cobra desde ${mesLargo(desdes[0])}` : null,
    mesRecibo: mesLargo(siguiente), recibo: lineas, totalRecibo: euros(recibo?.totalCent ?? 0),
    cobros, mandato: ultimoMandato ? MANDATO[String(ultimoMandato.estado)] ?? { texto: String(ultimoMandato.estado), tono: 'neutro' } : null,
    devoluciones12: cobros.filter((c) => c.estado === 'Devuelto' || c.estado === 'Retrocedido').length,
    servicios, sueltos, pendientes, sinLinea,
  }
}
