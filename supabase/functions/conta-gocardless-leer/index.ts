// supabase/functions/conta-gocardless-leer/index.ts
//
// G01 · Tarea 3 (06/11/2026) · Leer la cuenta de GoCardless de una empresa
// emisora. SOLO LEE GoCardless (GET): nunca crea, cambia ni cobra nada allí.
//
//   · { accion: 'conectar', empresa, entorno, token } — una persona
//     (administradora o encargada de la cuenta) pega el token de solo lectura
//     una vez: se comprueba leyendo, se guarda en Vault y se hace la primera
//     lectura. No se vuelve a enseñar.
//   · { accion: 'leer', empresa } — «Leer ahora» (una persona) o la lectura
//     de cada noche (cabecera x-cron-secret = CRON_SECRET, sin sesión).
//
// Cada lectura: clientes, mandatos, suscripciones, cobros de los últimos 6
// meses (con el motivo de los fallidos) y la cuenta de abono; el casado con
// Bitrix24 de toda la cuenta; la importación, UNA vez, de cada suscripción
// activa de un cliente casado (línea, tarifa propia y servicio, o por qué
// no); y las diferencias, con su porqué como dato. La cuenta de demostración
// solo lee el entorno de pruebas (salida.ts).
//
// Núcleos puros (con sus pruebas en tests/unit/modules/conta/gestoria):
// lector.ts, casado.ts, conversion.ts, comparacion.ts y salida.ts.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import {
  abonoContraTesoreria, alMesCent, BASES, cabeceras, casarMotivos, COBRO_FALLIDO, desdeHaceMeses, leerCliente, leerCobro, leerCuentaAbono,
  leerMandato, leerSuscripcion, leerTodo, MANDATO_POR_FIRMAR, MANDATO_VIVO, urlDePagina, type Entorno, type Recurso,
} from './lector.ts'
import { casar, type ClienteParaCasar, type FichaParaCasar } from './casado.ts'
import { convertir } from './conversion.ts'
import { comparar, euros, type Linea, type Tarifa } from './comparacion.ts'
import { puedeLeer } from './salida.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const TIPOS_DEL_CASADO = ['bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix', 'nif_distinto']
const mesDe = (fecha: string | null | undefined): string => (fecha ?? new Date().toISOString()).slice(0, 7)
const primeroDe = (mes: string) => `${mes}-01`
const aEuros = (cent: number | null) => (cent === null ? null : Math.round(cent) / 100)
const enTrozos = <T>(xs: T[], n = 500): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out }

