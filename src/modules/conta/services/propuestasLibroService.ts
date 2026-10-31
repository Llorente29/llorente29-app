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

import { hojaDelProveedor, siguienteLibre } from '@/modules/conta/lib/planEmpresa'
import { leerNoDeducibles, type IvaNoDeducible } from '@/modules/conta/services/ivaNoDeducibleService'
import { porQueNoDeducible } from '@/modules/conta/lib/ivaNoDeducible'
import { aplicarAsientoAMano, aplicarReparto, cuentaDelReparto, lineasYCuotas } from '@/modules/conta/lib/recibidaGuardada'
import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import {
  unidadesDelDia, type UnidadVentas, devolucionSinCobrar, facturaProveedor, deLaFacturaDeLote,
  type Correccion, type SerieTesoreria, comoAbono, plantillaDevolucion,
} from '@/modules/conta/lib/asientosPropuestos'
import { avisoPeriodoCerrado, diaAbierto, diaDeEntrada, fechaDeLaRecibida, fechaPropuesta, peor, type CalendarioEmpresa, type LineaAsiento, type Propuesta, type Razon } from '@/modules/conta/lib/libro'
import { claseIva, nombrePais, tipoDeLaClase, type ClaseIva, type FichaIva } from '@/modules/conta/lib/ivaProveedor'

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
  /** D07b · Los códigos de cuenta de la empresa (para la siguiente libre de un rango). */
  codigos?: ReadonlySet<string>
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
    codigos: new Set(cuentas.map((c) => String(c.code))),
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

/**
 * N2 · Lo que deja el cierre del día: la devolución de un pedido cerrado sin
 * confirmar que su liquidación no cobra (C11b). Su día si está abierto; si no,
 * el primer día abierto (y se avisa). La unidad, como el asiento de su día
 * (por plataforma; Glovo, por marca). Lo devuelve en palabras (regla 8).
 */
