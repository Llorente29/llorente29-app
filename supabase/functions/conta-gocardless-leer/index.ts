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
// Aquí solo se lee y se escribe la base: QUÉ se escribe lo deciden los
// núcleos puros, con sus pruebas (tests/unit/modules/conta/gestoria):
// lectura.ts (lo que se pide a GoCardless), plan.ts (lo que se escribe y las
// diferencias), lector, casado, conversion, comparacion y salida.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { type Entorno } from './lector.ts'
import { comprobarToken, leerCuentaGc } from './lectura.ts'
import { aEuros, fraseDeLectura, planDiferencias, planLectura, TIPOS_DEL_CASADO, type Antes } from './plan.ts'
import type { Linea, Tarifa } from './comparacion.ts'
import type { FichaParaCasar } from './casado.ts'
import { puedeLeer } from './salida.ts'
import { refDeFicha } from '../_shared/crm/ficha.ts'
import { jsPDF } from 'npm:jspdf@4.2.1'
import { rematarFacturasDeRecibos } from '../_shared/cobro/facturaRecibo.ts'
import { modulosQr } from '../_shared/verifactu/qrServidor.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const enTrozos = <T>(xs: T[], n = 500): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out }
const mes = (d: unknown) => String(d).slice(0, 7)

async function upsert(db: SupabaseClient, tabla: string, filas: Record<string, unknown>[], onConflict: string) {
  for (const trozo of enTrozos(filas)) {
    const { error } = await db.from(tabla).upsert(trozo, { onConflict })
    if (error) throw new Error(`No se ha podido guardar en ${tabla}: ${error.message}`)
  }
}
async function leerFilas<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new Error(`No se ha podido leer ${que}: ${error.message}`)
  return (data ?? []) as T[]
}