async function pedirGc(entorno: Entorno, token: string, recurso: Recurso, filtros: Record<string, string> = {}) {
  return await leerTodo<Record<string, unknown>>(recurso, async (despues) => {
    const r = await fetch(urlDePagina(entorno, recurso, filtros, despues), { headers: cabeceras(token) })
    const cuerpo = await r.json().catch(() => null)
    if (!r.ok) {
      const msg = (cuerpo as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`
      throw new Error(r.status === 401 || r.status === 403 ? `GoCardless no acepta el token (${msg}).` : `GoCardless ha contestado: ${msg}.`)
    }
    return cuerpo
  })
}

async function escribir(db: SupabaseClient, tabla: string, filas: Record<string, unknown>[], onConflict: string) {
  for (const trozo of enTrozos(filas)) {
    const { error } = await db.from(tabla).upsert(trozo, { onConflict })
    if (error) throw new Error(`No se ha podido guardar en ${tabla}: ${error.message}`)
  }
}

interface Resultado { frase: string; mandatosVivos: number; lineas: number; alMes: number; diferencias: number; convertidas: number; noConvertidas: number }

async function leer(db: SupabaseClient, empresa: string, por: 'persona' | 'cada_noche' | 'conexion', quien: string | null): Promise<Resultado> {
  const { data: sec, error: secErr } = await db.rpc('conta_gocardless_secreto', { p_company: empresa })
  if (secErr) throw new Error(`No se ha podido leer la conexión: ${secErr.message}`)
  const s = (sec as { account_id: string; entorno: Entorno; token: string }[] | null)?.[0]
  if (!s?.token) throw new Error('Esta empresa no tiene conectada su cuenta de GoCardless.')
  const cuenta = s.account_id
  const { data: emp } = await db.from('company').select('id, account_id, legal_name, trade_name').eq('account_id', cuenta)
  const nombres = new Map(((emp ?? []) as { id: string; legal_name: string | null; trade_name: string | null }[]).map((e) => [e.id, e.trade_name || e.legal_name || 'la empresa']))
  const nombreEmisor = (id: string) => nombres.get(id) ?? 'otro emisor'

  const { data: lect, error: lectErr } = await db.from('conta_gestoria_lectura')
    .insert({ account_id: cuenta, company_id: empresa, origen: 'gocardless', entorno: s.entorno, por, quien_name: quien }).select('id').single()
  if (lectErr) throw new Error(`No se ha podido apuntar la lectura: ${lectErr.message}`)
  const lectura = (lect as { id: string }).id
  const acabar = async (campos: Record<string, unknown>) => { await db.from('conta_gestoria_lectura').update({ acabada_at: new Date().toISOString(), ...campos }).eq('id', lectura) }

  const puerta = await puedeLeer(db, cuenta, s.entorno)
  if (!puerta.lee) { await acabar({ estado: 'no_lee', mensaje: puerta.porque }); return { frase: puerta.porque, mandatosVivos: 0, lineas: 0, alMes: 0, diferencias: 0, convertidas: 0, noConvertidas: 0 } }

  try {
    const hoy = new Date().toISOString().slice(0, 10)
    const desde = desdeHaceMeses(hoy, 6)
    const [rc, rm, rs, rp, re, ra] = await Promise.all([
      pedirGc(s.entorno, s.token, 'customers'),
      pedirGc(s.entorno, s.token, 'mandates'),
      pedirGc(s.entorno, s.token, 'subscriptions'),
      pedirGc(s.entorno, s.token, 'payments', { 'charge_date[gte]': desde }),
      pedirGc(s.entorno, s.token, 'events', { resource_type: 'payments', 'created_at[gte]': `${desde}T00:00:00Z` }),
      pedirGc(s.entorno, s.token, 'creditor_bank_accounts'),
    ])
    const clientes = rc.map(leerCliente)
    const mandatos = rm.map(leerMandato)
    const suscripciones = rs.map(leerSuscripcion)
    const cobros = casarMotivos(rp.map(leerCobro), re)
    const abonos = ra.map(leerCuentaAbono).filter((a) => a.activa)

    const clienteDeMandato = new Map(mandatos.filter((m) => m.clienteId).map((m) => [m.id, m.clienteId!]))
    const vivosDe = new Map<string, number>(); const activasDe = new Map<string, number>()
    for (const m of mandatos) if (m.clienteId && MANDATO_VIVO.includes(m.estado)) vivosDe.set(m.clienteId, (vivosDe.get(m.clienteId) ?? 0) + 1)
    const activas = suscripciones.filter((x) => x.estado === 'active')
    for (const x of activas) { const c = x.mandatoId ? clienteDeMandato.get(x.mandatoId) : undefined; if (c) activasDe.set(c, (activasDe.get(c) ?? 0) + 1) }

    // 1 · Lo leído, tal cual (con la huella de cada cliente: nuevos, cambiados, iguales).
    const { data: antes } = await db.from('conta_gc_cliente').select('gc_id, huella').eq('company_id', empresa)
    const huellaAntes = new Map(((antes ?? []) as { gc_id: string; huella: string | null }[]).map((x) => [x.gc_id, x.huella]))
    let nuevos = 0, cambiados = 0, iguales = 0
    const ahora = new Date().toISOString()
    const filasClientes = clientes.map((c) => {
      const huella = JSON.stringify([c.nombre, c.correo, c.nif, vivosDe.get(c.id) ?? 0, activasDe.get(c.id) ?? 0])
      const h0 = huellaAntes.get(c.id)
      if (h0 === undefined) nuevos++; else if (h0 !== huella) cambiados++; else iguales++
      return { company_id: empresa, gc_id: c.id, account_id: cuenta, nombre: c.nombre, correo: c.correo, nif: c.nif,
        mandatos_vivos: vivosDe.get(c.id) ?? 0, suscripciones_activas: activasDe.get(c.id) ?? 0, huella, leido_at: ahora }
    })
    await escribir(db, 'conta_gc_cliente', filasClientes, 'company_id,gc_id')
    await escribir(db, 'conta_gc_mandato', mandatos.map((m) => ({ company_id: empresa, gc_id: m.id, account_id: cuenta, gc_cliente_id: m.clienteId,
      estado: m.estado, referencia: m.referencia, esquema: m.esquema, creado: m.creado, leido_at: ahora })), 'company_id,gc_id')
    await escribir(db, 'conta_gc_suscripcion', suscripciones.map((x) => ({ company_id: empresa, gc_id: x.id, account_id: cuenta,
      gc_cliente_id: x.mandatoId ? clienteDeMandato.get(x.mandatoId) ?? null : null, mandato_gc_id: x.mandatoId, nombre: x.nombre,
      importe: aEuros(x.importeCent), moneda: x.moneda, intervalo: x.intervalo, cada: x.cada, estado: x.estado, al_mes: aEuros(alMesCent(x)),
      inicio: x.inicio, fin: x.fin, leido_at: ahora })), 'company_id,gc_id')
    await escribir(db, 'conta_gc_cobro', cobros.map((p) => ({ company_id: empresa, gc_id: p.id, account_id: cuenta, mandato_gc_id: p.mandatoId,
      suscripcion_gc_id: p.suscripcionId, estado: p.estado, fecha: p.fecha, importe: aEuros(p.importeCent), moneda: p.moneda, motivo: p.motivo, leido_at: ahora })), 'company_id,gc_id')

    // 2 · El casado con Bitrix24, de TODA la cuenta (las dos cuentas de GoCardless).
    const { data: fichasDb } = await db.from('conta_gestoria_cliente')
      .select('party_id, bitrix_id, situacion, forma_pago_bitrix, emisor_segun_bitrix, ficha, party:party_id(name, tax_id)').eq('account_id', cuenta)
    const fichas = ((fichasDb ?? []) as Record<string, unknown>[]).filter((f) => f.bitrix_id)
    const partyDeBitrix = new Map(fichas.map((f) => [String(f.bitrix_id), String(f.party_id)]))
    const paraCasar: FichaParaCasar[] = fichas.map((f) => {
      const party = (f.party ?? {}) as { name?: string; tax_id?: string | null }
      const ficha = (f.ficha ?? {}) as { correos?: string[] }
      return { bitrixId: String(f.bitrix_id), nombre: party.name ?? String(f.bitrix_id), nif: party.tax_id ?? null, correos: ficha.correos ?? [],
        situacion: (f.situacion as FichaParaCasar['situacion']) ?? null, formaPago: (f.forma_pago_bitrix as string | null) ?? null,
        emisorSegunBitrix: (f.emisor_segun_bitrix as string | null) ?? null }
    })
    const { data: gcCuenta } = await db.from('conta_gc_cliente').select('company_id, gc_id, nombre, nif, correo, mandatos_vivos, suscripciones_activas').eq('account_id', cuenta)
    const deTodos: ClienteParaCasar[] = ((gcCuenta ?? []) as Record<string, unknown>[]).map((c) => ({
      emisor: String(c.company_id), id: String(c.gc_id), nombre: String(c.nombre ?? c.gc_id), nif: (c.nif as string | null) ?? null,
      correo: (c.correo as string | null) ?? null, mandatosVivos: Number(c.mandatos_vivos ?? 0), suscripcionesActivas: Number(c.suscripciones_activas ?? 0) }))
    const casado = casar(paraCasar, deTodos, nombreEmisor)
    const partyDeCliente = new Map<string, string>()
    for (const p of casado.parejas.filter((x) => x.emisor === empresa)) {
      const party = partyDeBitrix.get(p.bitrixId)
      if (party) partyDeCliente.set(p.clienteGcId, party)
    }
    for (const [gc, party] of partyDeCliente) {
      const por = casado.parejas.find((x) => x.clienteGcId === gc && x.emisor === empresa)!.por
      await db.from('conta_gc_cliente').update({ party_id: party, casado_por: por }).eq('company_id', empresa).eq('gc_id', gc)
    }
    const { data: conex } = await db.from('conta_cobro_gocardless').select('por_defecto').eq('company_id', empresa).single()
    const { data: cobroAntes } = await db.from('conta_cobro_cliente').select('party_id, forma_cobro').eq('company_id', empresa)
    const formaAntes = new Map(((cobroAntes ?? []) as { party_id: string; forma_cobro: string | null }[]).map((x) => [x.party_id, x.forma_cobro]))
    await escribir(db, 'conta_cobro_cliente', [...partyDeCliente].map(([gc, party]) => ({
      company_id: empresa, party_id: party, account_id: cuenta, gc_cliente_id: gc,
      gc_casado_por: casado.parejas.find((x) => x.clienteGcId === gc && x.emisor === empresa)!.por,
      forma_cobro: formaAntes.get(party) ?? ((conex as { por_defecto?: boolean } | null)?.por_defecto === false ? null : 'gocardless'),
      updated_at: ahora, updated_by_name: 'GoCardless' })), 'company_id,party_id')

    // 3 · Los mandatos de los casados, también en conta_mandato (origen gocardless).
    const { data: mandatosSumied } = await db.from('conta_mandato').select('id, gc_mandato_id').eq('company_id', empresa).not('gc_mandato_id', 'is', null)
    const yaEsta = new Map(((mandatosSumied ?? []) as { id: string; gc_mandato_id: string }[]).map((m) => [m.gc_mandato_id, m.id]))
    for (const m of mandatos) {
      const party = m.clienteId ? partyDeCliente.get(m.clienteId) : undefined
      if (!party) continue
      const status = MANDATO_VIVO.includes(m.estado) ? 'firmado' : MANDATO_POR_FIRMAR.includes(m.estado) ? 'por_firmar' : 'anulado'
      const fila = { account_id: cuenta, company_id: empresa, party_id: party, ref: m.referencia ?? m.id, status, origen: 'gocardless', gc_mandato_id: m.id, gc_estado: m.estado,
        signed_at: status === 'firmado' ? m.creado : null, created_by_name: 'GoCardless' }
      const id = yaEsta.get(m.id)
      const { error } = id ? await db.from('conta_mandato').update(fila).eq('id', id) : await db.from('conta_mandato').insert(fila)
      if (error) throw new Error(`No se ha podido guardar el mandato ${m.id}: ${error.message}`)
    }

    // 4 · La importación, UNA vez: lo activo de los casados que aún no se importó.
    const { data: imp } = await db.from('conta_gc_importacion').select('suscripcion_gc_id').eq('company_id', empresa)
    const importadas = new Set(((imp ?? []) as { suscripcion_gc_id: string }[]).map((x) => x.suscripcion_gc_id))
    const porImportar = activas.filter((x) => !importadas.has(x.id) && x.mandatoId && partyDeCliente.has(clienteDeMandato.get(x.mandatoId) ?? ''))
    const conv = convertir(empresa, porImportar, clienteDeMandato)
    let convertidas = 0
    if (conv.servicios.length) {
      await escribir(db, 'conta_servicio', conv.servicios.map((v) => ({ account_id: cuenta, company_id: empresa, clave: v.clave, nombre: v.nombre,
        forma: v.forma, por_confirmar: v.porConfirmar, created_by_name: 'GoCardless' })), 'company_id,clave')
    }
    const { data: serv } = await db.from('conta_servicio').select('id, clave').eq('company_id', empresa)
    const servicioId = new Map(((serv ?? []) as { id: string; clave: string }[]).map((x) => [x.clave, x.id]))
    const { data: tarifasAntes } = await db.from('conta_tarifa').select('servicio_id, party_id').eq('company_id', empresa).not('party_id', 'is', null)
    const conTarifa = new Set(((tarifasAntes ?? []) as { servicio_id: string; party_id: string }[]).map((t) => `${t.party_id}|${t.servicio_id}`))
    for (const t of conv.tarifas) {
      const party = partyDeCliente.get(t.clienteGcId); const sid = servicioId.get(t.servicio)
      if (!party || !sid || conTarifa.has(`${party}|${sid}`)) continue
      const desdeMes = conv.lineas.filter((l) => l.clienteGcId === t.clienteGcId && l.servicio === t.servicio).map((l) => mesDe(l.desde)).sort()[0] ?? mesDe(null)
      const { error } = await db.from('conta_tarifa').insert({ account_id: cuenta, company_id: empresa, servicio_id: sid, party_id: party, importe: aEuros(t.importeCent),
        periodo: t.periodo, desde: primeroDe(desdeMes), origen: 'gocardless', motivo: 'Importada de lo que cobraba GoCardless', created_by_name: 'GoCardless' })
      if (error) throw new Error(`No se ha podido guardar una tarifa: ${error.message}`)
      conTarifa.add(`${party}|${sid}`)
    }
    for (const l of conv.lineas) {
      const party = partyDeCliente.get(l.clienteGcId)!; const sid = servicioId.get(l.servicio)!
      const { data: lin, error } = await db.from('conta_linea').insert({ account_id: cuenta, company_id: empresa, party_id: party, servicio_id: sid,
        detalle: l.detalle, empleado_nombre: l.empleado, origen: 'gocardless', importe_propio: aEuros(l.importePropioCent), periodo: l.periodo,
        desde: primeroDe(mesDe(l.desde)), suscripcion_gc_id: l.suscripcionId, created_by_name: 'GoCardless' }).select('id').single()
      if (error) throw new Error(`No se ha podido guardar la línea de ${l.suscripcionId}: ${error.message}`)
      await db.from('conta_gc_importacion').insert({ company_id: empresa, suscripcion_gc_id: l.suscripcionId, account_id: cuenta, gc_cliente_id: l.clienteGcId,
        party_id: party, nombre: porImportar.find((x) => x.id === l.suscripcionId)?.nombre ?? null, importe: aEuros(l.importeCent), resultado: 'linea',
        linea_id: (lin as { id: string }).id })
      convertidas++
    }
    if (conv.noConvertidas.length) {
      await escribir(db, 'conta_gc_importacion', conv.noConvertidas.map((n) => ({ company_id: empresa, suscripcion_gc_id: n.suscripcionId, account_id: cuenta,
        gc_cliente_id: n.clienteGcId, party_id: n.clienteGcId ? partyDeCliente.get(n.clienteGcId) ?? null : null, nombre: n.nombre,
        importe: aEuros(porImportar.find((x) => x.id === n.suscripcionId)?.importeCent ?? null), resultado: 'no_convertida',
        porque_codigo: n.codigo, porque: n.porque })), 'company_id,suscripcion_gc_id')
    }

    // 5 · Las diferencias de esta lectura, con su porqué como dato.
    type Dif = { tipo: string; porque_codigo: string; porque: string; party_id?: string | null; company_id?: string | null; bitrix_id?: string | null; gc_cliente_id?: string | null; datos?: Record<string, unknown> }
    const difs: Dif[] = casado.diferencias.map((d) => ({ tipo: d.tipo, porque_codigo: d.tipo, porque: d.porque, company_id: d.emisor, bitrix_id: d.bitrixId,
      gc_cliente_id: d.clienteGcId, party_id: d.bitrixId ? partyDeBitrix.get(d.bitrixId) ?? null : null, datos: { emisor: d.emisor, bitrix: d.bitrixId, gocardless: d.clienteGcId } }))
    const { data: sinConv } = await db.from('conta_gc_importacion').select('suscripcion_gc_id, gc_cliente_id, party_id, nombre, porque_codigo, porque')
      .eq('company_id', empresa).eq('resultado', 'no_convertida')
    for (const n of (sinConv ?? []) as Record<string, string | null>[]) {
      if (!activas.some((x) => x.id === n.suscripcion_gc_id)) continue
      difs.push({ tipo: 'suscripcion_sin_convertir', porque_codigo: n.porque_codigo ?? 'sin_convertir', porque: `«${n.nombre}»: ${n.porque}`, company_id: empresa,
        party_id: n.party_id, gc_cliente_id: n.gc_cliente_id, datos: { suscripcion: n.suscripcion_gc_id } })
    }
    for (const m of mandatos.filter((x) => MANDATO_POR_FIRMAR.includes(x.estado) && x.clienteId)) {
      difs.push({ tipo: 'mandato_por_firmar', porque_codigo: m.estado, porque: `El mandato ${m.referencia ?? m.id} está pendiente de la firma del cliente.`, company_id: empresa,
        party_id: partyDeCliente.get(m.clienteId!) ?? null, gc_cliente_id: m.clienteId, datos: { mandato: m.id } })
    }
    const fallidosDe = new Map<string, number>()
    for (const p of cobros) { const c = p.mandatoId ? clienteDeMandato.get(p.mandatoId) : undefined; if (c && COBRO_FALLIDO.includes(p.estado)) fallidosDe.set(c, (fallidosDe.get(c) ?? 0) + 1) }
    for (const [c, n] of fallidosDe) if (n >= 3) {
      difs.push({ tipo: 'falla_a_menudo', porque_codigo: 'tres_o_mas_fallos', porque: `${n} cobros fallidos en los últimos 6 meses.`, company_id: empresa,
        party_id: partyDeCliente.get(c) ?? null, gc_cliente_id: c, datos: { fallidos: n, desde } })
    }
    // Sumied frente a GoCardless, cliente a cliente (el mes de hoy).
    const mes = mesDe(hoy)
    const { data: lineasDb } = await db.from('conta_linea').select('id, company_id, party_id, servicio_id, detalle, empleado_nombre, importe_propio, periodo, desde, hasta, suscripcion_gc_id, servicio:servicio_id(nombre)').eq('company_id', empresa)
    const { data: tarifasDb } = await db.from('conta_tarifa').select('company_id, servicio_id, party_id, importe, periodo, desde, hasta').eq('company_id', empresa)
    const tarifas: Tarifa[] = ((tarifasDb ?? []) as Record<string, unknown>[]).filter((t) => t.periodo !== 'unidad').map((t) => ({ emisor: String(t.company_id),
      servicio: String(t.servicio_id), clienteId: (t.party_id as string | null) ?? null, importeCent: Math.round(Number(t.importe) * 100),
      periodo: t.periodo as 'mes' | 'anio', desde: String(t.desde).slice(0, 7), hasta: t.hasta ? String(t.hasta).slice(0, 7) : null }))
    for (const [gc, party] of partyDeCliente) {
      const lineas: Linea[] = ((lineasDb ?? []) as Record<string, unknown>[]).filter((l) => l.party_id === party && l.periodo !== 'unidad').map((l) => ({
        id: String(l.id), emisor: empresa, servicio: String(l.servicio_id), nombreServicio: String((l.servicio as { nombre?: string } | null)?.nombre ?? ''),
        detalle: (l.detalle as string | null) ?? null, empleado: (l.empleado_nombre as string | null) ?? null,
        importePropioCent: l.importe_propio === null ? null : Math.round(Number(l.importe_propio) * 100), periodo: l.periodo as 'mes' | 'anio',
        desde: String(l.desde).slice(0, 7), hasta: l.hasta ? String(l.hasta).slice(0, 7) : null, suscripcionId: (l.suscripcion_gc_id as string | null) ?? null }))
      const gcActivas = activas.filter((x) => x.mandatoId && clienteDeMandato.get(x.mandatoId) === gc && x.moneda === 'EUR')
        .map((x) => ({ id: x.id, emisor: empresa, nombre: x.nombre, alMesCent: alMesCent(x) ?? 0 }))
      const r = comparar(party, mes, lineas, tarifas, gcActivas)
      if (r.diferenciaCent !== 0) {
        difs.push({ tipo: 'totales_distintos', porque_codigo: r.diferenciaCent > 0 ? 'sumied_mas' : 'gocardless_mas',
          porque: `Sumied ${euros(r.sumiedCent)} y GoCardless ${euros(r.gocardlessCent)} al mes. ${r.explicaciones.join(' ')}`.trim(), company_id: empresa,
          party_id: party, gc_cliente_id: gc, datos: { mes, sumied: aEuros(r.sumiedCent), gocardless: aEuros(r.gocardlessCent), explicaciones: r.explicaciones } })
      }
    }
    // El banco de abono, contra la tesorería del emisor.
    const { data: tes } = await db.from('treasury_account').select('id, name, iban').eq('company_id', empresa).eq('kind', 'bank')
    const tesoreria = ((tes ?? []) as { id: string; name: string; iban: string | null }[]).map((t) => ({ id: t.id, nombre: t.name, iban: t.iban }))
    const abono = abonos[0] ?? null
    const casaAbono = abono ? abonoContraTesoreria(abono, tesoreria) : { coincide: false as const, porque: 'GoCardless no tiene ninguna cuenta de abono activa.' }
    if (!casaAbono.coincide) difs.push({ tipo: 'abono_en_otra_cuenta', porque_codigo: abono ? 'abono_no_casa' : 'sin_cuenta_de_abono', porque: casaAbono.porque,
      company_id: empresa, datos: { banco: abono?.banco ?? null, termina_en: abono?.terminaEn ?? null } })

    // Las de antes de esta empresa (y las del casado, que son de la cuenta) dejan de ser las vigentes.
    await db.from('conta_gestoria_diferencia').update({ vigente: false }).eq('account_id', cuenta).eq('vigente', true).eq('company_id', empresa)
    await db.from('conta_gestoria_diferencia').update({ vigente: false }).eq('account_id', cuenta).eq('vigente', true).in('tipo', TIPOS_DEL_CASADO)
    for (const trozo of enTrozos(difs)) {
      const { error } = await db.from('conta_gestoria_diferencia').insert(trozo.map((d) => ({ account_id: cuenta, lectura_id: lectura, company_id: d.company_id ?? null,
        party_id: d.party_id ?? null, bitrix_id: d.bitrix_id ?? null, gc_cliente_id: d.gc_cliente_id ?? null, tipo: d.tipo, porque_codigo: d.porque_codigo,
        porque: d.porque, datos: d.datos ?? {} })))
      if (error) throw new Error(`No se han podido guardar las diferencias: ${error.message}`)
    }

    // 6 · Lo que dice la tarjeta de la conexión.
    const mandatosVivos = mandatos.filter((m) => MANDATO_VIVO.includes(m.estado)).length
    const alMes = activas.filter((x) => x.moneda === 'EUR').reduce((t, x) => t + (alMesCent(x) ?? 0), 0)
    await db.from('conta_cobro_gocardless').update({ ultima_lectura_at: new Date().toISOString(), mandatos_vivos: mandatosVivos, lineas_activas: activas.length,
      al_mes: aEuros(alMes), abono: abono ?? null, abono_treasury_id: casaAbono.coincide ? casaAbono.tesoreriaId : null, abono_coincide: casaAbono.coincide,
      abono_porque: casaAbono.coincide ? null : casaAbono.porque, updated_at: new Date().toISOString() }).eq('company_id', empresa)
    const conDiferencias = new Set(difs.map((d) => d.party_id ?? d.gc_cliente_id ?? d.bitrix_id ?? d.tipo)).size
    const frase = `Leída la cuenta de GoCardless de ${nombreEmisor(empresa)}: ${mandatosVivos} mandatos activos y ${activas.length} líneas leídas (${euros(alMes)} al mes).` +
      ` ${convertidas} convertidas en línea, ${conv.noConvertidas.length} sin convertir; ${conDiferencias} con diferencias.`
    await acabar({ estado: 'bien', nuevos, cambiados, iguales, con_diferencias: conDiferencias, mensaje: frase })
    return { frase, mandatosVivos, lineas: activas.length, alMes: aEuros(alMes) ?? 0, diferencias: difs.length, convertidas, noConvertidas: conv.noConvertidas.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await acabar({ estado: 'mal', mensaje: msg })
    throw e
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let cuerpo: Record<string, unknown> = {}
  try { cuerpo = await req.json() } catch { /* sin cuerpo */ }
  const empresa = String(cuerpo.empresa ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) return json(400, { error: 'Falta la empresa.' })

  // ¿Quién llama? El cron (con su secreto) o una persona de la cuenta.
  const secreto = Deno.env.get('CRON_SECRET') ?? ''
  const esCron = secreto !== '' && req.headers.get('x-cron-secret') === secreto
  let quien: string | null = null
  if (!esCron) {
    const auth = req.headers.get('Authorization') ?? ''
    const persona = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
    const { data: u } = await persona.auth.getUser()
    if (!u?.user) return json(401, { error: 'Hay que entrar para leer GoCardless.' })
    const { data: co } = await admin.from('company').select('account_id').eq('id', empresa).maybeSingle()
    if (!co) return json(404, { error: 'La empresa no existe.' })
    const { data: puede } = await persona.rpc('current_user_is_admin_or_manager_of', { p_account_id: (co as { account_id: string }).account_id })
    if (puede !== true) return json(403, { error: 'Solo un administrador o un encargado de la cuenta conecta o lee GoCardless.' })
    const { data: perfil } = await admin.from('user_profiles').select('display_name').eq('user_id', u.user.id).eq('account_id', (co as { account_id: string }).account_id).maybeSingle()
    quien = (perfil as { display_name?: string } | null)?.display_name ?? u.user.email ?? 'Una persona'
  }

  try {
    if (cuerpo.accion === 'conectar') {
      if (esCron) return json(403, { error: 'Conectar lo hace una persona.' })
      const entorno = cuerpo.entorno === 'pruebas' ? 'pruebas' : cuerpo.entorno === 'real' ? 'real' : null
      const token = String(cuerpo.token ?? '').trim()
      if (!entorno) return json(400, { error: 'Di si es la cuenta real o la de pruebas (sandbox).' })
      if (!token) return json(400, { error: 'Pega el token de solo lectura (GoCardless › Developers › Create › Access token, de solo lectura).' })
      // Se comprueba leyendo antes de guardar nada.
      const r = await fetch(`${BASES[entorno]}/creditors?limit=1`, { headers: cabeceras(token) })
      if (!r.ok) return json(400, { error: r.status === 401 || r.status === 403 ? `GoCardless no acepta ese token en ${entorno === 'real' ? 'la cuenta real' : 'pruebas (sandbox)'}.` : `GoCardless ha contestado ${r.status}.` })
      const { error } = await admin.rpc('conta_gocardless_guardar_conexion', { p_company: empresa, p_entorno: entorno, p_token: token, p_quien: quien })
      if (error) return json(400, { error: error.message })
      const res = await leer(admin, empresa, 'conexion', quien)
      return json(200, { ok: true, ...res, frase: res.frase.replace(/^Leída/, 'Conectada') })
    }
    if (cuerpo.accion === 'leer') {
      const res = await leer(admin, empresa, esCron ? 'cada_noche' : 'persona', quien)
      return json(200, { ok: true, ...res })
    }
    return json(400, { error: 'Acción: conectar o leer.' })
  } catch (e) {
    // En el registro, el qué y no los datos (T11): nunca el token.
    console.error('[conta-gocardless-leer]', e instanceof Error ? e.message : String(e))
    return json(500, { error: e instanceof Error ? e.message : 'No se ha podido leer GoCardless.' })
  }
})