export async function proponerDevolucionSinCobrar(accountId: string, companyId: string, x: {
  saleId: string; locationId: string; dia: string; liquidacion: { ref: string | null; fecha: string | null }
}, quien: string | null): Promise<string> {
  const ctx = await cargarContexto(accountId, companyId)
  const ventas = ctx.hoja('700'); const devoluciones = ctx.hoja('708') ?? ventas
  const iva477 = ctx.tipoVentas ? ctx.enlace('tax_rate', ctx.tipoVentas.id, 'repercutido') : null
  if (!ctx.tipoVentas || !iva477 || !ventas) throw new Error('Falta el IVA de tus ventas (Tu empresa) o su 477, o la 700 en el plan.')
  const { fecha, aviso } = fechaPropuesta(x.dia, ctx.calendario)
  if (!fecha) throw new Error(aviso ?? 'No hay ningún día abierto donde apuntarla.')
  const delDia = ((await rpc('conta_pedidos_del_dia', { p_company: companyId, p_location: x.locationId, p_dia: x.dia })) as Fila[] | null) ?? []
  const p = delDia.find((f) => String(f.id) === x.saleId)
  if (!p) throw new Error('No encuentro el pedido en su día: puede que ya no esté cerrado.')
  const cobroPorCanal: Record<string, string> = {}
  for (const [id, c] of ctx.canales) { const cta = c.partyId ? ctx.enlace('customer', c.partyId, 'principal') : null; if (cta) cobroPorCanal[id] = cta }
  const regla = ctx.ventasPorPlataforma
  const canalId = s(p.canal_id); const marcaId = s(p.marca_id)
  const unidad: UnidadVentas | undefined = regla ? unidadesDelDia([], [{ pedidoId: x.saleId, codigo: s(p.codigo), canalId, marcaId, marcaPropia: true, importe: n(p.total), conFactura: false }],
    (c) => !!c && regla.porMarca.has(c))[0] : undefined
  const res = devolucionSinCobrar({ pedido: { id: x.saleId, codigo: s(p.codigo), canalId, marcaId, total: n(p.total) }, dia: x.dia, fecha, liquidacion: x.liquidacion }, {
    localId: x.locationId, tipo: ctx.tipoVentas, porMarca: true, nombreLocal: ctx.locales.get(x.locationId) ?? 'local', unidad,
    nombreCanal: (id) => (id ? ctx.canales.get(id)?.nombre ?? 'un canal' : 'sin canal'), nombreMarca: (id) => (id ? ctx.marcas.get(id)?.nombre ?? 'una marca' : 'sin marca'),
    cuentas: { cobroPorCanal, ventas, devoluciones: devoluciones!, ivaRepercutido: iva477, ventasPorMarca: regla?.ventasPorMarca, devolucionesPorMarca: regla?.devolucionesPorMarca,
      promocionesPorCanal: regla?.promocionesPorCanal, enviosPorCanal: regla?.enviosPorCanal },
  })
  if (!res.propuesta) throw new Error(res.sinPropuesta ?? 'No se ha podido preparar la devolución.')
  if (aviso) res.propuesta.avisos.push(aviso)
  const r: ResultadoProponer = { propuestas: 0, yaEstaban: 0, descartadas: 0, sinPropuesta: [], validadasSolas: 0, mesVentas: null, quedanDias: 0 }
  await proponer(companyId, res.propuesta, null, r, ctx, quien)
  const dd = fecha.split('-').reverse().join('/')
  if (r.descartadas) return 'Esa devolución ya se descartó antes: no la vuelvo a proponer.'
  if (r.yaEstaban) return `Su devolución ya estaba en el libro (del ${dd}): valídala allí.`
  return `Devolución propuesta en el libro, del ${dd}: valídala en Libros › Libro diario.${aviso ? ` ${aviso}` : ''}`
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
      // S01d: la que nace lleva tipo, base y modelo; el pago de un modelo, su modelo y su periodo.
      retencion: !l.retencion ? null : l.retencion.periodo !== undefined ? { modelo: l.retencion.modelo, periodo: l.retencion.periodo }
        : { tipo_id: l.retencion.tipoId, base: l.retencion.base, modelo: l.retencion.modelo },
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
  /** D06: `id`, el de lo que no se propone (las facturas de proveedor), para decirlo en su fila. */
  sinPropuesta: { id?: string; que: string; porque: string; pedidos?: PedidoParaVer[] }[]
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


// S01 · PR 3 (entrega 5): «Proponer lo pendiente» ya no existe. Las ventas del
// día las propone el cierre de cada hora (SQL); las facturas recibidas, Compras al
// validarlas (proponerFactura, abajo); y los cinco orígenes de la entrega 5
// (nóminas, lo recibido sin factura, el pagado después, el socio y la
// plataforma), la base al pasar lo que los origina y en la pasada de las 03:40.

/**
 * Regla 11 · lo aprendido (S01 · PR 3): vive en SQL, una sola copia
 * (_conta_aprendizaje). Aquí solo se mira si hay algo aprendido de este origen;
 * si lo hay, la base dice qué cuentas cambian y por qué.
 */
async function aprender(companyId: string, p: Propuesta, clave: string, ctx: ContextoLibro): Promise<Propuesta> {
  if (!ctx.correcciones.some((x) => x.clave === clave)) return p
  const x = (await rpc('conta_aprendizaje', { p_company: companyId, p_clave: clave, p_cuentas: p.lineas.map((l) => l.cuenta) })) as { cuentas: string[]; razon: Razon | null } | null
  if (!x?.razon) return p
  return { ...p, lineas: p.lineas.map((l, i) => ({ ...l, cuenta: x.cuentas[i] ?? l.cuenta })), razones: [...p.razones, x.razon] }
}

/** Una corrección hecha a una propuesta: la siguiente del mismo origen lo hará igual (regla 11). */
export async function apuntarCorreccion(accountId: string, companyId: string, clave: string, propuesta: string, elegida: string, entryId: string | null, quien: string | null): Promise<void> {
  const { error } = await tabla('journal_correction').insert({
    account_id: accountId, company_id: companyId, origin_key: clave, proposed_code: propuesta, chosen_code: elegida, entry_id: entryId, created_by_name: quien,
  })
  if (error) throw new Error(mensaje('No se ha podido guardar lo aprendido', error))
}

/**
 * Facturas de proveedor aprobadas y sin asiento, entre dos fechas; con
 * soloFactura, solo esa (N23 «Está bien · apuntar»). Es el mismo bloque de
 * proponerPendientes, sacado para que una factura se apunte igual que en la tanda.
 */
async function facturasDeProveedor(accountId: string, companyId: string, desde: string, hasta: string, ctx: ContextoLibro, r: ResultadoProponer,
  quien: string | null, abierto: (f: string) => boolean, soloFactura?: string, ver?: (p: Propuesta) => void, localPropuesto?: string | null) {
  // ── Facturas de proveedor aprobadas, sin asiento (regla 8) ──
  // D03 · 0790: lo que guarda la ficha (el gasto repartido y el asiento a mano). Mientras
  // la base no lo tenga (staging antes de aplicarla), se lee lo de siempre.
  const SELECT = 'id, supplier_id, location_id, brand_id, source, doc_kind, corrects_invoice_id, issuer_name, issuer_tax_id, invoice_number, invoice_date, created_at, grand_total, withholding_rate_id, withholding_amount, vat_non_deductible, reading_confidence, supplier(name, tax_id, expense_category_id, country_code, tax_id_type, tax_id_check_status, vat_regime), reading, supplier_invoice_line(line_amount, vat_pct, expense_account_code), supplier_invoice_tax(vat_pct, base, vat_amount)'
  // D07b · 'pagada' también: una factura pagada en el banco antes de validarla (COHELDI T0626/657,
  // EUROPASTRY 2403975) está aprobada y sin asiento; sin ella aquí, su ficha decía «Estoy
  // comprobando la cuenta y el IVA» para siempre y no se podía validar.
  const consulta = (sel: string) => tabla('supplier_invoice').select(sel)
    .eq('account_id', accountId).in('status', ver ? ['en_revision', 'aprobada', 'pagada'] : ['aprobada', 'pagada']).or(`company_id.is.null,company_id.eq.${companyId}`)
    .gte('invoice_date', desde).lte('invoice_date', hasta).match(soloFactura ? { id: soloFactura } : {}).order('invoice_date', { ascending: false })
  const conLaFicha = async (): Promise<Fila[]> => {
    const x = await consulta(`${SELECT}, entry_overrides, supplier_invoice_expense(position, account_code, location_id, is_common, amount)`)
    if (x.error && /does not exist|could not find|relationship/i.test(x.error.message)) return leer(consulta(SELECT), 'las facturas')
    return leer(Promise.resolve(x), 'las facturas')
  }
  const [leidas, socios] = await Promise.all([
    // Compras (10/10): las de esta empresa, y las de antes que no dicen de cuál.
    conLaFicha(),
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
  // D07 · El porqué de cada IVA no deducible (0850), para decirlo en su asiento.
  const idsNd = facturas.filter((f) => f.vat_non_deductible === true).map((f) => String(f.id))
  const noDeducibles = idsNd.length ? await leerNoDeducibles(accountId, idsNd).catch(() => new Map<string, IvaNoDeducible>()) : new Map<string, IvaNoDeducible>()
  const aprendido = new Map<string, Fila | null>()
  for (const f of facturas) {
    if (deLiquidacion.has(String(f.id))) continue
    const sup = String(f.supplier_id); const prov = (f.supplier ?? {}) as Fila
    const fechaFactura = String(f.invoice_date)
    // V04 (Julio, 27/10): nunca antes del día en que entró, aunque el mes esté abierto.
    const entrada = fechaDeLaRecibida(fechaFactura, diaDeEntrada(s(f.created_at)))
    let fecha = entrada.fecha
    // Que entró después no es una duda: va en sus razones, sin bajar la confianza (lo seguro se sigue apuntando solo).
    let razonEntrada = entrada.aviso
    let avisoFecha: string | null = null
    if (!abierto(fecha)) {
      // D07b (Julio, 23/10): la de un periodo cerrado se asienta el PRIMER DÍA
      // ABIERTO, conserva su fecha de factura (el libro de IVA la lleva) y su
      // IVA va al periodo del asiento; un aviso ámbar dice las dos fechas. Solo
      // al mirarla o validarla una a una (o en bloque): la tanda de pendientes
      // no las arrastra, como siempre (lo traído de Diez ya está allí).
      const fp = soloFactura || ver ? fechaPropuesta(fecha, ctx.calendario) : { fecha: null, aviso: null }
      if (!fp.fecha) {
        if (soloFactura || ver) r.sinPropuesta.push({ id: String(f.id), que: `Factura${f.invoice_number ? ` ${String(f.invoice_number)}` : ''}`, porque: fp.aviso ?? 'Su fecha cae en un periodo cerrado o antes del primer día abierto: no se apunta ahí.' })
        continue
      }
      // Entró en un periodo cerrado: el primer día abierto desde ese día, y lo dice.
      razonEntrada = null
      avisoFecha = entrada.aviso
        ? `Esta factura entró el ${entrada.fecha.slice(8, 10)}/${entrada.fecha.slice(5, 7)}: se contabiliza el ${fp.fecha.slice(8, 10)}/${fp.fecha.slice(5, 7)}, el primer día abierto.`
        : avisoPeriodoCerrado(fechaFactura, fp.fecha)
      fecha = fp.fecha
    }
    let cuentaProv = ctx.enlace('supplier', sup, 'principal')
    let gasto = ctx.enlace('supplier', sup, 'gasto') ?? (prov.expense_category_id ? ctx.enlace('expense_category', String(prov.expense_category_id), 'principal') : null)
    // S01b · Un proveedor recién dado de alta desde la factura no tiene tipo de gasto ni historia:
    // la cuenta elegida y guardada en la propia factura (su reparto, 0790) es su gasto. Sin esto se
    // quedaba en «le falta el tipo de gasto» aunque la ficha de la factura ya lo dijera.
    if (!gasto) gasto = cuentaDelReparto((f.supplier_invoice_expense ?? []) as Fila[])
    // D07b (Julio, 23/10): sin cuenta contable, al validarla se le crea la
    // siguiente libre de su rango y se guarda en su ficha (company_account_add,
    // que la enlaza); al mirarla, se dice cuál será. La tanda de pendientes no
    // crea cuentas: lo dice, como siempre.
    let cuentaNueva: { hoja: string; codigo: string } | null = null
    if (!cuentaProv && (soloFactura || ver)) {
      const hoja = hojaDelProveedor(gasto ?? (((f.supplier_invoice_line ?? []) as Fila[]).map((l) => s(l.expense_account_code)).find(Boolean) ?? null))
      const digitos = [...(ctx.codigos ?? [])].find((c) => /^\d+$/.test(c))?.length ?? 8
      const libre = siguienteLibre(hoja, digitos, ctx.codigos ?? new Set())
      if (libre && soloFactura && !ver) {
        const nombre = `${hoja === '4000' ? 'Proveedores' : 'Acreedores'} · ${s(prov.name) ?? 'proveedor'}`
        const nueva = await rpc<{ id: string; code: string }>('company_account_add', {
          p_company: companyId, p_hoja: hoja, p_nombre: nombre, p_plain_name: null, p_entity: 'supplier', p_entity_id: sup, p_quien_nombre: quien, p_source: 'manual',
        })
        cuentaProv = nueva.code
        cuentaNueva = { hoja, codigo: nueva.code }
      } else if (libre) {
        cuentaProv = libre
        cuentaNueva = { hoja, codigo: libre }
      }
    }
    // D01 · Sin «Sus facturas se apuntan en»: lo aprendido de sus facturas anteriores
    // (Diez o Folvy), con su porqué. Probable si fueron a varias cuentas.
    let deLoAprendido: Fila | null = null
    if (!gasto && cuentaProv) {
      if (!aprendido.has(sup)) aprendido.set(sup, await rpc<Fila>('conta_gasto_aprendido', { p_company: companyId, p_supplier: sup }).catch(() => null))
      deLoAprendido = aprendido.get(sup) ?? null
      if (deLoAprendido?.cuenta) gasto = String(deLoAprendido.cuenta)
    }
    const que = `Factura ${s(prov.name) ?? 'de proveedor'}${f.invoice_number ? ` · ${f.invoice_number}` : ''}`
    if (!cuentaProv) { r.sinPropuesta.push({ id: String(f.id), que, porque: 'El proveedor no tiene su cuenta (Contabilidad de su ficha).' }); continue }
    const rr = ret.find((x) => String(x.id) === s(f.withholding_rate_id))
    // I01d · La ficha dice cómo va su IVA: si lo declaras tú, la factura se autoliquida.
    const ficha: FichaIva = {
      pais: s(prov.country_code), tipoNif: s(prov.tax_id_type) as FichaIva['tipoNif'], nif: s(prov.tax_id),
      vies: s(prov.tax_id_check_status) as FichaIva['vies'], regimen: s(prov.vat_regime) as FichaIva['regimen'],
    }
    const clase = claseIva(ficha)
    const nombreProv = s(prov.name) ?? 'El proveedor'
    if (clase === 'ue_sin_nif_iva' && f.vat_non_deductible !== true) {
      r.sinPropuesta.push({ id: String(f.id), que, porque: `${nombreProv} es de ${nombrePais(ficha.pais)} y no tiene un NIF-IVA europeo válido: sin él su compra no es intracomunitaria. Ponlo en su ficha (se comprueba en VIES) y la factura se propone.` })
      continue
    }
    const tipoAuto = tipoDeLaClase(clase)
    // E05 · La factura de un lote (riders y flotas de Catcher): su emisor, su NIF,
    // su gasto por tipo y su reparto salen de la factura (lib: deLaFacturaDeLote).
    const tipoDe = (pct: number) => ctx.tipos.find((x) => x.rate === pct && x.code.startsWith('iva_')) ?? null
    const lote = f.source === 'lote' ? deLaFacturaDeLote(f, gasto, tipoDe, (id) => ctx.locales.get(id) ?? null) : null
    // D03 · 0790: el IVA por tipo de supplier_invoice_tax manda siempre que tenga filas (lo corregido en la ficha).
    // S01h · Un abono se arma como su factura, con los importes en positivo, y se le da la vuelta
    // abajo (comoAbono). Así no hay apuntes en negativo (journal_line_debe_o_haber).
    const abono = s(f.doc_kind) === 'credit_note' || n(f.grand_total) < 0
    const imp = (x: number) => (abono ? Math.abs(x) : x)
    const deLineas = ((f.supplier_invoice_line ?? []) as Fila[]).map((l) => {
      const t = tipoDe(n(l.vat_pct))
      return { base: imp(n(l.line_amount)), tipo: t ? { id: t.id, porcentaje: t.rate } : null, cuentaGasto: s(l.expense_account_code) ?? gasto }
    })
    const impuestos = ((f.supplier_invoice_tax ?? []) as Fila[]).map((x) => ({ porcentaje: n(x.vat_pct), base: imp(n(x.base)), cuota: imp(n(x.vat_amount)) }))
    const lc = lineasYCuotas(deLineas, impuestos, gasto, tipoDe, ((f.supplier_invoice_line ?? []) as Fila[]).some((l) => !!s(l.expense_account_code)))
    const res = facturaProveedor({
      id: String(f.id), numero: s(f.invoice_number), fecha, proveedor: lote?.proveedor ?? s(prov.name) ?? 'Proveedor', terceroId: partyPorProveedor.get(sup) ?? null,
      // Ficha completa (tablero 3b): una sola factura sin local guardado lleva el de su
      // recepción, el que la ficha enseña como PROPUESTO («el local sale de la recepción»).
      esSocio: socioPorProveedor.has(sup), tieneNif: lote?.tieneNif || !!s(prov.tax_id), localId: s(f.location_id) ?? (soloFactura ? localPropuesto ?? null : null), total: imp(n(f.grand_total)),
      // D01 · Una línea puede llevar su propia cuenta (la factura de comisión de una liquidación: comisión y anuncios).
      lineas: lote?.lineas ?? (f.source === 'liquidacion' ? deLineas : lc.lineas),
      ...(lote ? { cuotas: lote.cuotas, reparto: lote.reparto } : lc.cuotas ? { cuotas: lc.cuotas } : {}),
      ...(f.source === 'liquidacion' ? {
        cuotas: impuestos,
        marcaId: s(f.brand_id), faltaNumero: !s(f.invoice_number),
        porAclarar: (((f.reading as Fila | null)?.requisitos ?? []) as Fila[]).filter((x) => (x.id === 'solape' || x.id === 'cuadre') && x.ok === false).map((x) => String(x.texto)),
      } : {}),
      retencion: rr && f.withholding_amount !== null ? { tipoId: String(rr.id), porcentaje: n(rr.rate), base: 0, importe: imp(n(f.withholding_amount)), modelo: (String(rr.filed_in) as '111' | '115' | '123') } : null,
      ivaNoDeducible: f.vat_non_deductible === true,
      motivoNoDeducible: porQueNoDeducible(noDeducibles.get(String(f.id))?.motivo, noDeducibles.get(String(f.id))?.texto),
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
    if (!res.propuesta) { r.sinPropuesta.push({ id: String(f.id), que, porque: res.sinPropuesta ?? '' }); continue }
    if (abono) {
      const anula = s(f.corrects_invoice_id) ? `la ${s(((f.reading as Fila | null)?.factura as Fila | undefined)?.rectificaA) ?? 'factura que rectifica'}` : null
      res.propuesta = comoAbono(res.propuesta, (c) => { const h = plantillaDevolucion(c); return h ? ctx.hoja(h) : null }, anula)
    }
    if (cuentaNueva) {
      res.propuesta.razones.push({ decision: `Cuenta del proveedor: ${cuentaNueva.codigo} (nueva)`,
        porque: `${nombreProv} no tenía cuenta contable: ${ver ? 'al validar, le creo' : 'le he creado'} la siguiente libre de la ${cuentaNueva.hoja} (${cuentaNueva.hoja === '4000' ? 'proveedores' : 'acreedores'}) y queda en su ficha` })
    }
    if (avisoFecha) { res.propuesta.avisos.push(avisoFecha); res.propuesta.confianza = peor(res.propuesta.confianza, 'probable') }
    if (razonEntrada) {
      res.propuesta.razones.push({ decision: razonEntrada,
        porque: `Una factura recibida no se contabiliza antes del día en que entró: su IVA se deduce desde ese día, y así el asiento y su IVA caen en el mismo trimestre. Su fecha de factura (${fechaFactura.split('-').reverse().join('/')}) no cambia` })
    }
    if (clase === 'intracomunitaria' && ficha.vies !== 'valid') {
      res.propuesta.avisos.push(`El NIF-IVA de ${nombreProv} está sin comprobar en VIES: ábrelo en su ficha y se vuelve a preguntar.`)
      res.propuesta.confianza = peor(res.propuesta.confianza, 'probable')
    }
    const conRetencion = res.propuesta.lineas.find((x) => x.retencion && x.retencion.periodo === undefined)
    if (conRetencion?.retencion && conRetencion.retencion.periodo === undefined) {
      conRetencion.retencion = { ...conRetencion.retencion, base: res.propuesta.lineas.filter((x) => x.cuenta[0] === '6').reduce((t, x) => t + (abono ? x.haber : x.debe), 0) }
    }
    if (deLoAprendido?.cuenta) {
      res.propuesta.razones.push({ decision: `Gasto: ${s(deLoAprendido.nombre) ?? 'la cuenta'} · ${deLoAprendido.cuenta}`, porque: `${s(deLoAprendido.porque) ?? ''} (${s(deLoAprendido.origen) ?? 'aprendido'})` })
      if (deLoAprendido.confianza !== 'seguro') res.propuesta.confianza = peor(res.propuesta.confianza, 'probable')
    }
    // D03 · 0790: el gasto repartido y el asiento a mano de la ficha mandan sobre lo aprendido.
    const reparto = ((f.supplier_invoice_expense ?? []) as Fila[]).sort((a, b) => n(a.position) - n(b.position))
      .map((x) => ({ cuenta: String(x.account_code), local: s(x.location_id), comun: x.is_common === true, importe: n(x.amount) }))
    const aprendida = await aprender(companyId, res.propuesta, `supplier_invoice:${sup}`, ctx)
    const final = aplicarAsientoAMano(f.vat_non_deductible === true ? aprendida : aplicarReparto(aprendida, reparto), f.entry_overrides ?? null)
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

/**
 * D06 · La propuesta de cada factura recibida de un periodo (en revisión o aprobada), sin escribir nada:
 * la misma que enseña su ficha («El asiento que se crea»), para todas de una vez (validar en bloque).
 * Las que no tienen propuesta, con su porqué.
 */
export async function verPropuestasFacturas(accountId: string, companyId: string, desde: string, hasta: string): Promise<{
  propuestas: Map<string, Propuesta>; sinPropuesta: Map<string, string>; nombres: Map<string, string> }> {
  const ctx = await cargarContexto(accountId, companyId)
  const r: ResultadoProponer = { propuestas: 0, yaEstaban: 0, descartadas: 0, sinPropuesta: [], validadasSolas: 0, mesVentas: null, quedanDias: 0 }
  const propuestas = new Map<string, Propuesta>()
  await facturasDeProveedor(accountId, companyId, desde, hasta, ctx, r, null, (f) => diaAbierto(f, ctx.calendario), undefined, (p) => { if (p.origen.id) propuestas.set(p.origen.id, p) })
  const sinPropuesta = new Map(r.sinPropuesta.filter((x) => x.id).map((x) => [x.id!, x.porque]))
  const codigos = [...new Set([...propuestas.values()].flatMap((p) => p.lineas.map((l) => l.cuenta)))]
  const filas = codigos.length ? await leer(tabla('company_account').select('code, name').eq('company_id', companyId).in('code', codigos), 'los nombres de las cuentas') : []
  return { propuestas, sinPropuesta, nombres: new Map(filas.map((x) => [String(x.code), String(x.name)])) }
}

/** I01d · Por qué su IVA lo declaras tú, para la propuesta: «es de Francia y tiene NIF-IVA europeo…». */
function porqueAutoliquida(c: ClaseIva, pais: string | null): string {
  if (c === 'intracomunitaria') return `es de ${nombrePais(pais)} y tiene NIF-IVA europeo: su compra es intracomunitaria`
  if (c === 'isp_extranjero') return `es de fuera de la UE (${nombrePais(pais)}): su compra va con inversión del sujeto pasivo`
  return 'está marcado con inversión del sujeto pasivo en su ficha'
}