async function leer(db: SupabaseClient, empresa: string, por: 'persona' | 'cada_noche' | 'conexion' | 'aviso', quien: string | null) {
  const { data: sec, error: secErr } = await db.rpc('conta_gocardless_secreto', { p_company: empresa })
  if (secErr) throw new Error(`No se ha podido leer la conexión: ${secErr.message}`)
  const s = (sec as { account_id: string; entorno: Entorno; token: string }[] | null)?.[0]
  if (!s?.token) throw new Error('Esta empresa no tiene conectada su cuenta de GoCardless.')
  const cuenta = s.account_id
  const empresas = await leerFilas<{ id: string; legal_name: string | null; trade_name: string | null }>(
    db.from('company').select('id, legal_name, trade_name').eq('account_id', cuenta), 'las empresas')
  const nombres = new Map(empresas.map((e) => [e.id, e.trade_name || e.legal_name || 'la empresa']))
  const nombreEmisor = (id: string) => nombres.get(id) ?? 'otro emisor'

  const { data: lect, error: lectErr } = await db.from('conta_gestoria_lectura')
    .insert({ account_id: cuenta, company_id: empresa, origen: 'gocardless', entorno: s.entorno, por, quien_name: quien }).select('id').single()
  if (lectErr) throw new Error(`No se ha podido apuntar la lectura: ${lectErr.message}`)
  const lectura = (lect as { id: string }).id
  const acabar = (campos: Record<string, unknown>) => db.from('conta_gestoria_lectura').update({ acabada_at: new Date().toISOString(), ...campos }).eq('id', lectura)

  const puerta = await puedeLeer(db, cuenta, s.entorno)
  if (!puerta.lee) { await acabar({ estado: 'no_lee', mensaje: puerta.porque }); return { frase: puerta.porque, lee: false } }

  try {
    const hoy = new Date().toISOString().slice(0, 10)
    const datos = await leerCuentaGc(fetch, s.entorno, s.token, hoy)

    // Lo que ya hay en Sumied.
    const huellas = await leerFilas<{ gc_id: string; huella: string | null }>(db.from('conta_gc_cliente').select('gc_id, huella').eq('company_id', empresa), 'lo leído antes')
    const fichasDb = await leerFilas<Record<string, unknown>>(db.from('conta_gestoria_cliente')
      .select('party_id, crm, tipo_ficha, id_externo, situacion, forma_pago_crm, emisor_segun_crm, ficha, party:party_id(name, tax_id)').eq('account_id', cuenta), 'las fichas del CRM')
    // G01c · Cada ficha por su referencia neutra (CRM, tipo e id): una empresa y un contacto pueden tener el mismo id.
    const fichas: Antes['fichas'] = fichasDb.filter((f) => f.id_externo).map((f) => {
      const party = (f.party ?? {}) as { name?: string; tax_id?: string | null }
      const ficha = (f.ficha ?? {}) as { correos?: string[] }
      return { partyId: String(f.party_id), claveFicha: refDeFicha(String(f.crm), f.tipo_ficha as 'empresa' | 'contacto', String(f.id_externo)), nombre: party.name ?? String(f.id_externo), nif: party.tax_id ?? null,
        correos: ficha.correos ?? [], situacion: (f.situacion as FichaParaCasar['situacion']) ?? null,
        formaPago: (f.forma_pago_crm as string | null) ?? null, emisorSegunCrm: (f.emisor_segun_crm as string | null) ?? null }
    })
    const otros = await leerFilas<Record<string, unknown>>(db.from('conta_gc_cliente')
      .select('company_id, gc_id, nombre, nif, correo, mandatos_vivos, suscripciones_activas').eq('account_id', cuenta).neq('company_id', empresa), 'las otras cuentas de GoCardless')
    const formas = await leerFilas<{ party_id: string; forma_cobro: string | null }>(db.from('conta_cobro_cliente').select('party_id, forma_cobro').eq('company_id', empresa), 'las formas de cobro')
    const importadas = await leerFilas<{ suscripcion_gc_id: string }>(db.from('conta_gc_importacion').select('suscripcion_gc_id').eq('company_id', empresa), 'lo importado')
    const propias = await leerFilas<{ party_id: string; servicio: { clave: string } | null }>(db.from('conta_tarifa')
      .select('party_id, servicio:servicio_id(clave)').eq('company_id', empresa).not('party_id', 'is', null), 'las tarifas propias')
    const { data: conex } = await db.from('conta_cobro_gocardless').select('por_defecto').eq('company_id', empresa).single()
    // G01 · 4b · Lo decidido en la ficha: enlaces, suscripciones que no se cuentan y diferencias revisadas.
    const decisiones = await leerFilas<{ tipo: string; party_id: string | null; gc_cliente_id: string | null; suscripcion_gc_id: string | null; diferencia_tipo: string | null; porque: string | null }>(
      db.from('conta_gestoria_decision').select('tipo, party_id, gc_cliente_id, suscripcion_gc_id, diferencia_tipo, porque').eq('company_id', empresa), 'lo decidido en la ficha')
    const enlaces = new Map(decisiones.filter((d) => d.tipo === 'enlace' && d.gc_cliente_id && d.party_id).map((d) => [d.gc_cliente_id!, d.party_id!]))
    const noContar = new Set(decisiones.filter((d) => d.tipo === 'no_contar' && d.suscripcion_gc_id).map((d) => d.suscripcion_gc_id!))
    const revisadas = new Set(decisiones.filter((d) => d.tipo === 'revisada').map((d) => `${d.diferencia_tipo}|${d.party_id ?? d.gc_cliente_id}|${d.porque}`))

    const antes: Antes = {
      huellas: new Map(huellas.map((x) => [x.gc_id, x.huella])),
      fichas,
      otrosEmisores: otros.map((c) => ({ emisor: String(c.company_id), id: String(c.gc_id), nombre: String(c.nombre ?? c.gc_id), nif: (c.nif as string | null) ?? null,
        correo: (c.correo as string | null) ?? null, mandatosVivos: Number(c.mandatos_vivos ?? 0), suscripcionesActivas: Number(c.suscripciones_activas ?? 0) })),
      formaAntes: new Map(formas.map((x) => [x.party_id, x.forma_cobro])),
      porDefecto: (conex as { por_defecto?: boolean } | null)?.por_defecto !== false,
      importadas: new Set(importadas.map((x) => x.suscripcion_gc_id)),
      tarifasPropias: new Set(propias.filter((t) => t.servicio).map((t) => `${t.party_id}|${t.servicio!.clave}`)),
      enlaces,
    }
    const plan = planLectura(empresa, cuenta, datos, antes, hoy, nombreEmisor)

    // 1 · Lo leído, la forma de cobro y los mandatos.
    await upsert(db, 'conta_gc_cliente', plan.filas.clientes, 'company_id,gc_id')
    await upsert(db, 'conta_gc_mandato', plan.filas.mandatos, 'company_id,gc_id')
    await upsert(db, 'conta_gc_suscripcion', plan.filas.suscripciones, 'company_id,gc_id')
    await upsert(db, 'conta_gc_cobro', plan.filas.cobros, 'company_id,gc_id')
    // G05 · nº 43 · Los pagos al banco: su día de llegada y su neto (el casado de Bancos, match_id, no se toca).
    await upsert(db, 'conta_gc_payout', plan.filas.payouts, 'company_id,gc_id')
    await upsert(db, 'conta_cobro_cliente', plan.cobroCliente, 'company_id,party_id')
    const yaEstan = await leerFilas<{ id: string; gc_mandato_id: string }>(db.from('conta_mandato').select('id, gc_mandato_id').eq('company_id', empresa).not('gc_mandato_id', 'is', null), 'los mandatos')
    const idDe = new Map(yaEstan.map((m) => [m.gc_mandato_id, m.id]))
    for (const m of plan.mandatosSumied) {
      const id = idDe.get(m.gcMandatoId)
      const { error } = id ? await db.from('conta_mandato').update(m.fila).eq('id', id) : await db.from('conta_mandato').insert(m.fila)
      if (error) throw new Error(`No se ha podido guardar el mandato ${m.gcMandatoId}: ${error.message}`)
    }

    // 2 · La importación, una vez: servicios, tarifas propias, líneas y lo que no se convirtió.
    if (plan.servicios.length) {
      await upsert(db, 'conta_servicio', plan.servicios.map((v) => ({ account_id: cuenta, company_id: empresa, clave: v.clave, nombre: v.nombre, forma: v.forma,
        por_confirmar: v.porConfirmar, created_by_name: 'GoCardless' })), 'company_id,clave')
    }
    const servicios = await leerFilas<{ id: string; clave: string; nombre: string }>(db.from('conta_servicio').select('id, clave, nombre').eq('company_id', empresa), 'los servicios')
    const servicioId = new Map(servicios.map((x) => [x.clave, x.id]))
    for (const t of plan.tarifas) {
      const { error } = await db.from('conta_tarifa').insert({ account_id: cuenta, company_id: empresa, servicio_id: servicioId.get(t.servicio), party_id: t.partyId,
        importe: aEuros(t.importeCent), periodo: t.periodo, desde: `${t.desde}-01`, origen: 'gocardless',
        motivo: 'Importada de lo que cobraba GoCardless', created_by_name: 'GoCardless' })
      if (error) throw new Error(`No se ha podido guardar una tarifa: ${error.message}`)
    }
    let convertidas = 0
    for (const l of plan.lineas) {
      const { data: lin, error } = await db.from('conta_linea').insert({ account_id: cuenta, company_id: empresa, party_id: l.partyId, servicio_id: servicioId.get(l.servicio),
        detalle: l.detalle, empleado_nombre: l.empleado, origen: 'gocardless', importe_propio: aEuros(l.importePropioCent), periodo: l.periodo,
        desde: `${l.desdeMes}-01`, suscripcion_gc_id: l.suscripcionId, created_by_name: 'GoCardless' }).select('id').single()
      if (error) throw new Error(`No se ha podido guardar la línea de ${l.suscripcionId}: ${error.message}`)
      const { error: e2 } = await db.from('conta_gc_importacion').insert({ company_id: empresa, suscripcion_gc_id: l.suscripcionId, account_id: cuenta,
        gc_cliente_id: l.clienteGcId, party_id: l.partyId, nombre: l.nombreSuscripcion, importe: aEuros(l.importeCent), resultado: 'linea', linea_id: (lin as { id: string }).id })
      if (e2) throw new Error(`No se ha podido apuntar la importación de ${l.suscripcionId}: ${e2.message}`)
      convertidas++
    }
    await upsert(db, 'conta_gc_importacion', plan.noConvertidas.map((n) => ({ company_id: empresa, suscripcion_gc_id: n.suscripcionId, account_id: cuenta,
      gc_cliente_id: n.clienteGcId, party_id: n.partyId, nombre: n.nombre, importe: aEuros(n.importeCent), resultado: 'no_convertida',
      porque_codigo: n.codigo, porque: n.porque })), 'company_id,suscripcion_gc_id')

    // 3 · Las diferencias, con las líneas y tarifas como quedan ahora.
    const sinConvertir = await leerFilas<Record<string, string | null>>(db.from('conta_gc_importacion')
      .select('suscripcion_gc_id, gc_cliente_id, party_id, nombre, porque_codigo, porque').eq('company_id', empresa).eq('resultado', 'no_convertida'), 'lo no convertido')
    const lineasDb = await leerFilas<Record<string, unknown>>(db.from('conta_linea')
      .select('id, party_id, servicio_id, detalle, empleado_nombre, importe_propio, periodo, desde, hasta, suscripcion_gc_id').eq('company_id', empresa), 'las líneas')
    const tarifasDb = await leerFilas<Record<string, unknown>>(db.from('conta_tarifa').select('servicio_id, party_id, importe, periodo, desde, hasta').eq('company_id', empresa), 'las tarifas')
    const nombreServicio = new Map(servicios.map((x) => [x.id, x.nombre]))
    const tarifas: Tarifa[] = tarifasDb.filter((t) => t.periodo !== 'unidad').map((t) => ({ emisor: empresa, servicio: String(t.servicio_id),
      clienteId: (t.party_id as string | null) ?? null, importeCent: Math.round(Number(t.importe) * 100), periodo: t.periodo as 'mes' | 'anio',
      desde: mes(t.desde), hasta: t.hasta ? mes(t.hasta) : null }))
    const lineasDe = (partyId: string): Linea[] => lineasDb.filter((l) => l.party_id === partyId && l.periodo !== 'unidad').map((l) => ({
      id: String(l.id), emisor: empresa, servicio: String(l.servicio_id), nombreServicio: nombreServicio.get(String(l.servicio_id)) ?? '',
      detalle: (l.detalle as string | null) ?? null, empleado: (l.empleado_nombre as string | null) ?? null,
      importePropioCent: l.importe_propio === null ? null : Math.round(Number(l.importe_propio) * 100), periodo: l.periodo as 'mes' | 'anio',
      desde: mes(l.desde), hasta: l.hasta ? mes(l.hasta) : null, suscripcionId: (l.suscripcion_gc_id as string | null) ?? null }))
    const tes = await leerFilas<{ id: string; name: string; iban: string | null }>(db.from('treasury_account').select('id, name, iban').eq('company_id', empresa).eq('kind', 'bank'), 'la tesorería')
    const dif = planDiferencias(empresa, { ...datos, suscripciones: datos.suscripciones.filter((x) => !noContar.has(x.id)) }, plan, hoy,
      sinConvertir.map((n) => ({ suscripcion: String(n.suscripcion_gc_id), gcCliente: n.gc_cliente_id, partyId: n.party_id, nombre: String(n.nombre ?? ''),
        codigo: String(n.porque_codigo ?? 'sin_convertir'), porque: String(n.porque ?? '') })),
      lineasDe, tarifas, tes.map((t) => ({ id: t.id, nombre: t.name, iban: t.iban })))

    // Las de antes de esta empresa, y las del casado (de la cuenta), dejan de ser las vigentes.
    await db.from('conta_gestoria_diferencia').update({ vigente: false }).eq('account_id', cuenta).eq('vigente', true).eq('company_id', empresa)
    await db.from('conta_gestoria_diferencia').update({ vigente: false }).eq('account_id', cuenta).eq('vigente', true).in('tipo', TIPOS_DEL_CASADO)
    // Lo revisado no vuelve a salir mientras diga lo mismo.
    dif.diferencias = dif.diferencias.filter((d) => !revisadas.has(`${d.tipo}|${d.party_id ?? d.gc_cliente_id}|${d.porque}`))
    // Sin un CRM conectado (cada conector va aparte), no hay fichas con las que casar: lo del casado no se dice.
    const { data: bx } = await db.from('conta_crm').select('url_ref').eq('account_id', cuenta).not('url_ref', 'is', null).limit(1)
    if (!((bx ?? []) as { url_ref?: string | null }[]).length) dif.diferencias = dif.diferencias.filter((d) => !TIPOS_DEL_CASADO.includes(d.tipo))
    for (const trozo of enTrozos(dif.diferencias)) {
      const { error } = await db.from('conta_gestoria_diferencia').insert(trozo.map((d) => ({ account_id: cuenta, lectura_id: lectura, ...d })))
      if (error) throw new Error(`No se han podido guardar las diferencias: ${error.message}`)
    }

    // 4 · La tarjeta de la conexión y la lectura.
    const ahora = new Date().toISOString()
    await db.from('conta_cobro_gocardless').update({ ultima_lectura_at: ahora, mandatos_vivos: plan.resumen.mandatosVivos, lineas_activas: plan.resumen.lineasActivas,
      al_mes: aEuros(plan.resumen.alMesCent), abono: plan.resumen.abono, abono_treasury_id: dif.abono.coincide ? dif.abono.tesoreriaId : null,
      abono_coincide: dif.abono.coincide, abono_porque: dif.abono.coincide ? null : dif.abono.porque, updated_at: ahora }).eq('company_id', empresa)
    const conDiferencias = new Set(dif.diferencias.map((d) => d.party_id ?? d.gc_cliente_id ?? d.id_externo ?? d.tipo)).size
    const frase = fraseDeLectura(nombreEmisor(empresa), plan, convertidas, conDiferencias, por === 'conexion')
    await acabar({ estado: 'bien', nuevos: plan.nuevos, cambiados: plan.cambiados, iguales: plan.iguales, con_diferencias: conDiferencias, mensaje: frase })
    // G05 · T3: los recibos del cobro, al día con lo recién leído (confirmado → factura y asiento; devuelto → su asiento).
    // Un fallo aquí no tumba la lectura: queda dicho en el recibo y en el registro.
    const { error: eSeguir } = await db.rpc('conta_cobro_seguir', { p_company: empresa })
    if (eSeguir) console.error('[conta-gocardless-leer] seguir el cobro:', eSeguir.message)
    // G05 · T4 · Las facturas que acaba de emitir: su PDF (adjunto a la factura y a su asiento) y su envío al cliente.
    // Tampoco tumba la lectura: lo que no salga queda en el historial de cada factura y en el registro.
    try {
      const rem = await rematarFacturasDeRecibos(db, empresa, { jsPDF, qr: modulosQr, correo: { resendKey: Deno.env.get('RESEND_API_KEY'),
        buzonDePruebas: Deno.env.get('CORREO_BUZON_PRUEBAS'), abiertos: Deno.env.get('CORREO_MARCA_ABIERTOS') } })
      if (rem.fallos.length) console.error('[conta-gocardless-leer] facturas de los recibos:', rem.fallos.join(' · '))
    } catch (e) { console.error('[conta-gocardless-leer] facturas de los recibos:', e instanceof Error ? e.message : String(e)) }
    return { frase, lee: true, mandatosVivos: plan.resumen.mandatosVivos, lineas: plan.resumen.lineasActivas, alMes: aEuros(plan.resumen.alMesCent),
      convertidas, noConvertidas: plan.noConvertidas.length, diferencias: dif.diferencias.length,
      casados: { porNif: plan.parejas.filter((p) => p.emisor === empresa && p.por === 'nif').length, porCorreo: plan.parejas.filter((p) => p.emisor === empresa && p.por === 'correo').length } }
  } catch (e) {
    await acabar({ estado: 'mal', mensaje: e instanceof Error ? e.message : String(e) })
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
    const persona = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
    const { data: u } = await persona.auth.getUser()
    if (!u?.user) return json(401, { error: 'Hay que entrar para leer GoCardless.' })
    const { data: co } = await admin.from('company').select('account_id').eq('id', empresa).maybeSingle()
    if (!co) return json(404, { error: 'La empresa no existe.' })
    const cuenta = (co as { account_id: string }).account_id
    const { data: puede } = await persona.rpc('current_user_is_admin_or_manager_of', { p_account_id: cuenta })
    if (puede !== true) return json(403, { error: 'Solo un administrador o un encargado de la cuenta conecta o lee GoCardless.' })
    const { data: perfil } = await admin.from('user_profiles').select('display_name').eq('user_id', u.user.id).eq('account_id', cuenta).maybeSingle()
    quien = (perfil as { display_name?: string } | null)?.display_name ?? 'Una persona de la cuenta'
  }

  try {
    if (cuerpo.accion === 'conectar') {
      if (esCron) return json(403, { error: 'Conectar lo hace una persona.' })
      const entorno: Entorno | null = cuerpo.entorno === 'pruebas' ? 'pruebas' : cuerpo.entorno === 'real' ? 'real' : null
      const token = String(cuerpo.token ?? '').trim()
      if (!entorno) return json(400, { error: 'Di si es la cuenta real o la de pruebas (sandbox).' })
      if (!token) return json(400, { error: 'Pega el token de solo lectura (GoCardless › Developers › Create › Access token, de solo lectura).' })
      // Una demo solo conecta el entorno de pruebas; y el token se comprueba leyendo antes de guardar nada.
      const { data: co } = await admin.from('company').select('account_id').eq('id', empresa).maybeSingle()
      const puerta = await puedeLeer(admin, (co as { account_id: string }).account_id, entorno)
      if (!puerta.lee) return json(400, { error: puerta.porque })
      const ok = await comprobarToken(fetch, entorno, token)
      if (!ok.ok) return json(400, { error: ok.porque })
      const { error } = await admin.rpc('conta_gocardless_guardar_conexion', { p_company: empresa, p_entorno: entorno, p_token: token, p_quien: quien })
      if (error) return json(400, { error: error.message })
      return json(200, { ok: true, ...(await leer(admin, empresa, 'conexion', quien)) })
    }
    // G01d · La relectura que lanza un aviso al instante (conta-gocardless-aviso, con el secreto del servidor) se apunta «por aviso».
    if (cuerpo.accion === 'leer') return json(200, { ok: true, ...(await leer(admin, empresa, esCron ? (cuerpo.por === 'aviso' ? 'aviso' : 'cada_noche') : 'persona', quien)) })
    return json(400, { error: 'Acción: conectar o leer.' })
  } catch (e) {
    // En el registro, el qué y nunca el token (T11).
    console.error('[conta-gocardless-leer]', e instanceof Error ? e.message : String(e))
    return json(500, { error: e instanceof Error ? e.message : 'No se ha podido leer GoCardless.' })
  }
})
