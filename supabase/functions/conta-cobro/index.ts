// supabase/functions/conta-cobro/index.ts
//
// G05 · Tarea 3 (09/11/2026) · EL COBRO DEL MES: preparar los recibos y
// enviarlos a GoCardless. Lo llama «Revisar el cobro» con la sesión de una
// persona (administrador o encargado de la cuenta).
//
//   · { accion: 'preparar', empresa, mes }: el SERVIDOR calcula el recibo de
//     cada cliente que paga por domiciliación, con los núcleos de _shared/cobro
//     (el cálculo único del G04) y los datos que ve esa persona
//     (conta_pantalla_clientes), y los guarda (conta_cobro_guardar). Lo que
//     se cobra nunca viene del navegador. El mes anterior: el recibo guardado
//     o, si aún no hay, lo que cobraba GoCardless (la prueba previa de QBO).
//   · { accion: 'enviar', empresa, mes }: cada recibo aprobado, un cobro en
//     GoCardless contra su mandato, con la clave del recibo para no repetir
//     (POST /payments). SOLO con una conexión del entorno de PRUEBAS (sandbox)
//     mientras Julio no encienda otra cosa (ENVIAR_A_REAL), y por la puerta de
//     las demos (_shared/puertaDePruebas.ts). En pruebas el cargo va «lo antes
//     posible», para ver el flujo entero en la demo; en real, con su fecha.
//   · { accion: 'seguir', empresa }: poner al día los recibos con lo leído de
//     GoCardless (lo hace también conta-gocardless-leer después de cada lectura).
//   · { accion: 'cambiar_cuenta', empresa, cliente, mandato } (G05 · nº 55): lo
//     llama el servidor del portal (Code 3) con la clave de servicio cuando la
//     domiciliación nueva del cliente está activa. Comprueba en GoCardless que
//     lo está, cancela las viejas (solo con una conexión de pruebas, como
//     enviar) y guarda el cambio (conta_cobro_cuenta_cambiada): los recibos
//     siguientes van contra la nueva.
//
// Nunca se cobra en el GoCardless real de QBO: su conexión es real, de solo
// lectura, y aquí no se envía a real. En el registro, nunca el token (T11).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { cuentaPuedeSalir } from '../_shared/puerta.ts'
import { salirA } from '../_shared/puertaDePruebas.ts'
import { catalogoYAsignaciones } from '../_shared/cobro/datos.ts'
import { claveDelRecibo, mesAnterior, prepararRecibo, type LineaDeRecibo, type Recibo, type ReciboAnterior } from '../_shared/cobro/recibo.ts'
import { facturaDelRecibo, type Fiscal } from '../_shared/cobro/factura.ts'
import { gocardlessEnElMes, leerCancelacion, leerMandatoNuevo, leerRespuestaDeCobro, mandatoParaCobrar, mandatosACancelar, peticionDeCobro, type SuscripcionGuardada } from '../_shared/cobro/gocardless.ts'
import { euros, type Mes } from '../_shared/tarifa/precio.ts'
import type { Situacion } from '../_shared/tarifa/lista.ts'
import { BASES, cabeceras, type Entorno } from '../conta-gocardless-leer/lector.ts'
import { jsPDF } from 'npm:jspdf@4.2.1'
import { rematarFacturasDeRecibos } from '../_shared/cobro/facturaRecibo.ts'
import { modulosQr } from '../_shared/verifactu/qrServidor.ts'

/** Mientras Julio no lo encienda, el cobro solo se envía con una conexión de pruebas (sandbox). */
const ENVIAR_A_REAL = false
export const SOLO_PRUEBAS = 'Por ahora el cobro solo se envía con una conexión de pruebas de GoCardless (el sandbox). Con la cuenta real no se cobra nada.'

type Fila = Record<string, unknown>
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f-]{36}$/i
const MES = /^\d{4}-(0[1-9]|1[0-2])$/
const cent = (v: unknown) => Math.round(Number(v ?? 0) * 100)
const filas = (x: unknown): Fila[] => (Array.isArray(x) ? (x as Fila[]) : [])

