// src/modules/conta/services/propuestasLibroService.ts
//
// C04 · Los asientos que se hacen solos, de verdad: lee lo que Folvy ya sabe
// (pedidos del día, facturas aprobadas, liquidaciones, nóminas), lo pasa por
// el núcleo puro (lib/asientosPropuestos.ts) y deja cada propuesta en el libro
// como «propuesto» con journal_entry_proponer (una vez por documento; lo
// descartado no vuelve). Nada se valida aquí.
//
// Todo filtrado por cuenta y empresa (regla 9). Desde el primer día abierto
// (después de lo traído y de los meses cerrados): lo de antes es del programa
// anterior o ya está cerrado.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import {
  ventasDelDia, unidadesDelDia, type UnidadVentas, noConfirmadoPagado, liquidacionPlataforma, facturaProveedor, deLaFacturaDeLote, finDeMesCompras, liquidacionMensual, nomina, liquidacionSocio, aplicarAprendizaje,
  type PedidoDia, type DevolucionDia, type CargoPlataforma, type Correccion, type SerieTesoreria,
} from '@/modules/conta/lib/asientosPropuestos'
import { diaAbierto, peor, type CalendarioEmpresa, type LineaAsiento, type Propuesta } from '@/modules/conta/lib/libro'
import { tandaDeDias } from '@/modules/conta/lib/proponer'
import { claseIva, nombrePais, tipoDeLaClase, type ClaseIva, type FichaIva } from '@/modules/conta/lib/ivaProveedor'
import { ORIGEN_GLOVO } from '@/modules/conta/lib/liquidaciones'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}

/**
 * S01 (inventario §11): de estos orígenes, los que ya tienen asiento VIVO en la
 * empresa (propuesto, borrador o validado), por journal_entry.source_type +
 * source_id —el enlace que escribe la base, con su índice único—. Sustituye a
 * `.is('journal_entry_id', null)`, que no filtraba nada: esa columna no la
 * escribe nadie y se quitará en otra tanda.
 */
async function conAsientoVivo(companyId: string, tipo: 'supplier_invoice' | 'channel_settlement' | 'licensed_settlement', ids: readonly string[]): Promise<Set<string>> {
  const vivos = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const trozo = ids.slice(i, i + 100)
    const filas = await leer(tabla('journal_entry').select('source_id').eq('company_id', companyId).eq('source_type', tipo)
      .in('source_id', trozo).in('status', ['propuesto', 'borrador', 'validado']), 'los asientos que ya hay')
    for (const f of filas) vivos.add(String(f.source_id))
  }
  return vivos
}

/** Quita los que ya tienen asiento vivo y los cuenta como «ya estaban», que es lo que diría la base al proponerlos. */
async function sinAsientoVivo(companyId: string, tipo: Parameters<typeof conAsientoVivo>[1], filas: Fila[], r: ResultadoProponer): Promise<Fila[]> {
  const vivos = await conAsientoVivo(companyId, tipo, filas.map((f) => String(f.id)))
  r.yaEstaban += vivos.size
  return filas.filter((f) => !vivos.has(String(f.id)))
}

/** Lo que hace falta para poner cuentas a una propuesta. */
export interface ContextoLibro {
  calendario: CalendarioEmpresa
  /** Hoja del plan (template_code) → cuenta de apunte de serie. */
  hoja: (template: string) => string | null
  enlace: (entity: string, entityId: string, role: string) => string | null
  tipos: { id: string; code: string; rate: number }[]
  tipoVentas: { id: string; porcentaje: number } | null
  canales: Map<string, { nombre: string; partyId: string | null; supplierId: string | null }>
  marcas: Map<string, { nombre: string; propia: boolean }>
  locales: Map<string, string>
  bancoDeLocal: (localId: string | null) => string | null
  correcciones: Correccion[]
  validarSegurosDeVentas: boolean
  /**
   * D01 · «Apuntar solo lo seguro» (company_purchase_setting.post_safe_invoices):
   * Folvy valida por sí mismo el asiento de una factura aprobada cuya lectura
   * llegó «seguro» y cuya propuesta es segura y sin avisos. Lo demás espera a
   * una persona. No aprueba facturas en Compras (eso aplica costes).
   */
  apuntarSoloLoSeguro?: boolean
  /** D01: las facturas cuya lectura llegó «seguro» (supplier_invoice.reading_confidence). */
  lecturasSeguras?: Set<string>
  /** B01 (P3): la serie de tesorería de la empresa (bank_settings; 3 si no hay ajuste). */
  serieTesoreria: SerieTesoreria
  /** C04b R5: la regla de ventas por plataforma de la empresa (conta_ventas_canal). Null = la regla de antes, un asiento por día y local. */
  ventasPorPlataforma: { porMarca: Set<string>; ventasPorMarca: Record<string, string>; devolucionesPorMarca: Record<string, string>
    /** C06b (16/10): la subcuenta de promociones y la de envíos cobrados de cada canal (conta_ventas_canal_cuenta). */
    promocionesPorCanal: Record<string, string>; enviosPorCanal: Record<string, string> } | null
}

