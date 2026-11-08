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
import {
  euros, reciboDelMes, type Asignacion, type Catalogo, type Forma, type Objetivo, type Precio, type Trabajador,
} from '../../../../../supabase/functions/_shared/tarifa/precio'
import { SE_COBRA, SIN_EMPRESA, teDeben, type CargoDeGoCardless, type FilaDeCliente, type Situacion } from '../../../../../supabase/functions/_shared/tarifa/lista'
import { cifraDeCobro, type CifraDeCobro } from '../../../../../supabase/functions/_shared/tarifa/mandaEnLosCobros'
import { proximoCobro, type ProximoCobro } from '../../../../../supabase/functions/_shared/tarifa/proximoCobro'
import type { DatosClientes, Fila } from './datos'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const cent = (v: unknown): number => Math.round(Number(v ?? 0) * 100)
const mesDe = (d: unknown): string => String(d ?? '').slice(0, 7)

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
  /** La diferencia pendiente más importante, para el aviso del panel. */
  aviso: { titulo: string; texto: string; boton: string } | null
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

function formaDe(p: Fila): Forma {
  const imp = cent(p.importe)
  const tramos = Array.isArray(p.tramos) ? (p.tramos as Fila[]).map((t) => ({ desde: Number(t.desde), hasta: t.hasta == null ? null : Number(t.hasta), importeCent: cent(t.importe), porUnidad: !!t.porUnidad })) : []
  switch (p.forma) {
    case 'por_trabajador': return { tipo: 'por_trabajador', importeCent: imp }
    case 'tramos': return { tipo: 'tramos', tramos }
    case 'tramo_y_por_trabajador': return { tipo: 'tramo_y_por_trabajador', tramos }
    default: return { tipo: 'fijo', periodo: p.periodo === 'anio' ? 'anio' : p.periodo === 'vez' ? 'vez' : 'mes', importeCent: imp }
  }
}

function objetivoDe(x: Fila): Objetivo | null {
  if (x.paquete_id) return { tipo: 'paquete', paqueteId: String(x.paquete_id) }
  if (x.nivel_id) return { tipo: 'nivel', servicioId: String(x.servicio_id), nivelId: String(x.nivel_id) }
  if (x.servicio_id) return { tipo: 'servicio', servicioId: String(x.servicio_id) }
  return null
}

/**
 * El catálogo y lo que tiene cada cliente, para el cálculo. Las líneas de
 * trabajadores del mismo servicio se juntan en una asignación (sus
 * trabajadores). Una línea con su propio importe (importada así de GoCardless)
 * lleva su precio propio, solo para ella.
 */