/** Los recibos de un mes de una empresa, calculados aquí con los datos que ve la persona. */
function calcular(d: Fila, empresa: string, mes: Mes, anteriores: Map<string, ReciboAnterior>, fiscal: Fiscal, suscripciones: Map<string, SuscripcionGuardada[]>) {
  const { catalogo, asignaciones } = catalogoYAsignaciones({
    servicios: filas(d.servicios), precios: filas(d.precios), asignaciones: filas(d.asignaciones), niveles: filas(d.niveles),
    paquetes: filas(d.paquetes), lineasDePaquete: filas(d.lineas_de_paquete), ajustes: filas(d.ajustes).filter((a) => a.company_id === empresa),
  })
  const recibos: Fila[] = []
  const sinRecibo: Fila[] = []
  for (const c of filas(d.clientes)) {
    if (c.empresa_id !== empresa) continue
    // Solo los que pagan por domiciliación en GoCardless: es lo que se cobra aquí.
    if (c.forma_de_cobro !== 'gocardless' && !c.cliente_en_gocardless) continue
    const clienteId = String(c.cliente_id)
    const guardado = anteriores.get(clienteId) ?? null
    // nº 70 · Lo que GoCardless le cobra EN este mes: las mensuales, y la anual solo en su mes (no entre doce).
    const gcCliente = c.cliente_en_gocardless ? String(c.cliente_en_gocardless) : null
    const alMesGc = gcCliente ? gocardlessEnElMes(suscripciones.get(gcCliente) ?? [], mes) : null
    const anterior: ReciboAnterior | null = guardado ?? (alMesGc ? { mes: mesAnterior(mes), totalCent: alMesGc, lineas: [], deGoCardless: true } : null)
    const r = prepararRecibo({ catalogo, asignaciones, clienteId, empresaId: empresa, mes, situacionElDia1: (c.situacion as Situacion) ?? null, anterior })
    if (!r.hay) {
      // «No entran»: solo los que importan este mes (se cobraban o deberían cobrarse), no todas las bajas de siempre.
      const seCobraba = !!guardado || !!alMesGc
      const sinCuota = r.porque.startsWith('No tiene nada que cobrar')
      if (seCobraba || sinCuota) sinRecibo.push({ cliente_id: clienteId, cliente: String(c.cliente ?? ''), porque: sinCuota ? 'Activa en el CRM, pero sin cuota en Sumied.' : `${r.porque}.`, boton: sinCuota ? 'Ponerle la cuota' : 'Ver la ficha' })
      continue
    }
    const recibo: Recibo = r.recibo
    const mandato = mandatoParaCobrar((c.mandato as string | null) ?? null)
    if (!mandato.vale) recibo.parado.push(mandato.porque)
    let factura = null
    let cobrar: number | null = null
    if (!recibo.parado.length) {
      const fa = facturaDelRecibo(recibo, fiscal)
      factura = fa
      cobrar = fa.totalCent
      // nº 62 · Una cuota ajustada en un céntimo no es un cambio: el cliente paga lo mismo.
    }
    recibos.push({
      clave: claveDelRecibo(empresa, clienteId, mes), party_id: clienteId, lineas: recibo.lineas, total_cent: recibo.totalCent,
      anterior_cent: recibo.anteriorCent, anterior_de_gocardless: !!anterior?.deGoCardless, cambios: recibo.cambios, pide_clic: recibo.pideClic,
      parado: recibo.parado, factura, cobrar_cent: cobrar,
    })
  }
  return { recibos, sinRecibo }
}

/**
 * nº 55 · Cambiar de cuenta: la domiciliación nueva tiene que estar activa en
 * GoCardless; se cancelan las viejas del cliente (solo con una conexión de
 * pruebas, como «enviar», y por la puerta de las demos) y se guarda el cambio.
 */