export async function cargarContexto(accountId: string, companyId: string): Promise<ContextoLibro> {
  const [cuentas, enlaces, tipos, perfil, ejercicios, cerrados, canales, roles, marcas, locales, bancos, correcciones, reglaCanal, reglaMarca, ajustesBanco] = await Promise.all([
    leer(tabla('company_account').select('id, code, template_code, kind, status').eq('account_id', accountId).eq('company_id', companyId), 'las cuentas'),
    leer(tabla('company_account_link').select('company_account_id, entity, entity_id, role').eq('account_id', accountId).eq('company_id', companyId), 'los enlaces'),
    leer(tabla('tax_rate').select('id, code, rate, tax_system, treatment, valid_to').or(`is_system.eq.true,account_id.eq.${accountId}`), 'los tipos de IVA'),
    leer(tabla('company_tax_profile').select('sales_tax_rate_code, journal_autovalidate_sales_day').eq('account_id', accountId).eq('company_id', companyId), 'el perfil fiscal'),
    leer(tabla('fiscal_year').select('code, starts_on, ends_on, status, imported_until').eq('account_id', accountId).eq('company_id', companyId), 'los ejercicios'),
    leer(tabla('fiscal_period_lock').select('month').eq('account_id', accountId).eq('company_id', companyId).is('reopened_at', null), 'los meses cerrados'),
    leer(tabla('sales_channel').select('id, name').eq('account_id', accountId), 'los canales'),
    leer(tabla('party_role').select('party_id, role, channel_id, supplier_id').eq('account_id', accountId), 'lo que es cada contacto'),
    leer(tabla('brand').select('id, name, ownership_type').eq('account_id', accountId), 'las marcas'),
    leer(tabla('locations').select('id, name').eq('account_id', accountId), 'los locales'),
    leer(tabla('treasury_account').select('id, location_id, kind, is_active').eq('account_id', accountId).eq('company_id', companyId), 'los bancos'),
    leer(tabla('journal_correction').select('origin_key, proposed_code, chosen_code, created_by_name, created_at').eq('account_id', accountId).eq('company_id', companyId), 'lo aprendido'),
    // C04b R5 (20261020T0100): la regla de ventas por plataforma.
    leer(tabla('conta_ventas_canal').select('channel_id, por_marca').eq('account_id', accountId).eq('company_id', companyId), 'la regla de ventas por canal'),
    leer(tabla('conta_ventas_marca').select('brand_id, papel, company_account_id').eq('account_id', accountId).eq('company_id', companyId), 'las subcuentas de cada marca'),
    leer(tabla('bank_settings').select('treasury_series').eq('account_id', accountId).eq('company_id', companyId), 'los ajustes del banco'),
  ])
  // D01: el ajuste de compras de la empresa (0200). Sin fila —o sin la tabla, si
  // el front llegara antes que la base—, no apunta nada solo: lo prudente. Es el
  // único ajuste que se lee así: por él no se deja de cargar el Libro entero.
  const compras = await leer(tabla('company_purchase_setting').select('post_safe_invoices').eq('company_id', companyId), 'los ajustes de compras').catch(() => [] as Fila[])
  // C06b (16/10): las subcuentas de promociones y envíos de cada canal (0100).
  // Sin la tabla —el front antes que la base—, como hasta hoy: sin ellas.
  const reglaCuenta = await leer(tabla('conta_ventas_canal_cuenta').select('channel_id, papel, company_account_id').eq('account_id', accountId).eq('company_id', companyId), 'las subcuentas de promociones y envíos').catch(() => [] as Fila[])
  const porId = new Map(cuentas.map((c) => [String(c.id), c]))
  const hojas = new Map<string, string>()
  for (const c of cuentas) if (c.kind === 'template' && c.status !== 'cerrada' && !hojas.has(String(c.template_code))) hojas.set(String(c.template_code), String(c.code))
  const mapaEnlaces = new Map<string, string>()
  for (const l of enlaces) {
    const c = porId.get(String(l.company_account_id))
    if (c) mapaEnlaces.set(`${l.entity}:${l.entity_id}:${l.role}`, String(c.code))
  }
  const enlace = (e: string, id: string, r: string) => mapaEnlaces.get(`${e}:${id}:${r}`) ?? null
  const iva = tipos.filter((t) => t.tax_system === 'iva' && !t.valid_to).map((t) => ({ id: String(t.id), code: String(t.code), rate: n(t.rate) }))
  const codigoVentas = s(perfil[0]?.sales_tax_rate_code)
  const tv = codigoVentas ? iva.find((t) => t.code === codigoVentas) ?? null : null
  const proveedorDe = new Map<string, string>()
  for (const r of roles) if (r.role === 'supplier' && r.supplier_id) proveedorDe.set(String(r.party_id), String(r.supplier_id))
  const canalMap = new Map<string, { nombre: string; partyId: string | null; supplierId: string | null }>()
  for (const c of canales) {
    const r = roles.find((x) => x.role === 'platform' && String(x.channel_id) === String(c.id))
    const partyId = r ? String(r.party_id) : null
    canalMap.set(String(c.id), { nombre: String(c.name), partyId, supplierId: partyId ? proveedorDe.get(partyId) ?? null : null })
  }
  const bancoDeLocal = (localId: string | null) => {
    const b = bancos.find((x) => x.is_active !== false && x.kind === 'bank' && s(x.location_id) === localId)
      ?? bancos.find((x) => x.is_active !== false && x.kind === 'bank' && !x.location_id)
    return b ? enlace('bank_account', String(b.id), 'principal') : null
  }
  return {
    calendario: {
      ejercicios: ejercicios.map((e) => ({ code: String(e.code), inicio: String(e.starts_on), fin: String(e.ends_on), abierto: e.status === 'open', traidoHasta: s(e.imported_until) })),
      mesesCerrados: cerrados.map((m) => String(m.month).slice(0, 7)),
    },
    hoja: (t) => hojas.get(t) ?? null,
    enlace,
    tipos: iva,
    tipoVentas: tv ? { id: tv.id, porcentaje: tv.rate } : null,
    canales: canalMap,
    marcas: new Map(marcas.map((m) => [String(m.id), { nombre: String(m.name), propia: m.ownership_type !== 'licensed' }])),
    locales: new Map(locales.map((l) => [String(l.id), String(l.name)])),
    bancoDeLocal,
    correcciones: correcciones.map((c) => ({ clave: String(c.origin_key), propuesta: String(c.proposed_code), elegida: String(c.chosen_code), quien: s(c.created_by_name), cuando: String(c.created_at) })),
    validarSegurosDeVentas: perfil[0]?.journal_autovalidate_sales_day === true,
    apuntarSoloLoSeguro: compras[0]?.post_safe_invoices === true,
    serieTesoreria: Number(ajustesBanco[0]?.treasury_series) === 4 ? 4 : 3,
    ventasPorPlataforma: reglaCanal.length === 0 ? null : {
      porMarca: new Set(reglaCanal.filter((r) => r.por_marca === true).map((r) => String(r.channel_id))),
      ventasPorMarca: Object.fromEntries(reglaMarca.filter((m) => m.papel === 'ventas' && porId.get(String(m.company_account_id))?.status !== 'cerrada')
        .flatMap((m) => { const c = porId.get(String(m.company_account_id)); return c ? [[String(m.brand_id), String(c.code)]] : [] })),
      devolucionesPorMarca: Object.fromEntries(reglaMarca.filter((m) => m.papel === 'devoluciones' && porId.get(String(m.company_account_id))?.status !== 'cerrada')
        .flatMap((m) => { const c = porId.get(String(m.company_account_id)); return c ? [[String(m.brand_id), String(c.code)]] : [] })),
      promocionesPorCanal: Object.fromEntries(reglaCuenta.filter((m) => m.papel === 'promociones' && porId.get(String(m.company_account_id))?.status !== 'cerrada')
        .flatMap((m) => { const c = porId.get(String(m.company_account_id)); return c ? [[String(m.channel_id), String(c.code)]] : [] })),
      enviosPorCanal: Object.fromEntries(reglaCuenta.filter((m) => m.papel === 'envios' && porId.get(String(m.company_account_id))?.status !== 'cerrada')
        .flatMap((m) => { const c = porId.get(String(m.company_account_id)); return c ? [[String(m.channel_id), String(c.code)]] : [] })),
    },
  }
}

/** La propuesta, tal como la espera journal_entry_proponer. */
function aJson(p: Propuesta) {
  return {
    entrada: {
      series: p.serie, fecha: p.fecha, concepto: p.concepto, source_type: p.origen.tipo, source_id: p.origen.id,
      confianza: p.confianza, porque: p.porque, razones: [...p.razones, ...p.avisos.map((a) => ({ decision: 'Mira esto', porque: a }))],
      party_id: p.terceroId ?? null, documento: p.documento ?? null,
    },
    lineas: p.lineas.map((l: LineaAsiento) => ({
      cuenta: l.cuenta, debe: l.debe, haber: l.haber, concepto: l.concepto ?? null, local_id: l.localId, comun: !!l.comun,
      marca_id: l.marcaId ?? null, tercero_id: l.terceroId ?? null, documento: l.documento ?? null,
      iva: l.iva ? { tipo_id: l.iva.tipoId, base: l.iva.base, libro: l.iva.libro, deducible: l.iva.deducible ?? null, facturas: l.iva.facturas ?? 1 } : null,
      retencion: l.retencion ? { tipo_id: l.retencion.tipoId, base: l.retencion.base, modelo: l.retencion.modelo } : null,
    })),
  }
}

/** Un pedido del que habla un «no lo he propuesto», para «Ver los N pedidos». */
export interface PedidoParaVer { codigo: string | null; canal: string; marca: string; total: number; estado: string }

export interface ResultadoProponer {
  propuestas: number
  yaEstaban: number
  descartadas: number
  /** Lo que no se ha propuesto, con por qué (se enseña: regla 8, nada callado). */
  sinPropuesta: { que: string; porque: string; pedidos?: PedidoParaVer[] }[]
  validadasSolas: number
  /** El mes de ventas repasado esta vez (del más reciente hacia atrás). */
  mesVentas: string | null
  /** Días con ventas sin asiento que quedan para la siguiente vez. */
  quedanDias: number
}