export function catalogoYAsignaciones(d: DatosClientes): { catalogo: Catalogo; asignaciones: Asignacion[] } {
  const servicios = d.servicios.map((s) => ({ id: String(s.id), empresaId: String(s.company_id), nombre: String(s.nombre) }))
  const precios: Precio[] = d.precios.map((p) => ({ id: String(p.id), empresaId: String(p.empresa_id), objetivo: objetivoDe(p)!, clienteId: str(p.cliente_id),
    forma: formaDe(p), desde: mesDe(p.desde), hasta: p.hasta ? mesDe(p.hasta) : null })).filter((p) => p.objetivo)
  const formaDelServicio = new Map(d.servicios.map((s) => [String(s.id), String(s.forma)]))
  const asignaciones: Asignacion[] = []
  const grupos = new Map<string, Asignacion>()
  for (const a of d.asignaciones) {
    if (a.tipo !== 'cuota') continue
    const objetivo = objetivoDe(a)
    if (!objetivo) continue
    const base = { clienteId: String(a.cliente_id), empresaId: String(a.empresa_id), desde: mesDe(a.desde), hasta: a.hasta ? mesDe(a.hasta) : null,
      altaEl: str(a.alta_el), bajaEl: str(a.baja_el) }
    if (a.importe_propio != null) {
      // Su precio, solo para ella: un objetivo propio con el nombre del servicio.
      const sid = `${String(a.servicio_id)}#${String(a.id)}`
      const nombre = servicios.find((s) => s.id === String(a.servicio_id))?.nombre ?? 'Servicio'
      servicios.push({ id: sid, empresaId: base.empresaId, nombre })
      const porTrabajador = formaDelServicio.get(String(a.servicio_id)) === 'por_empleado'
      precios.push({ id: `propio:${String(a.id)}`, empresaId: base.empresaId, objetivo: { tipo: 'servicio', servicioId: sid }, clienteId: base.clienteId,
        forma: porTrabajador ? { tipo: 'por_trabajador', importeCent: cent(a.importe_propio) } : { tipo: 'fijo', periodo: a.periodo === 'anio' ? 'anio' : 'mes', importeCent: cent(a.importe_propio) },
        desde: base.desde, hasta: base.hasta })
      asignaciones.push({ id: String(a.id), ...base, objetivo: { tipo: 'servicio', servicioId: sid },
        ...(a.empleado_nombre ? { trabajadores: [{ nombre: String(a.empleado_nombre), desde: base.desde, hasta: base.hasta, altaEl: base.altaEl, bajaEl: base.bajaEl }] } : {}) })
      continue
    }
    if (a.empleado_nombre) {
      const k = `${base.clienteId}|${base.empresaId}|${JSON.stringify(objetivo)}`
      const t: Trabajador = { nombre: String(a.empleado_nombre), desde: base.desde, hasta: base.hasta, altaEl: base.altaEl, bajaEl: base.bajaEl }
      const g = grupos.get(k)
      if (g) {
        g.trabajadores!.push(t)
        if (t.desde < g.desde) g.desde = t.desde
        if (g.hasta !== null && (t.hasta === null || t.hasta > g.hasta)) g.hasta = t.hasta
      } else {
        const nueva: Asignacion = { id: String(a.id), ...base, objetivo, trabajadores: [t] }
        grupos.set(k, nueva)
        asignaciones.push(nueva)
      }
      continue
    }
    asignaciones.push({ id: String(a.id), ...base, objetivo })
  }
  const ajustes = d.ajustes[0]
  return {
    catalogo: {
      servicios,
      niveles: d.niveles.map((n) => ({ id: String(n.id), servicioId: String(n.servicio_id), nombre: String(n.nombre), orden: Number(n.orden ?? 1), incluye: (n.incluye as string[]) ?? [], masElegido: !!n.mas_elegido })),
      paquetes: d.paquetes.map((p) => ({ id: String(p.id), empresaId: String(p.company_id), nombre: String(p.nombre), descripcion: str(p.descripcion),
        excesoPorTrabajadorCent: p.exceso_por_trabajador == null ? null : cent(p.exceso_por_trabajador),
        lineas: d.lineasDePaquete.filter((l) => l.paquete_id === p.id).map((l) => ({
          objetivo: (l.nivel_id ? { tipo: 'nivel', servicioId: String(l.servicio_id), nivelId: String(l.nivel_id) } : { tipo: 'servicio', servicioId: String(l.servicio_id) }) as Extract<Objetivo, { tipo: 'servicio' | 'nivel' }>,
          limiteTrabajadores: l.limite_trabajadores == null ? null : Number(l.limite_trabajadores) })) })),
      precios,
      ajustes: { mitadDeMes: ajustes?.mitad_de_mes === 'proporcional' ? 'proporcional' : 'mes_entero' },
    },
    asignaciones,
  }
}