// deno-lint-ignore no-explicit-any
async function cambiarCuenta(admin: any, empresa: string, cuenta: string, cuerpo: Fila): Promise<Response> {
  const cliente = String(cuerpo.cliente ?? ''), nuevo = String(cuerpo.mandato ?? '').trim()
  const quien = typeof cuerpo.quien === 'string' ? cuerpo.quien.slice(0, 120) : 'El cliente, desde el portal'
  if (!UUID.test(cliente)) return json(400, { error: 'Falta el cliente.' })
  if (!/^[A-Z0-9]{2,40}$/i.test(nuevo)) return json(400, { error: 'Falta el mandato nuevo.' })
  try {
    const { data: sec, error: e1 } = await admin.rpc('conta_gocardless_secreto', { p_company: empresa })
    if (e1) throw new Error(`No se ha podido leer la conexión: ${e1.message}`)
    const s = (sec as { entorno: Entorno; token: string }[] | null)?.[0]
    if (!s?.token) return json(400, { error: 'Esta empresa no tiene conectada su cuenta de GoCardless.' })
    if (s.entorno !== 'pruebas' && !ENVIAR_A_REAL) return json(400, { error: 'Por ahora la cuenta de cargo solo se cambia con una conexión de pruebas de GoCardless (el sandbox). En la cuenta real no se cancela nada.' })
    const puerta = salirA(!(await cuentaPuedeSalir(admin, cuenta)), s.entorno)
    if (!puerta.sale) return json(400, { error: puerta.porque })
    // 1 · La nueva, activa en GoCardless.
    const rm = await fetch(`${BASES[s.entorno]}/mandates/${encodeURIComponent(nuevo)}`, { headers: cabeceras(s.token) })
    const m = leerMandatoNuevo(await rm.json().catch(() => null))
    if (!m.vale) return json(409, { error: m.porque })
    // 2 · Las viejas: las vivas de su cliente de GoCardless de antes y del de ahora, menos la nueva.
    const { data: cc } = await admin.from('conta_cobro_cliente').select('gc_cliente_id').eq('company_id', empresa).eq('party_id', cliente).maybeSingle()
    if (!cc) return json(404, { error: 'Ese cliente no se cobra en esta empresa.' })
    const antes = (cc as Fila).gc_cliente_id ? String((cc as Fila).gc_cliente_id) : null
    const { data: gm, error: e2 } = await admin.from('conta_gc_mandato').select('gc_id, gc_cliente_id, estado').eq('company_id', empresa)
      .in('gc_cliente_id', [antes, m.cliente].filter(Boolean))
    if (e2) throw new Error(`No se han podido leer los mandatos: ${e2.message}`)
    const viejos = mandatosACancelar(((gm ?? []) as Fila[]).map((x) => ({ gcId: String(x.gc_id), gcCliente: x.gc_cliente_id ? String(x.gc_cliente_id) : null, estado: x.estado ? String(x.estado) : null })), antes, m.cliente, nuevo)
    const cancelados: string[] = []
    for (const v of viejos) {
      const r = await fetch(`${BASES[s.entorno]}/mandates/${encodeURIComponent(v)}/actions/cancel`, {
        method: 'POST', headers: { ...cabeceras(s.token), 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { metadata: { motivo: 'cuenta_cambiada_portal' } } }),
      })
      const c = leerCancelacion(r.status, await r.json().catch(() => null))
      if (!c.cancelado) return json(502, { error: `No se ha podido cancelar en GoCardless la domiciliación vieja (${v}): ${c.porque}. No se ha cambiado nada en Sumied.`, cancelados })
      cancelados.push(v)
    }
    // 3 · El cambio, guardado: los recibos siguientes van contra la nueva.
    const { data, error } = await admin.rpc('conta_cobro_cuenta_cambiada', { p_company: empresa, p_party: cliente, p_mandato_nuevo: nuevo, p_cliente_gc: m.cliente, p_cancelados: cancelados, p_quien: quien })
    if (error) throw new Error(error.message)
    return json(200, { ok: true, ...(data as Fila) })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let cuerpo: Fila = {}
  try { cuerpo = await req.json() } catch { /* sin cuerpo */ }
  const empresa = String(cuerpo.empresa ?? '')
  const mes = String(cuerpo.mes ?? '')
  const accion = String(cuerpo.accion ?? '')
  if (!UUID.test(empresa)) return json(400, { error: 'Falta la empresa.' })

  const { data: co } = await admin.from('company').select('account_id, legal_name, trade_name').eq('id', empresa).maybeSingle()
  if (!co) return json(404, { error: 'La empresa no existe.' })
  const cuenta = String((co as Fila).account_id)
  const nombreEmpresa = String((co as Fila).trade_name || (co as Fila).legal_name || 'la empresa')

  // ¿Quién llama? El cron (solo para «seguir») o una persona administradora o encargada de la cuenta.
  const secreto = Deno.env.get('CRON_SECRET') ?? ''
  const esCron = secreto !== '' && req.headers.get('x-cron-secret') === secreto
  // nº 55 · El servidor del portal (Code 3), con la clave de servicio: solo para «cambiar_cuenta».
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const esServidor = servicio !== '' && req.headers.get('Authorization') === `Bearer ${servicio}`
  if (accion === 'cambiar_cuenta') {
    if (!esServidor) return json(403, { error: 'Cambiar la cuenta de cargo lo pide el servidor del portal.' })
    return await cambiarCuenta(admin, empresa, cuenta, cuerpo)
  }
  const persona = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
  let quien = 'Sumied'
  let quienId: string | null = null
  if (!esCron) {
    const { data: u } = await persona.auth.getUser()
    if (!u?.user) return json(401, { error: 'Hay que entrar para preparar o enviar el cobro.' })
    const { data: puede } = await persona.rpc('current_user_is_admin_or_manager_of', { p_account_id: cuenta })
    if (puede !== true) return json(403, { error: 'Solo un administrador o un encargado de la cuenta prepara o envía el cobro.' })
    const { data: perfil } = await admin.from('user_profiles').select('display_name').eq('user_id', u.user.id).eq('account_id', cuenta).maybeSingle()
    quien = (perfil as { display_name?: string } | null)?.display_name ?? 'Una persona de la cuenta'
    quienId = u.user.id
  } else if (accion !== 'seguir') {
    return json(403, { error: 'Preparar y enviar el cobro lo hace una persona.' })
  }

  try {
    if (accion === 'seguir') {
      const { data, error } = await admin.rpc('conta_cobro_seguir', { p_company: empresa })
      if (error) throw new Error(error.message)
      // G05 · T4 · Las facturas emitidas: su PDF (adjunto a la factura y a su asiento) y su envío al cliente.
      const rem = await rematarFacturasDeRecibos(admin, empresa, { jsPDF, qr: modulosQr, correo: { resendKey: Deno.env.get('RESEND_API_KEY'),
        buzonDePruebas: Deno.env.get('CORREO_BUZON_PRUEBAS'), abiertos: Deno.env.get('CORREO_MARCA_ABIERTOS') } })
      return json(200, { ok: true, ...(data as Fila), facturas: rem })
    }
    if (!MES.test(mes)) return json(400, { error: 'Falta el mes (AAAA-MM).' })

    if (accion === 'preparar') {
      const { data: d, error: e1 } = await persona.rpc('conta_pantalla_clientes', { p_cuenta: cuenta })
      if (e1) throw new Error(`No se han podido leer los clientes: ${e1.message}`)
      const { data: aj, error: e2 } = await admin.rpc('_conta_cobro_ajustes', { p_company: empresa })
      if (e2) throw new Error(`No se han podido leer los ajustes del cobro: ${e2.message}`)
      const a = aj as Fila
      const fiscal: Fiscal = { ivaPct: Number(a.iva_pct), retencionPct: Number(a.retencion_pct), preciosConIva: a.precios_con_iva !== false }
      const { data: antes, error: e3 } = await admin.from('conta_recibo').select('party_id, mes, total_cent, lineas').eq('company_id', empresa).eq('mes', mesAnterior(mes))
      if (e3) throw new Error(`No se han podido leer los recibos del mes anterior: ${e3.message}`)
      const anteriores = new Map((antes ?? []).map((r: Fila) => [String(r.party_id), { mes: String(r.mes), totalCent: Number(r.total_cent), lineas: (r.lineas as LineaDeRecibo[]) ?? [] }]))
      const { data: subs, error: e4 } = await admin.from('conta_gc_suscripcion').select('gc_cliente_id, importe, intervalo, cada, estado, inicio, proximo_cobro_fecha')
        .eq('company_id', empresa).eq('account_id', cuenta).eq('estado', 'active')
      if (e4) throw new Error(`No se han podido leer las suscripciones de GoCardless: ${e4.message}`)
      const suscripciones = new Map<string, SuscripcionGuardada[]>()
      for (const x of (subs ?? []) as Fila[]) {
        if (!x.gc_cliente_id) continue
        const k = String(x.gc_cliente_id)
        suscripciones.set(k, [...(suscripciones.get(k) ?? []), { importeCent: cent(x.importe), intervalo: String(x.intervalo ?? ''), cada: Number(x.cada ?? 1), estado: String(x.estado ?? ''), proximoCobro: (x.proximo_cobro_fecha as string | null) ?? null, inicio: (x.inicio as string | null) ?? null }])
      }
      const { recibos, sinRecibo } = calcular((d ?? {}) as Fila, empresa, mes, anteriores, fiscal, suscripciones)
      const { data, error } = await admin.rpc('conta_cobro_guardar', { p_company: empresa, p_mes: mes, p_recibos: recibos, p_sin_recibo: sinRecibo, p_quien: quien })
      if (error) throw new Error(error.message)
      return json(200, { ok: true, ...(data as Fila) })
    }

    if (accion === 'enviar') {
      const { data: sec, error: e1 } = await admin.rpc('conta_gocardless_secreto', { p_company: empresa })
      if (e1) throw new Error(`No se ha podido leer la conexión: ${e1.message}`)
      const s = (sec as { entorno: Entorno; token: string }[] | null)?.[0]
      if (!s?.token) return json(400, { error: 'Esta empresa no tiene conectada su cuenta de GoCardless.' })
      if (s.entorno !== 'pruebas' && !ENVIAR_A_REAL) return json(400, { error: SOLO_PRUEBAS })
      const esDemo = !(await cuentaPuedeSalir(admin, cuenta))
      const puerta = salirA(esDemo, s.entorno)
      if (!puerta.sale) return json(400, { error: puerta.porque })
      const { data: lista, error: e2 } = await admin.rpc('conta_cobro_para_enviar', { p_company: empresa, p_mes: mes })
      if (e2) throw new Error(e2.message)
      let enviados = 0; let euroCent = 0
      const fallos: string[] = []
      for (const x of (lista ?? []) as Fila[]) {
        const id = String(x.id)
        if (!x.mandato_gc_id) { await admin.rpc('conta_cobro_no_enviado', { p_recibo: id, p_frase: 'Sin mandato SEPA que cobre en GoCardless: no se ha enviado.', p_por_name: quien }); fallos.push('sin mandato'); continue }
        const recibo = { clave: String(x.clave), mes, totalCent: Number(x.total_cent), parado: [] as string[] } as unknown as Recibo
        let p
        try {
          // En pruebas, «lo antes posible»: la demo ve el cobro entero sin esperar al día de cargo.
          p = peticionDeCobro(recibo, Number(x.cobrar_cent), String(x.mandato_gc_id), s.entorno === 'pruebas' ? null : (x.cargo_el ? String(x.cargo_el) : null), `Servicios de ${nombreEmpresa}`)
        } catch (e) {
          await admin.rpc('conta_cobro_no_enviado', { p_recibo: id, p_frase: e instanceof Error ? e.message : String(e), p_por_name: quien }); fallos.push('no cuadra'); continue
        }
        let respuesta = null
        for (let intento = 0; intento < 2; intento++) {
          const r = await fetch(`${BASES[s.entorno]}${p.ruta}`, {
            method: 'POST', body: JSON.stringify(p.cuerpo),
            headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...p.cabeceras },
          })
          respuesta = leerRespuestaDeCobro(r.status, await r.json().catch(() => ({})))
          if (respuesta.tipo !== 'reintentar') break
        }
        if (respuesta && (respuesta.tipo === 'creado' || respuesta.tipo === 'ya_estaba')) {
          const { error } = await admin.rpc('conta_cobro_enviado', {
            p_recibo: id, p_gc_cobro: respuesta.cobroId, p_gc_estado: respuesta.tipo === 'creado' ? respuesta.estado : null,
            p_cargo_el: respuesta.tipo === 'creado' ? respuesta.cargoEl : null, p_mandato: String(x.mandato_gc_id), p_entorno: s.entorno, p_por: quienId, p_por_name: quien,
          })
          if (error) { fallos.push(error.message); continue }
          enviados++; euroCent += Number(x.cobrar_cent)
        } else if (respuesta) {
          await admin.rpc('conta_cobro_no_enviado', { p_recibo: id, p_frase: respuesta.frase, p_por_name: quien })
          fallos.push(respuesta.frase)
          if (respuesta.tipo === 'solo_lectura') break
        }
      }
      const frase = `Enviados ${enviados} ${enviados === 1 ? 'cobro' : 'cobros'} a GoCardless por ${euros(euroCent)}.`
        + (fallos.length ? ` ${fallos.length} no se ${fallos.length === 1 ? 'ha' : 'han'} podido enviar: está dicho en su recibo.` : '')
        + ' No hay factura hasta que cada cobro se confirme.'
      return json(200, { ok: true, enviados, euros_cent: euroCent, fallos: fallos.length, frase })
    }
    return json(400, { error: 'Acción: preparar, enviar o seguir.' })
  } catch (e) {
    console.error('[conta-cobro]', e instanceof Error ? e.message : String(e))
    return json(500, { error: e instanceof Error ? e.message : 'No se ha podido hacer el cobro.' })
  }
})