async function proponer(companyId: string, p: Propuesta, resumen: Fila | null, r: ResultadoProponer, ctx: ContextoLibro, quien: string | null) {
  const j = aJson(p)
  const res = (await rpc('journal_entry_proponer', { p_company: companyId, p_entry: j.entrada, p_lines: j.lineas, p_summary: resumen, p_quien_nombre: quien })) as Fila
  if (res.descartada) { r.descartadas += 1; return }
  if (res.existente) { r.yaEstaban += 1; return }
  r.propuestas += 1
  if (ctx.validarSegurosDeVentas && p.origen.tipo === 'sales_day' && p.confianza === 'seguro' && p.avisos.length === 0) {
    await rpc('journal_entry_validar', { p_entry: res.id, p_quien_nombre: 'Folvy (validación automática de ventas)' })
    r.validadasSolas += 1
  }
  // D01 · «Apuntar solo lo seguro»: la factura leída «seguro», con su propuesta segura y sin avisos.
  if (ctx.apuntarSoloLoSeguro && p.origen.tipo === 'supplier_invoice' && p.origen.id && ctx.lecturasSeguras?.has(p.origen.id) && p.confianza === 'seguro' && p.avisos.length === 0) {
    await rpc('journal_entry_validar', { p_entry: res.id, p_quien_nombre: 'Folvy (apunta solo lo seguro)' })
    r.validadasSolas += 1
  }
}