const PALABRA_SITUACION: Record<string, string> = { baja: 'De baja', solo_renta: 'Solo renta' }
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
  const subs = d.suscripciones.filter((s) => s.estado === 'active')
  const fichaDe = new Map(d.fichas.map((f) => [String(f.party_id), f]))

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

  const filas: FilaDeLaLista[] = []
  let sumiedTotal = 0
  let gcTotal = 0
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
    const sumied = recibo && recibo.lineas.length ? recibo.totalCent : null
    const esteMes = cifraDeCobro({ gocardlessCent: gcAlMes, sumiedCent: sumied })
    if (empresaId) { sumiedTotal += sumied ?? 0; gcTotal += gcAlMes ?? 0 }
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
      : subs.filter((s) => s.company_id === empresaId && s.gc_cliente_id === r.cliente_en_gocardless).map((s) => String(s.nombre)).join(' · ') || 'Sin cuota en Sumied'
    const f = fichaDe.get(clienteId)?.ficha as Fila | undefined
    const tel = Array.isArray(f?.telefonos) ? str((f!.telefonos as unknown[])[0]) : null
    const correo = Array.isArray(f?.correos) ? str((f!.correos as unknown[])[0]) : null
    filas.push({
      clienteId, empresaId, empresa: empresaId ? nombreEmpresa.get(empresaId) ?? null : null,
      nombre: String(r.cliente ?? ''), nif: str(r.nif), situacion, figura: figura(str(r.nif)) ?? 'Sin NIF',
      pendientes: Number(r.pendientes ?? 0) + (debe ? 1 : 0) + (sinCuota ? 1 : 0) + (mandato === 'por_firmar' ? 1 : 0),
      devuelto: !!debe, debeCent: debe?.cent ?? 0, mandato, trabajadores: Array.isArray(r.trabajadores) ? (r.trabajadores as string[]).filter(Boolean) : [],
      servicios, esteMes, estado, gcClienteId: str(r.cliente_en_gocardless), telefono: tel, correo, ultimoCobro: str(r.ultimo_cobro_fecha),
      lineas: (siguiente?.lineas ?? []).map((l) => ({ texto: l.texto, importe: l.importeCent === null ? 'Sin precio' : euros(l.importeCent) }))
        .concat(siguiente && siguiente.lineas.length ? [{ texto: 'Total', importe: euros(siguiente.totalCent) }] : []),
      aviso: debe ? { titulo: `Debe ${debe.n} ${debe.n === 1 ? 'recibo' : 'recibos'} (${euros(debe.cent)})`, texto: 'Devuelto en GoCardless y sin cobrar después. Lo cobrado por otra vía no se ve hasta que lo marques en su ficha.', boton: 'Abrir la ficha' }
        : sinCuota ? { titulo: `Activo en ${crm}, pero no se le cobra nada`, texto: 'Ni en Sumied ni en GoCardless tiene una cuota este mes.', boton: 'Ponerle la cuota' }
        : mandato === 'por_firmar' ? { titulo: 'El mandato SEPA está sin firmar', texto: 'Sin mandato firmado no entra en el cobro de GoCardless.', boton: 'Abrir la ficha' }
        : null,
    })
  }

  // Las cuotas: lo que cobra GoCardless (manda hasta el G05) y lo que calcula Sumied, al lado.
  const subsDe = subs.filter((s) => enElegidas(s.company_id))
  const altas = subsDe.filter((s) => mesDe(s.inicio) === mes)
  const bajasSubs = d.suscripciones.filter((s) => enElegidas(s.company_id) && s.estado !== 'active' && mesDe(s.fin) === mes)
  const clientesConCuota = new Set(filas.filter((f) => f.empresaId && ((f.esteMes.principalCent ?? 0) > 0 || (f.esteMes.comparacionCent ?? 0) > 0)).map((f) => f.clienteId)).size
  const cuotas = {
    principal: cifraDeCobro({ gocardlessCent: subsDe.reduce((s, x) => s + cent(x.al_mes), 0), sumiedCent: sumiedTotal }),
    clientes: clientesConCuota,
    altas: { n: altas.length, cent: altas.reduce((s, x) => s + cent(x.al_mes), 0) },
    bajas: { n: bajasSubs.length, cent: bajasSubs.reduce((s, x) => s + cent(x.al_mes), 0) },
  }
  void gcTotal

  const elegidasConNombre = elegidas.map((id) => ({ id, nombre: nombreEmpresa.get(id) ?? '' }))
  const banda = {
    ...proximoCobro(subs.map((s) => ({ empresaId: String(s.company_id), fecha: str(s.proximo_cobro_fecha), importeCent: cent(s.proximo_cobro_importe) })), elegidasConNombre, hoy),
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
      texto: `${sinCliente.n} ${sinCliente.n === 1 ? 'suscripción cobra' : 'suscripciones cobran'}${sinCliente.cent !== null ? ` ${euros(sinCliente.cent)} al mes` : ''} a alguien que no es ningún cliente de Sumied.`,
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