const huella = async (texto: string): Promise<string> => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Propone lo que falte entre dos fechas: ventas del día, facturas, liquidaciones y nóminas. */
export async function proponerPendientes(accountId: string, companyId: string, desde: string, hasta: string, quien: string | null): Promise<ResultadoProponer> {
  const ctx = await cargarContexto(accountId, companyId)
  const r: ResultadoProponer = { propuestas: 0, yaEstaban: 0, descartadas: 0, sinPropuesta: [], validadasSolas: 0, mesVentas: null, quedanDias: 0 }
  const abierto = (f: string) => diaAbierto(f, ctx.calendario)

  // ── Ventas del día (reglas 6 y 13) ──
  // Respuesta 4: del mes más reciente hacia atrás, un mes cada vez, y se dice
  // cuántos días quedan (lo de antes del corte ni entra: desde/hasta ya lo dejan fuera).
  const todos = ((await rpc('conta_dias_por_asentar', { p_company: companyId, p_desde: desde, p_hasta: hasta })) as Fila[] | null ?? [])
    .filter((d) => abierto(String(d.dia))).map((d) => ({ location_id: String(d.location_id), dia: String(d.dia) }))
  const tanda = tandaDeDias(todos)
  r.mesVentas = tanda.mes
  r.quedanDias = tanda.quedanDias
  const dias = tanda.ahora
  const ventas = ctx.hoja('700'); const devoluciones = ctx.hoja('708') ?? ventas
  const iva477 = ctx.tipoVentas ? ctx.enlace('tax_rate', ctx.tipoVentas.id, 'repercutido') : null
  for (const d of dias) {
    const localId = d.location_id; const dia = d.dia
    const que = `Ventas del ${dia.split('-').reverse().join('/')} · ${ctx.locales.get(localId) ?? 'local'}`
    if (!abierto(dia)) continue
    if (!ctx.tipoVentas || !iva477 || !ventas) { r.sinPropuesta.push({ que, porque: 'Falta el IVA de tus ventas (Tu empresa) o su 477, o la 700 en el plan.' }); continue }
    const [pedidos, devs] = await Promise.all([
      rpc('conta_pedidos_del_dia', { p_company: companyId, p_location: localId, p_dia: dia }) as Promise<Fila[] | null>,
      rpc('conta_devoluciones_del_dia', { p_company: companyId, p_location: localId, p_dia: dia }) as Promise<Fila[] | null>,
    ])
    const cobroPorCanal: Record<string, string> = {}
    for (const [id, c] of ctx.canales) { const cta = c.partyId ? ctx.enlace('customer', c.partyId, 'principal') : null; if (cta) cobroPorCanal[id] = cta }
    // C06b (16/10): el descuento, el envío y qué se hace con él (conta_cargos_de_pedidos).
    // Sin la función —el front antes que la base—, como hasta hoy.
    const cerrados = (pedidos ?? []).filter((p) => p.estado === 'closed').map((p) => String(p.id))
    const cargos = new Map<string, Fila>()
    if (cerrados.length && ctx.ventasPorPlataforma) {
      const cs = await (rpc('conta_cargos_de_pedidos', { p_account: accountId, p_sales: cerrados }) as Promise<Fila[] | null>).catch(() => null)
      for (const c of cs ?? []) cargos.set(String(c.id), c)
    }
    const losPedidos = (pedidos ?? []).map((p): PedidoDia => ({
      id: String(p.id), codigo: s(p.codigo), canalId: s(p.canal_id), marcaId: s(p.marca_id), marcaPropia: p.propia !== false,
      estado: (String(p.estado) as PedidoDia['estado']), total: n(p.total), base: p.base === null ? null : n(p.base), cuota: p.cuota === null ? null : n(p.cuota),
      tiposEnLineas: Array.isArray(p.tipos) ? (p.tipos as unknown[]).map(Number) : [],
      ...(cargos.has(String(p.id)) ? {
        descuento: n(cargos.get(String(p.id))!.descuento), envio: n(cargos.get(String(p.id))!.envio),
        claseEnvio: String(cargos.get(String(p.id))!.clase) as PedidoDia['claseEnvio'], porQueEnvio: s(cargos.get(String(p.id))!.por_que),
      } : {}),
    }))
    const lasDevoluciones = (devs ?? []).map((x): DevolucionDia => ({
      pedidoId: s(x.pedido_id), codigo: s(x.codigo), canalId: s(x.canal_id), marcaId: s(x.marca_id), marcaPropia: x.propia !== false, importe: n(x.importe),
      // Hasta F01 Folvy no emite facturas de plataforma: ninguna devolución pide rectificativa todavía.
      conFactura: false,
    }))
    const nombreCanal = (id: string | null) => (id ? ctx.canales.get(id)?.nombre ?? 'un canal' : 'sin canal')
    const regla = ctx.ventasPorPlataforma
    // C04b R5: con la regla por plataforma, un asiento por unidad (Uber y Just
    // Eat, uno; Glovo, uno por marca), igual que el cierre del día. Sin ella,
    // la regla de antes: el día y el local enteros.
    const unidades: (UnidadVentas | undefined)[] = regla ? unidadesDelDia(losPedidos, lasDevoluciones, (c) => !!c && regla.porMarca.has(c)) : [undefined]
    for (const unidad of unidades) {
      const queUnidad = unidad ? `${que} · ${nombreCanal(unidad.canalId)}${unidad.marcaId ? ` · ${ctx.marcas.get(unidad.marcaId)?.nombre ?? 'una marca'}` : ''}` : que
      const res = ventasDelDia({
        fecha: dia, localId, tipo: ctx.tipoVentas, porMarca: true, nombreLocal: ctx.locales.get(localId) ?? 'local',
        nombreCanal, nombreMarca: (id) => (id ? ctx.marcas.get(id)?.nombre ?? 'una marca' : 'sin marca'), unidad,
        cuentas: { cobroPorCanal, ventas, devoluciones: devoluciones!, ivaRepercutido: iva477, ventasPorMarca: regla?.ventasPorMarca, devolucionesPorMarca: regla?.devolucionesPorMarca,
          promocionesPorCanal: regla?.promocionesPorCanal, enviosPorCanal: regla?.enviosPorCanal },
        pedidos: losPedidos, devoluciones: lasDevoluciones,
      })
      if (!res.propuesta) {
        r.sinPropuesta.push({ que: queUnidad, porque: res.sinPropuesta ?? 'Sin propuesta.', pedidos: res.pedidosDelPorque?.map((p) => ({
          codigo: p.codigo, canal: p.canalId ? ctx.canales.get(p.canalId)?.nombre ?? 'un canal' : 'sin canal',
          marca: p.marcaId ? ctx.marcas.get(p.marcaId)?.nombre ?? 'una marca' : 'sin marca', total: p.total, estado: p.estado,
        })) })
        continue
      }
      const detalle = await huella(res.resumen.pedidoIds.join('|') + '#' + String(Math.round(res.resumen.total * 100)))
      await proponer(companyId, res.propuesta, {
        location_id: localId, sales_day: dia, tickets_count: res.resumen.tickets, total: res.resumen.total,
        ...(unidad ? { unit_key: unidad.clave, channel_id: unidad.canalId, brand_id: unidad.marcaId } : {}),
        by_rate: [{ tax_rate_id: ctx.tipoVentas.id, rate: ctx.tipoVentas.porcentaje, base: res.resumen.base, cuota: res.resumen.cuota, calculated: res.resumen.baseCalculada }],
        by_channel: res.resumen.porCanal.map((c) => ({ channel_id: c.canalId, total: c.total })),
        by_brand: res.resumen.porMarca.map((m) => ({ brand_id: m.marcaId, base: m.base })),
        detail_hash: detalle, sale_ids: res.resumen.pedidoIds, base_calculated: res.resumen.baseCalculada,
      }, r, ctx, quien)
    }
  }

  // ── Cierre del día · la liquidación manda (T4) ──
  // Un pedido cerrado como no confirmado que una liquidación paga: venta de su
  // día, aparte (sales_adjustment, origen = la venta). Sin rango: el pago llega
  // después; solo lo que caiga en un día abierto.
  if (ctx.tipoVentas && iva477 && ventas) {
    const cobroPorCanal: Record<string, string> = {}
    for (const [id, c] of ctx.canales) { const cta = c.partyId ? ctx.enlace('customer', c.partyId, 'principal') : null; if (cta) cobroPorCanal[id] = cta }
    const pagados = ((await rpc('conta_no_confirmados_pagados', { p_company: companyId })) as Fila[] | null) ?? []
    for (const x of pagados) {
      const dia = String(x.dia); const localId = s(x.location_id)
      const que = `Pedido ${s(x.codigo) ?? 'sin código'} del ${dia.split('-').reverse().join('/')}, pagado después`
      if (!abierto(dia) || !localId) continue
      // Base, cuota y tipos del pedido, como los da el día.
      const delDia = ((await rpc('conta_pedidos_del_dia', { p_company: companyId, p_location: localId, p_dia: dia })) as Fila[] | null) ?? []
      const p = delDia.find((f) => String(f.id) === String(x.sale_id))
      if (!p) { r.sinPropuesta.push({ que, porque: 'No encuentro el pedido en su día: puede que ya no esté activo.' }); continue }
      const res = noConfirmadoPagado({
        pedido: {
          id: String(p.id), codigo: s(p.codigo), canalId: s(p.canal_id), marcaId: s(p.marca_id), marcaPropia: p.propia !== false,
          estado: 'unconfirmed', total: n(p.total), base: p.base === null ? null : n(p.base), cuota: p.cuota === null ? null : n(p.cuota),
          tiposEnLineas: Array.isArray(p.tipos) ? (p.tipos as unknown[]).map(Number) : [],
        },
        dia, liquidacion: { ref: s(x.settlement_ref), fecha: s(x.settlement_date) }, diaValidado: x.dia_validado === true,
      }, {
        localId, tipo: ctx.tipoVentas, porMarca: true, nombreLocal: ctx.locales.get(localId) ?? 'local',
        nombreCanal: (id) => (id ? ctx.canales.get(id)?.nombre ?? 'un canal' : 'sin canal'),
        cuentas: { cobroPorCanal, ventas, devoluciones: devoluciones!, ivaRepercutido: iva477 },
      })
      if (!res.propuesta) { r.sinPropuesta.push({ que, porque: res.sinPropuesta ?? 'Sin propuesta.' }); continue }
      await proponer(companyId, res.propuesta, null, r, ctx, quien)
    }
  }

  const { socios, ret, partyPorProveedor } = await facturasDeProveedor(accountId, companyId, desde, hasta, ctx, r, quien, abierto)

  // ── Compras (10/10), §2.5: la liquidación mensual, desde sus documentos ──
  // Las confirmadas de esta empresa. Sus asientos van con la fecha de sus
  // facturas (días después del mes): se leen las de los dos meses de antes.
  {
    const desdeLiq = new Date(`${desde.slice(0, 7)}-01T00:00:00Z`); desdeLiq.setUTCMonth(desdeLiq.getUTCMonth() - 2)
    const liqs = await leer(tabla('licensed_settlement').select('id, party_id, supplier_id, location_id, settlement_ref, received_invoice_id, detail, party(name), supplier(name, expense_category_id)')
      .eq('account_id', accountId).eq('company_id', companyId).eq('formula', 'documentos').eq('status', 'confirmada')
      .gte('period_to', desdeLiq.toISOString().slice(0, 10)).lte('period_from', hasta), 'las liquidaciones mensuales')
    const tipoIva = (pct: number) => ctx.tipos.find((x) => x.rate === pct && x.code.startsWith('iva_'))
    for (const l of liqs) {
      const d = (l.detail ?? {}) as Fila
      const em = (d.emitida ?? {}) as Fila; const rc = (d.recibida ?? {}) as Fila
      const party = String(l.party_id); const sup = String(l.supplier_id); const prov = (l.supplier ?? {}) as Fila
      const socio = s(((l.party ?? {}) as Fila).name) ?? s(prov.name) ?? 'el socio'
      const que = `Liquidación de ${socio} · ${s(l.settlement_ref) ?? ''} · ${ctx.locales.get(String(l.location_id)) ?? 'local'}`
      const lineas = (x: Fila) => ((x.lineas ?? []) as Fila[]).map((y) => ({ concepto: String(y.concepto), base: n(y.base), tipo: n(y.tipo) }))
      const res = liquidacionMensual({
        id: String(l.id), facturaRecibidaId: String(l.received_invoice_id), socio, terceroId: party, localId: s(l.location_id),
        emitida: { numero: String(em.numero), fecha: String(em.fecha), lineas: lineas(em), total: n(em.total) },
        recibida: { numero: String(rc.numero), fecha: String(rc.fecha), lineas: lineas(rc), total: n(rc.total) },
        saldo: d.transaccion && (d.transaccion as Fila).saldo ? n(((d.transaccion as Fila).saldo as Fila).importe) : null,
        bloqueos: ((d.bloqueos ?? []) as unknown[]).map(String),
      }, {
        cliente: ctx.enlace('customer', party, 'principal'), proveedor: ctx.enlace('supplier', sup, 'principal'),
        compras: ctx.enlace('supplier', sup, 'gasto') ?? (prov.expense_category_id ? ctx.enlace('expense_category', String(prov.expense_category_id), 'principal') : null),
        ingresoServicios: ctx.hoja('705'), ingresoMercaderias: ctx.hoja('700'), redondeoGasto: ctx.hoja('669'), redondeoIngreso: ctx.hoja('769'),
        ivaRepercutido: (pct) => { const t = tipoIva(pct); const c = t ? ctx.enlace('tax_rate', t.id, 'repercutido') : null; return c && t ? { cuenta: c, tipoId: t.id } : null },
        ivaSoportado: (pct) => { const t = tipoIva(pct); const c = t ? ctx.enlace('tax_rate', t.id, 'soportado') : null; return c && t ? { cuenta: c, tipoId: t.id } : null },
      })
      if (res.sinPropuesta) { r.sinPropuesta.push({ que, porque: res.sinPropuesta }); continue }
      for (const p of res.propuestas) if (abierto(p.fecha)) await proponer(companyId, p, null, r, ctx, quien)
    }
  }

  // ── Compras (10/10), §2.4: lo recibido sin factura al cierre de cada mes ──
  // Solo meses ya acabados (su último día, pasado) dentro de desde–hasta y
  // abiertos. compras_fin_de_mes guarda de qué recepciones sale cada uno; su
  // id es el origen del asiento y de su contrario, que se proponen una vez.
  {
    const hoy = new Date().toISOString().slice(0, 10)
    const meses: string[] = []
    for (let d = new Date(`${desde.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
      if (fin < hoy && fin <= hasta && abierto(fin)) meses.push(d.toISOString().slice(0, 10))
    }
    if (meses.length > 0) {
      const provs = new Map((await leer(tabla('supplier').select('id, name, expense_category_id').eq('account_id', accountId), 'los proveedores')).map((x) => [String(x.id), x]))
      for (const mes of meses) {
        const filas = ((await rpc('compras_fin_de_mes', { p_empresa: companyId, p_mes: mes })) as Fila[] | null) ?? []
        for (const a of filas) {
          const sup = String(a.supplier_id); const prov = provs.get(sup) ?? {}
          const gasto = ctx.enlace('supplier', sup, 'gasto') ?? (prov.expense_category_id ? ctx.enlace('expense_category', String(prov.expense_category_id), 'principal') : null)
          const res = finDeMesCompras({
            id: String(a.id), mes, proveedor: s(prov.name) ?? 'Proveedor', terceroId: partyPorProveedor.get(sup) ?? null,
            localId: s(a.location_id), nombreLocal: a.location_id ? ctx.locales.get(String(a.location_id)) ?? null : null, base: n(a.base),
            recepciones: ((a.receipts ?? []) as Fila[]).map((x) => ({ codigo: s(x.code), fecha: String(x.fecha), base: x.base === null || x.base === undefined ? null : n(x.base) })),
            sinBase: n(a.without_base),
          }, { gasto, pendiente: ctx.hoja('4009') })
          if (res.sinPropuesta) { r.sinPropuesta.push({ que: `Recibido sin factura · ${s(prov.name) ?? 'proveedor'} · ${mes.slice(5, 7)}/${mes.slice(0, 4)}`, porque: res.sinPropuesta }); continue }
          for (const p of res.propuestas) if (abierto(p.fecha)) await proponer(companyId, p, null, r, ctx, quien)
        }
      }
    }
  }

  // ── Liquidaciones de plataforma sin asiento (regla 7) ──
  // Respuesta 3, punto 4: la liquidación de una marca cedida va a la cuenta de
  // liquidación de SU socio (marca → acuerdo de cesión → socio → enlace «liquidacion»).
  const acuerdos = await leer(tabla('brand_licensing_agreement').select('brand_id, party_id').eq('account_id', accountId), 'los acuerdos de cesión')
  const socioDeMarca = new Map(acuerdos.filter((x) => x.party_id).map((x) => [String(x.brand_id), String(x.party_id)]))
  const liqs = await sinAsientoVivo(companyId, 'channel_settlement', await leer(tabla('channel_settlement').select('id, channel_id, brand_id, location_id, settlement_ref, settlement_date, period_from, period_to, flow_type, gross_sales, commission, delivery_transport, promo_product, promo_flash, access_fee, prime_fee, recurring_fee, incidents_cost, incidents_refund, min_order_fee, other_cost, net_payout, accumulated_debt, source, collected_on, collected_amount, commission_invoice_id, promo_charges, ads_spend, item_promotions, chargebacks, other_earnings, adjustments, needs_review, review_note, is_reference')
    .eq('account_id', accountId).gte('settlement_date', desde).lte('settlement_date', hasta).order('settlement_date', { ascending: false }), 'las liquidaciones'), r)
  // B01 (respuesta 1, P2): el cobro que ya ha casado Bancos lo asienta Bancos;
  // aquí solo la comisión y los cargos, para que el cobro no salga dos veces.
  const cobradasPorBanco = new Set((await leer(tabla('bank_match_item').select('channel_settlement_id, bank_match!inner(status)')
    .eq('account_id', accountId).not('channel_settlement_id', 'is', null).eq('bank_match.status', 'vivo'), 'los cobros casados en Bancos'))
    .map((x) => String(x.channel_settlement_id)))
  // D01 · Las del correo llevan su factura de comisión aparte (serie 2).
  const idsFactura = liqs.map((l) => s(l.commission_invoice_id)).filter((x): x is string => !!x)
  const facturaDe = new Map((idsFactura.length ? await leer(tabla('supplier_invoice').select('id, invoice_number, grand_total').eq('account_id', accountId).in('id', idsFactura), 'las facturas de comisión') : [])
    .map((f) => [String(f.id), { total: n(f.grand_total), numero: s(f.invoice_number) }]))
  for (const l of liqs) {
    const fecha = s(l.collected_on) ?? String(l.settlement_date)
    if (!abierto(fecha)) continue
    const canal = l.channel_id ? ctx.canales.get(String(l.channel_id)) : undefined
    const que = `Liquidación ${canal?.nombre ?? 'de plataforma'}${l.settlement_ref ? ` · ${l.settlement_ref}` : ''}`
    // D01 (Julio, 16/10): la contabilidad está cerrada hasta el corte; una liquidación de antes es de
    // referencia: sin asiento de liquidación (su cobro, si llega, lo asienta Bancos al casarlo).
    // Va antes que sus cuentas: no se asienta, así que no le faltan; el motivo es éste.
    if (l.is_reference === true) {
      r.sinPropuesta.push({ que, porque: s(l.review_note) ?? 'De referencia: es de antes del cierre de la contabilidad; no lleva factura ni asiento.' })
      continue
    }
    const c430 = canal?.partyId ? ctx.enlace('customer', canal.partyId, 'principal') : null
    const c410 = canal?.supplierId ? ctx.enlace('supplier', canal.supplierId, 'principal') : null
    const t21 = ctx.tipos.find((x) => x.code === 'iva_general')
    const c472 = t21 ? ctx.enlace('tax_rate', t21.id, 'soportado') : null
    if (!c430 || !c410 || !c472 || !t21) { r.sinPropuesta.push({ que, porque: 'Falta su 430, su 410 o la 472 del 21 %: revisa su ficha (Plataformas).' }); continue }
    // El CSV de Glovo (lib/liquidaciones, 96 de 96 en producción): su factura es la
    // comisión + IVA y nada más; entrega, tasas, promociones e incidencias son un
    // desglose que no se cobra aparte, y el neto arrastra la deuda anterior.
    const glovo = l.source === ORIGEN_GLOVO
    const cargos: CargoPlataforma[] = glovo ? [] : ([
      ['Transporte', l.delivery_transport], ['Promociones a tu cargo', l.promo_product], ['Promoción flash', l.promo_flash], ['Cuota de acceso', l.access_fee],
      ['Cuota prime', l.prime_fee], ['Cuota recurrente', l.recurring_fee], ['Incidencias (espera del repartidor y otras)', l.incidents_cost],
      ['Pedido mínimo', l.min_order_fee], ['Otros cargos', l.other_cost],
    ] as const).map(([concepto, v]) => ({ concepto, importe: Math.abs(n(v)) })).filter((x) => x.importe !== 0)
    const delCorreo = String(l.source ?? '').startsWith('correo_')
    // D01 (Julio, 16/10): por aclarar —un solape, algo que no cuadró al leer, la tienda sin asignar— no se asienta: nunca se suma doble.
    if (delCorreo && l.needs_review) {
      r.sinPropuesta.push({ que, porque: s(l.review_note) ?? 'Por aclarar: revisa la liquidación antes de asentarla.' })
      continue
    }
    const facturaAparte = l.commission_invoice_id ? facturaDe.get(String(l.commission_invoice_id)) ?? null : null
    if (delCorreo && !facturaAparte && [l.commission, l.other_cost, l.promo_charges, l.ads_spend].some((v) => Math.round(n(v) * 100) !== 0)) {
      r.sinPropuesta.push({ que, porque: 'Falta su factura de comisión (la liquidación la propone al leerse): sin ella, la comisión no se asienta aquí.' })
      continue
    }
    const asentados = (await rpc('conta_dias_por_asentar', { p_company: companyId, p_desde: s(l.period_from) ?? fecha, p_hasta: s(l.period_to) ?? fecha })) as Fila[] | null
    const pendientes = (asentados ?? []).filter((x) => !l.location_id || String(x.location_id) === String(l.location_id)).reduce((t, x) => t + n(x.pedidos), 0)
    const res = liquidacionPlataforma({
      id: String(l.id), fecha: String(l.settlement_date), ref: s(l.settlement_ref), plataforma: canal?.nombre ?? 'la plataforma',
      flujo: l.flow_type === 'licensed' ? 'licensed' : 'own', ventas: n(l.gross_sales), comision: Math.abs(n(l.commission)), cargos,
      devoluciones: glovo ? 0 : Math.abs(n(l.incidents_refund)),
      neto: l.net_payout === null ? null : glovo ? n(l.net_payout) - n(l.accumulated_debt) : n(l.net_payout),
      cobrado: l.collected_on && !cobradasPorBanco.has(String(l.id)) ? { fecha: String(l.collected_on), importe: n(l.collected_amount) } : null,
      cobroEnBancos: cobradasPorBanco.has(String(l.id)),
      // Lo que se sabe sin recorrer pedido a pedido: cuántos del periodo FALTAN en un resumen del día.
      pedidos: { total: pendientes, asentados: 0 }, localId: s(l.location_id),
      facturaAparte,
      apartado: delCorreo ? ([['Promociones en artículos', l.item_promotions], ['Contracargos', l.chargebacks], ['Otras ganancias', l.other_earnings], ['Ajustes', l.adjustments]] as const)
        .map(([concepto, v]) => ({ concepto, importe: Math.abs(n(v)) })) : [],
    }, {
      cliente430: c430, proveedor410: c410, comision: ctx.hoja('623') ?? '62300000', otrosCargos: ctx.hoja('629') ?? '62900000',
      iva21: { cuenta: c472, tipoId: t21.id }, banco: ctx.bancoDeLocal(s(l.location_id)),
      pendienteSocio: l.brand_id && socioDeMarca.has(String(l.brand_id)) ? ctx.enlace('customer', socioDeMarca.get(String(l.brand_id))!, 'liquidacion') : null,
      serieTesoreria: ctx.serieTesoreria,
    })
    if (!res.propuesta) { r.sinPropuesta.push({ que, porque: res.sinPropuesta ?? '' }); continue }
    await proponer(companyId, aplicarAprendizaje(res.propuesta, `channel_settlement:${s(l.channel_id)}`, ctx.correcciones), null, r, ctx, quien)
  }

  // ── Liquidación mensual del socio de marca (respuesta 4, punto 4) ──
  // Cuando el mes del socio está cerrado (confirmada o saldada) y sin asiento:
  // su resumen mensual como compra (400), tu comisión como ingreso (705) con
  // IVA a su 430, y la compensación con lo cobrado por cuenta de él (su
  // «Liquidación pendiente») y con sus compras. El cálculo es el del C03
  // (brand_partner_settlement_compute); aquí solo se asienta.
  const [liqSocio, partes] = await Promise.all([
    leer(tabla('licensed_settlement').select('id, party_id, location_id, period_from, period_to, status, purchases_amount, contributions_amount, commission_amount')
      .eq('account_id', accountId).eq('formula', 'compras_aportaciones_comision').in('status', ['confirmada', 'saldada'])
      .gte('period_to', desde).lte('period_to', hasta).order('period_to', { ascending: false }), 'las liquidaciones del socio')
      .then((filas) => sinAsientoVivo(companyId, 'licensed_settlement', filas, r)),
    leer(tabla('party').select('id, name').eq('account_id', accountId), 'los terceros'),
  ])
  const nombreDe = new Map(partes.map((x) => [String(x.id), String(x.name)]))
  const tReducido = ctx.tipos.find((x) => x.code === 'iva_reducido')
  const tGeneral = ctx.tipos.find((x) => x.code === 'iva_general')
  for (const l of liqSocio) {
    const fecha = String(l.period_to)
    if (!abierto(fecha)) continue
    const party = String(l.party_id); const socio = nombreDe.get(party) ?? 'el socio'
    const local = s(l.location_id)
    const que = `Liquidación de ${socio} · ${ctx.locales.get(local ?? '') ?? 'local'} · ${fecha.slice(5, 7)}/${fecha.slice(0, 4)}`
    const sup = proveedorDeParty(socios, party)
    const c400 = sup ? ctx.enlace('supplier', sup, 'principal') : null
    const c430 = ctx.enlace('customer', party, 'principal')
    const pendiente = ctx.enlace('customer', party, 'liquidacion')
    const c705 = ctx.hoja('705')
    const c477 = tGeneral ? ctx.enlace('tax_rate', tGeneral.id, 'repercutido') : null
    const faltan = [!c400 && 'su 400', !c430 && 'su 430', !pendiente && 'su «Liquidación pendiente»', !c705 && 'la 705', !c477 && 'la 477 del 21 %'].filter(Boolean)
    if (faltan.length || !tGeneral) { r.sinPropuesta.push({ que, porque: `Falta ${faltan.join(', ')}: revisa su ficha (Contabilidad).` }); continue }
    // Lo cobrado por cuenta de él ese mes en ese local: las liquidaciones de sus marcas cedidas.
    const marcasDelSocio = [...socioDeMarca].filter(([, p]) => p === party).map(([b]) => b)
    const cobradas = marcasDelSocio.length
      ? await leer(tabla('channel_settlement').select('collected_amount, location_id').eq('account_id', accountId).eq('flow_type', 'licensed')
        .in('brand_id', marcasDelSocio).gte('collected_on', String(l.period_from)).lte('collected_on', fecha), 'lo cobrado por cuenta del socio')
      : []
    const ventasCobradas = cobradas.filter((x) => !local || !x.location_id || String(x.location_id) === local).reduce((t, x) => t + n(x.collected_amount), 0)
    const res = liquidacionSocio({
      id: String(l.id), fecha, socio, terceroId: party, localId: local,
      // Los albaranes no traen IVA: se propone al 10 % (alimentación) y se avisa para contrastarlo con su resumen.
      compras: n(l.purchases_amount) && tReducido ? [{ base: n(l.purchases_amount), tipo: { id: tReducido.id, porcentaje: tReducido.rate } }] : [],
      comision: n(l.commission_amount), ventasCobradas,
    }, {
      proveedor: c400!, cliente: c430!, compras: ctx.hoja('600') ?? '60000000', ingresosServicios: c705!,
      iva21: { cuenta: c477!, tipoId: tGeneral.id },
      ivaSoportado: (pct) => { const t = ctx.tipos.find((x) => x.rate === pct && x.code.startsWith('iva_')); const c = t ? ctx.enlace('tax_rate', t.id, 'soportado') : null; return c && t ? { cuenta: c, tipoId: t.id } : null },
      pendienteSocio: pendiente!,
    })
    if (!res.propuesta) { r.sinPropuesta.push({ que, porque: res.sinPropuesta ?? '' }); continue }
    const p = res.propuesta
    if (n(l.purchases_amount)) p.avisos.push(`El IVA de sus compras va al ${tReducido?.rate ?? 10} %: los albaranes no lo traen. Compruébalo con su resumen mensual.`)
    if (n(l.contributions_amount)) p.avisos.push(`Sus aportaciones del mes (${n(l.contributions_amount).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €) no entran aquí: van por el banco cuando llegan.`)
    if (p.avisos.length) p.confianza = 'duda'
    await proponer(companyId, aplicarAprendizaje(p, `licensed_settlement:${party}`, ctx.correcciones), null, r, ctx, quien)
  }

  // ── Nóminas ──
  const nominas = await leer(tabla('payroll_summary').select('id, period_month, location_id, gross, employer_ss, employee_ss, irpf, other_deductions, net')
    .eq('account_id', accountId).eq('company_id', companyId).is('entry_id', null).gte('period_month', desde.slice(0, 7) + '-01').lte('period_month', hasta).order('period_month', { ascending: false }), 'las nóminas')
  const retTrabajo = ret.find((x) => String(x.filed_in) === '111')
  for (const x of nominas) {
    const res = nomina({
      id: String(x.id), mes: String(x.period_month), localId: s(x.location_id), bruto: n(x.gross), ssEmpresa: n(x.employer_ss), ssTrabajador: n(x.employee_ss),
      irpf: n(x.irpf), otras: n(x.other_deductions), neto: n(x.net), retencionTipoId: retTrabajo ? String(retTrabajo.id) : null,
    }, { sueldos: ctx.hoja('640') ?? '64000000', ssEmpresa: ctx.hoja('642') ?? '64200000', ssAcreedora: ctx.hoja('476') ?? '47600000', irpf: ctx.hoja('4751') ?? '47510000', remuneraciones: ctx.hoja('465') ?? '46500000' })
    const que = `Nóminas de ${String(x.period_month).slice(5, 7)}/${String(x.period_month).slice(0, 4)}`
    if (!res.propuesta) { r.sinPropuesta.push({ que, porque: res.sinPropuesta ?? '' }); continue }
    if (!abierto(res.propuesta.fecha)) continue
    await proponer(companyId, res.propuesta, null, r, ctx, quien)
  }
  return r
}

/** Una corrección hecha a una propuesta: la siguiente del mismo origen lo hará igual (regla 11). */
export async function apuntarCorreccion(accountId: string, companyId: string, clave: string, propuesta: string, elegida: string, entryId: string | null, quien: string | null): Promise<void> {
  const { error } = await tabla('journal_correction').insert({
    account_id: accountId, company_id: companyId, origin_key: clave, proposed_code: propuesta, chosen_code: elegida, entry_id: entryId, created_by_name: quien,
  })
  if (error) throw new Error(mensaje('No se ha podido guardar lo aprendido', error))
}

/** La ficha de proveedor de un tercero (su papel «supplier»). */
function proveedorDeParty(roles: readonly Fila[], partyId: string): string | null {
  const r = roles.find((x) => x.role === 'supplier' && String(x.party_id) === partyId && x.supplier_id)
  return r ? String(r.supplier_id) : null
}

/**
 * Facturas de proveedor aprobadas y sin asiento, entre dos fechas; con
 * soloFactura, solo esa (N23 «Está bien · apuntar»). Es el mismo bloque de
 * proponerPendientes, sacado para que una factura se apunte igual que en la tanda.
 */
async function facturasDeProveedor(accountId: string, companyId: string, desde: string, hasta: string, ctx: ContextoLibro, r: ResultadoProponer,
  quien: string | null, abierto: (f: string) => boolean, soloFactura?: string, ver?: (p: Propuesta) => void, localPropuesto?: string | null) {
  // ── Facturas de proveedor aprobadas, sin asiento (regla 8) ──
  const [leidas, socios] = await Promise.all([
    // Compras (10/10): las de esta empresa, y las de antes que no dicen de cuál.
    leer(tabla('supplier_invoice').select('id, supplier_id, location_id, brand_id, source, issuer_name, issuer_tax_id, invoice_number, invoice_date, grand_total, withholding_rate_id, withholding_amount, vat_non_deductible, reading_confidence, supplier(name, tax_id, expense_category_id, country_code, tax_id_type, tax_id_check_status, vat_regime), reading, supplier_invoice_line(line_amount, vat_pct, expense_account_code), supplier_invoice_tax(vat_pct, base, vat_amount)')
      .eq('account_id', accountId).in('status', ver ? ['en_revision', 'aprobada'] : ['aprobada']).or(`company_id.is.null,company_id.eq.${companyId}`)
      .gte('invoice_date', desde).lte('invoice_date', hasta).match(soloFactura ? { id: soloFactura } : {}).order('invoice_date', { ascending: false }), 'las facturas'),
    leer(tabla('party_role').select('party_id, supplier_id, role').eq('account_id', accountId), 'los socios'),
  ])
  // «Cómo se apunta» (ver) enseña la propuesta aunque ya tenga asiento; al proponer, las que lo tienen ya estaban.
  const facturas = ver ? leidas : await sinAsientoVivo(companyId, 'supplier_invoice', leidas, r)
  const socioPorProveedor = new Set<string>()
  const partyPorProveedor = new Map<string, string>()
  for (const x of socios) if (x.role === 'supplier' && x.supplier_id) partyPorProveedor.set(String(x.supplier_id), String(x.party_id))
  const esSocio = new Set(socios.filter((x) => x.role === 'brand_partner').map((x) => String(x.party_id)))
  for (const [sup, party] of partyPorProveedor) if (esSocio.has(party)) socioPorProveedor.add(sup)
  const ret = await leer(tabla('withholding_rate').select('id, rate, filed_in'), 'las retenciones')
  // Compras (10/10): la factura de una liquidación mensual la propone su liquidación, no aquí.
  const deLiquidacion = new Set((await leer(tabla('licensed_settlement').select('received_invoice_id').eq('account_id', accountId)
    .not('received_invoice_id', 'is', null), 'las facturas de las liquidaciones')).map((x) => String(x.received_invoice_id)))
  ctx.lecturasSeguras = new Set(facturas.filter((f) => f.reading_confidence === 'seguro').map((f) => String(f.id)))
  const aprendido = new Map<string, Fila | null>()
  for (const f of facturas) {
    if (deLiquidacion.has(String(f.id))) continue
    const sup = String(f.supplier_id); const prov = (f.supplier ?? {}) as Fila
    const fecha = String(f.invoice_date)
    if (!abierto(fecha)) {
      // Una sola (N23): lo que no se apunta se dice (regla 8). En la tanda, como siempre.
      if (soloFactura) r.sinPropuesta.push({ que: `Factura${f.invoice_number ? ` ${String(f.invoice_number)}` : ''}`, porque: 'Su fecha cae en un periodo cerrado o antes del primer día abierto: no se apunta ahí.' })
      continue
    }
    const cuentaProv = ctx.enlace('supplier', sup, 'principal')
    let gasto = ctx.enlace('supplier', sup, 'gasto') ?? (prov.expense_category_id ? ctx.enlace('expense_category', String(prov.expense_category_id), 'principal') : null)
    // D01 · Sin «Sus facturas se apuntan en»: lo aprendido de sus facturas anteriores
    // (Diez o Folvy), con su porqué. Probable si fueron a varias cuentas.
    let deLoAprendido: Fila | null = null
    if (!gasto && cuentaProv) {
      if (!aprendido.has(sup)) aprendido.set(sup, await rpc<Fila>('conta_gasto_aprendido', { p_company: companyId, p_supplier: sup }).catch(() => null))
      deLoAprendido = aprendido.get(sup) ?? null
      if (deLoAprendido?.cuenta) gasto = String(deLoAprendido.cuenta)
    }
    const que = `Factura ${s(prov.name) ?? 'de proveedor'}${f.invoice_number ? ` · ${f.invoice_number}` : ''}`
    if (!cuentaProv) { r.sinPropuesta.push({ que, porque: 'El proveedor no tiene su cuenta (Contabilidad de su ficha).' }); continue }
    const rr = ret.find((x) => String(x.id) === s(f.withholding_rate_id))
    // I01d · La ficha dice cómo va su IVA: si lo declaras tú, la factura se autoliquida.
    const ficha: FichaIva = {
      pais: s(prov.country_code), tipoNif: s(prov.tax_id_type) as FichaIva['tipoNif'], nif: s(prov.tax_id),
      vies: s(prov.tax_id_check_status) as FichaIva['vies'], regimen: s(prov.vat_regime) as FichaIva['regimen'],
    }
    const clase = claseIva(ficha)
    const nombreProv = s(prov.name) ?? 'El proveedor'
    if (clase === 'ue_sin_nif_iva' && f.vat_non_deductible !== true) {
      r.sinPropuesta.push({ que, porque: `${nombreProv} es de ${nombrePais(ficha.pais)} y no tiene un NIF-IVA europeo válido: sin él su compra no es intracomunitaria. Ponlo en su ficha (se comprueba en VIES) y la factura se propone.` })
      continue
    }
    const tipoAuto = tipoDeLaClase(clase)
    // E05 · La factura de un lote (riders y flotas de Catcher): su emisor, su NIF,
    // su gasto por tipo y su reparto salen de la factura (lib: deLaFacturaDeLote).
    const tipoDe = (pct: number) => ctx.tipos.find((x) => x.rate === pct && x.code.startsWith('iva_')) ?? null
    const lote = f.source === 'lote' ? deLaFacturaDeLote(f, gasto, tipoDe, (id) => ctx.locales.get(id) ?? null) : null
    const res = facturaProveedor({
      id: String(f.id), numero: s(f.invoice_number), fecha, proveedor: lote?.proveedor ?? s(prov.name) ?? 'Proveedor', terceroId: partyPorProveedor.get(sup) ?? null,
      // Ficha completa (tablero 3b): una sola factura sin local guardado lleva el de su
      // recepción, el que la ficha enseña como PROPUESTO («el local sale de la recepción»).
      esSocio: socioPorProveedor.has(sup), tieneNif: lote?.tieneNif || !!s(prov.tax_id), localId: s(f.location_id) ?? (soloFactura ? localPropuesto ?? null : null), total: n(f.grand_total),
      // D01 · Una línea puede llevar su propia cuenta (la factura de comisión de una liquidación: comisión y anuncios).
      lineas: lote?.lineas ?? ((f.supplier_invoice_line ?? []) as Fila[]).map((l) => {
        const t = tipoDe(n(l.vat_pct))
        return { base: n(l.line_amount), tipo: t ? { id: t.id, porcentaje: t.rate } : null, cuentaGasto: s(l.expense_account_code) ?? gasto }
      }),
      ...(lote ? { cuotas: lote.cuotas, reparto: lote.reparto } : {}),
      ...(f.source === 'liquidacion' ? {
        cuotas: ((f.supplier_invoice_tax ?? []) as Fila[]).map((x) => ({ porcentaje: n(x.vat_pct), base: n(x.base), cuota: n(x.vat_amount) })),
        marcaId: s(f.brand_id), faltaNumero: !s(f.invoice_number),
        porAclarar: (((f.reading as Fila | null)?.requisitos ?? []) as Fila[]).filter((x) => (x.id === 'solape' || x.id === 'cuadre') && x.ok === false).map((x) => String(x.texto)),
      } : {}),
      retencion: rr && f.withholding_amount !== null ? { tipoId: String(rr.id), porcentaje: n(rr.rate), base: 0, importe: n(f.withholding_amount), modelo: (String(rr.filed_in) as '111' | '115' | '123') } : null,
      ivaNoDeducible: f.vat_non_deductible === true,
      autoliquidacion: tipoAuto && f.vat_non_deductible !== true ? { tipo: tipoAuto, porque: `${nombreProv} ${porqueAutoliquida(clase, ficha.pais)}.` } : null,
    }, {
      proveedor: cuentaProv, retencion: ctx.hoja('4751') ?? '47510000',
      ivaSoportado: (pct) => { const t = ctx.tipos.find((x) => x.rate === pct && x.code.startsWith('iva_')); const c = t ? ctx.enlace('tax_rate', t.id, 'soportado') : null; return c && t ? { cuenta: c, tipoId: t.id } : null },
      // La 472 y la 477 del tipo autoliquidado; si la empresa no las tiene propias, las del IVA al mismo %.
      autoliquidada: (codigo) => {
        const t = ctx.tipos.find((x) => x.code === codigo)
        if (!t) return null
        const igual = ctx.tipos.find((x) => x.rate === t.rate && x.code.startsWith('iva_'))
        const cuenta = (rol: 'soportado' | 'repercutido') => ctx.enlace('tax_rate', t.id, rol) ?? (igual ? ctx.enlace('tax_rate', igual.id, rol) : null)
        const sop = cuenta('soportado'), rep = cuenta('repercutido')
        return sop && rep ? { tipoId: t.id, porcentaje: t.rate, soportado: sop, repercutido: rep } : null
      },
    })
    if (!res.propuesta) { r.sinPropuesta.push({ que, porque: res.sinPropuesta ?? '' }); continue }
    if (clase === 'intracomunitaria' && ficha.vies !== 'valid') {
      res.propuesta.avisos.push(`El NIF-IVA de ${nombreProv} está sin comprobar en VIES: ábrelo en su ficha y se vuelve a preguntar.`)
      res.propuesta.confianza = peor(res.propuesta.confianza, 'probable')
    }
    if (res.propuesta.lineas.find((l) => l.retencion)) {
      const l = res.propuesta.lineas.find((x) => x.retencion)!
      l.retencion = { ...l.retencion!, base: res.propuesta.lineas.filter((x) => x.cuenta[0] === '6').reduce((t, x) => t + x.debe, 0) }
    }
    if (deLoAprendido?.cuenta) {
      res.propuesta.razones.push({ decision: `Gasto: ${s(deLoAprendido.nombre) ?? 'la cuenta'} · ${deLoAprendido.cuenta}`, porque: `${s(deLoAprendido.porque) ?? ''} (${s(deLoAprendido.origen) ?? 'aprendido'})` })
      if (deLoAprendido.confianza !== 'seguro') res.propuesta.confianza = peor(res.propuesta.confianza, 'probable')
    }
    const final = aplicarAprendizaje(res.propuesta, `supplier_invoice:${sup}`, ctx.correcciones)
    // N23 «Cómo se apunta»: la misma propuesta, sin escribirla.
    if (ver) ver(final)
    else await proponer(companyId, final, null, r, ctx, quien)
  }
  return { socios, ret, partyPorProveedor }
}

/** D01 · N23: propone la factura recibida (ya aprobada) como en la tanda. Lo que no se propone, dice por qué. */
export async function proponerFactura(accountId: string, companyId: string, invoiceId: string, fecha: string, quien: string | null, localPropuesto?: string | null): Promise<ResultadoProponer> {
  const ctx = await cargarContexto(accountId, companyId)
  const r: ResultadoProponer = { propuestas: 0, yaEstaban: 0, descartadas: 0, sinPropuesta: [], validadasSolas: 0, mesVentas: null, quedanDias: 0 }
  await facturasDeProveedor(accountId, companyId, fecha, fecha, ctx, r, quien, (f) => diaAbierto(f, ctx.calendario), invoiceId, undefined, localPropuesto)
  return r
}

/**
 * D01 · N23 «Cómo se apunta»: la propuesta que saldría para esta factura (aún
 * en revisión o ya aprobada), con el nombre de cada cuenta. No escribe nada.
 * Si no sale, dice por qué.
 */
export async function verPropuestaFactura(accountId: string, companyId: string, invoiceId: string, fecha: string, localPropuesto?: string | null): Promise<
  { propuesta: Propuesta; nombres: Map<string, string> } | { propuesta: null; porque: string }> {
  const ctx = await cargarContexto(accountId, companyId)
  const r: ResultadoProponer = { propuestas: 0, yaEstaban: 0, descartadas: 0, sinPropuesta: [], validadasSolas: 0, mesVentas: null, quedanDias: 0 }
  let vista: Propuesta | null = null
  await facturasDeProveedor(accountId, companyId, fecha, fecha, ctx, r, null, (f) => diaAbierto(f, ctx.calendario), invoiceId, (p) => { vista = p }, localPropuesto)
  const p = vista as Propuesta | null
  if (!p) return { propuesta: null, porque: r.sinPropuesta[0]?.porque ?? 'Esta factura no tiene propuesta todavía.' }
  const codigos = [...new Set(p.lineas.map((l) => l.cuenta))]
  const filas = await leer(tabla('company_account').select('code, name').eq('company_id', companyId).in('code', codigos), 'los nombres de las cuentas')
  return { propuesta: p, nombres: new Map(filas.map((x) => [String(x.code), String(x.name)])) }
}

/** I01d · Por qué su IVA lo declaras tú, para la propuesta: «es de Francia y tiene NIF-IVA europeo…». */
function porqueAutoliquida(c: ClaseIva, pais: string | null): string {
  if (c === 'intracomunitaria') return `es de ${nombrePais(pais)} y tiene NIF-IVA europeo: su compra es intracomunitaria`
  if (c === 'isp_extranjero') return `es de fuera de la UE (${nombrePais(pais)}): su compra va con inversión del sujeto pasivo`
  return 'está marcado con inversión del sujeto pasivo en su ficha'
}
