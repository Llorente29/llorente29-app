// supabase/functions/conta-gd-volver-a-empezar/index.ts
//
// GD · «Volver a empezar» (Julio, nº51): deja una cuenta de DEMOSTRACIÓN como
// el primer día. La llama el botón de Ajustes › Tu cuenta, un paso cada vez
// (pasos.ts), con la sesión de un administrador de la cuenta:
//
//   { cuenta, paso: 'comprobar' }       ¿se puede? (no cambia nada)
//   { cuenta, paso: 'portal_borrar' }   el Bitrix24 de pruebas, vacío
//   { cuenta, paso: 'portal_sembrar' }  sus 40 clientes (datos.ts)
//   { cuenta, paso: 'sandbox_borrar' }  el sandbox de GoCardless, vacío
//   { cuenta, paso: 'sandbox_sembrar' } sus clientes, mandatos y suscripciones
//   { cuenta, paso: 'sumied' }          demo_gestoria_volver_a_empezar (vacía lo
//                                       que nace del uso; contabilidad y banco)
//   { cuenta, paso: 'leer' }            vuelve a leer el CRM (y con él GoCardless)
//   { cuenta, paso: 'tarifa' }          la tarifa y los ingresos en el banco
//
// Los secretos son SUYOS (Julio, nº51): GD_B24_ENTRANTE_URL y
// GD_GC_SANDBOX_RW_TOKEN, en los secretos de las funciones. Solo se usan en
// cuentas demo, y con las guardas de «sembrar» (_shared/gd/siembra.ts): solo
// el portal b24-s3mr2y y solo el sandbox. Además, la cuenta tiene que estar
// conectada a ese portal y solo a GoCardless de pruebas. Los secretos no se
// devuelven ni se escriben en el registro.
// Su verify_jwt = true está declarado en supabase/config.toml (sin él, el
// despliegue la rechaza por nueva: le pasó a la fusión del #532).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { crearSiembra, PORTAL_DE_PRUEBAS } from '../_shared/gd/siembra.ts'
import { CAMBIOS_DEL_MES, esPaso, fechasDeLosCambios, HISTORIA, historiaDeTalleres, inicioDeLasCuotas, porqueNo, ACCESOS_DE_LA_DEMO, PORTAL_DE_LA_DEMO, PRESUPUESTO_MS, SUMIED_MS } from './pasos.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let cuerpo: Record<string, unknown> = {}
  try { cuerpo = await req.json() } catch { /* sin cuerpo */ }
  const cuenta = String(cuerpo.cuenta ?? '')
  const paso = cuerpo.paso
  if (!/^[0-9a-f-]{36}$/i.test(cuenta)) return json(400, { error: 'Falta la cuenta.' })
  if (!esPaso(paso)) return json(400, { error: 'Paso desconocido.' })

  // Quién llama: una persona con sesión, administradora de ESA cuenta.
  const persona = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
  const { data: u } = await persona.auth.getUser()
  if (!u?.user) return json(401, { error: 'Hay que entrar para volver a empezar.' })

  const b24Url = (Deno.env.get('GD_B24_ENTRANTE_URL') ?? '').trim()
  const gcToken = (Deno.env.get('GD_GC_SANDBOX_RW_TOKEN') ?? '').trim()
  const [cu, perfil, crm, gc] = await Promise.all([
    admin.from('accounts').select('is_demo').eq('id', cuenta).maybeSingle(),
    admin.from('user_profiles').select('role, active').eq('account_id', cuenta).eq('user_id', u.user.id).maybeSingle(),
    admin.from('conta_crm').select('portal').eq('account_id', cuenta),
    admin.from('conta_cobro_gocardless').select('entorno').eq('account_id', cuenta),
  ])
  const portales = ((crm.data ?? []) as { portal: string | null }[]).map((c) => c.portal).filter((p): p is string => !!p)
  const no = porqueNo({
    esDemo: (cu.data as { is_demo?: boolean } | null)?.is_demo === true,
    esAdmin: (perfil.data as { role?: string; active?: boolean } | null)?.role === 'admin' && (perfil.data as { active?: boolean }).active === true,
    portalCrm: portales.find((p) => p !== PORTAL_DE_PRUEBAS) ?? portales[0] ?? null,
    entornosGc: ((gc.data ?? []) as { entorno: string }[]).map((g) => g.entorno),
    faltan: [!b24Url && 'GD_B24_ENTRANTE_URL', !gcToken && 'GD_GC_SANDBOX_RW_TOKEN'].filter((x): x is string => !!x),
  }, PORTAL_DE_PRUEBAS)
  if (no) return json(403, { error: no })

  const dicho: string[] = []
  let sigue = false
  try {
    const siembra = crearSiembra({ b24Url, gcToken, decir: (t) => dicho.push(t.trim().replace(/^✓\s*/, '')) })
    switch (paso) {
      case 'comprobar': dicho.push('Todo listo para volver a empezar.'); break
      // Por tandas (nº71): lo que cabe en 90 s; si queda, la pantalla vuelve a llamar al mismo paso.
      case 'portal_borrar': sigue = (await siembra.borrarBitrix(PRESUPUESTO_MS)).quedan > 0; break
      case 'portal_sembrar': sigue = (await siembra.sembrarBitrix(PRESUPUESTO_MS)).quedan > 0; break
      case 'sandbox_borrar': await siembra.borrarGoCardless(); break
      case 'sandbox_sembrar': await siembra.sembrarGoCardless(); break
      case 'sumied': {
        // Por tandas (nº84): la base corta cada llamada a los 8 s; cada tanda borra lo que cabe en SUMIED_MS y,
        // mientras quede algo, dice «sigue». La última vuelve a sembrar la contabilidad y el banco.
        const { data, error } = await admin.rpc('demo_gestoria_volver_a_empezar_tanda', { p_cuenta: cuenta, p_ms: SUMIED_MS })
        if (error) throw new Error(error.message)
        const d = (data ?? {}) as { frase?: string; sigue?: boolean }
        sigue = d.sigue === true
        dicho.push(String(d.frase ?? 'Sumied, como el primer día.'))
        break
      }
      case 'leer': {
        const secreto = Deno.env.get('CRON_SECRET') ?? ''
        if (!secreto) throw new Error('Falta CRON_SECRET en las funciones: no se puede volver a leer.')
        const empezo = new Date(Date.now() - 2000).toISOString()
        const r = await fetch(`${supabaseUrl}/functions/v1/conta-bitrix-leer`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secreto },
          body: JSON.stringify({ accion: 'leer', cuenta }),
        })
        const d = (await r.json().catch(() => ({}))) as { frase?: string; error?: string }
        if (!r.ok) throw new Error(`La lectura del CRM ha fallado: ${d.error ?? r.status}`)
        // conta-bitrix-leer espera a la lectura de cada GoCardless de la cuenta antes de contestar. Se miran solo las que
        // lanza este paso (con el secreto del servidor: «cada_noche»), no las de los avisos del sandbox: al volver a
        // sembrarlo llegan avisos que relanzan lecturas a la vez, y una puede chocar con esta sin que falte nada (nº79).
        const { data: lect } = await admin.from('conta_gestoria_lectura').select('origen, estado, mensaje')
          .eq('account_id', cuenta).eq('origen', 'gocardless').eq('por', 'cada_noche').gte('empezada_at', empezo)
          .order('empezada_at', { ascending: false })
        const gcs = (lect ?? []) as { estado: string | null; mensaje: string | null }[]
        const mal = gcs.find((l) => l.estado !== 'bien')
        if (!gcs.length) throw new Error('No se ha leído GoCardless después del CRM: ¿está conectado en la demo?')
        if (mal) throw new Error(`La lectura de GoCardless no ha salido bien (${mal.estado ?? 'sin acabar'}): ${mal.mensaje ?? ''}`)
        dicho.push(d.frase ?? 'Leído el CRM.', `Leído GoCardless (${gcs.length} ${gcs.length === 1 ? 'empresa' : 'empresas'}).`)
        break
      }
      case 'tarifa': {
        // nº63 · Los clientes de la demo son de antes: sus cuotas mensuales de GoCardless empiezan en enero, no en
        // el primer cargo de una suscripción recién creada en el sandbox. Solo esta cuenta demo; ni las manuales ni las anuales.
        const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
        const desde = inicioDeLasCuotas(hoy)
        const { data: movidas, error: eL } = await admin.from('conta_linea').update({ desde })
          .eq('account_id', cuenta).eq('origen', 'gocardless').eq('periodo', 'mes').gt('desde', desde).select('id')
        if (eL) throw new Error(`No se han podido poner las cuotas desde enero: ${eL.message}`)
        dicho.push(`${(movidas ?? []).length} cuotas mensuales de GoCardless, desde el ${desde.split('-').reverse().join('/')}.`)
        // nº109 · Y sus tarifas mensuales, igual: la lectura las pone desde el primer cargo de la suscripción recién creada
        // (el mes que viene), y la demo cobra el mes en curso (nº100). Sin esto, el cobro del mes no cobra nada, ni el alta.
        // nº110 · Las anuales (el impuesto de sociedades) se quedan como las cobra GoCardless: desde el junio que viene.
        const { data: tarifas, error: eT } = await admin.from('conta_tarifa').update({ desde })
          .eq('account_id', cuenta).eq('origen', 'gocardless').eq('periodo', 'mes').gt('desde', desde).select('id')
        if (eT) throw new Error(`No se han podido poner las tarifas desde enero: ${eT.message}`)
        dicho.push(`${(tarifas ?? []).length} tarifas mensuales de GoCardless, desde el ${desde.split('-').reverse().join('/')}.`)
        const t = await admin.rpc('demo_gestoria_tarifa_sembrar', { p_cuenta: cuenta })
        if (t.error) throw new Error(t.error.message)
        const i = await admin.rpc('demo_gestoria_ingresos_gocardless', { p_cuenta: cuenta })
        if (i.error) throw new Error(i.error.message)
        dicho.push(String((t.data as { frase?: string } | null)?.frase ?? 'Tarifa sembrada.'), String((i.data as { frase?: string } | null)?.frase ?? ''))
        break
      }
      case 'historia': {
        // nº101 · La historia de Talleres Ruiz (de julio a octubre, si se cobra noviembre): la cadena entera de cada mes,
        // por los mismos caminos que un cobro de verdad. Repetible: un mes que ya tiene su factura se deja.
        const { data: soc } = await admin.from('company').select('id').eq('account_id', cuenta).eq('sector', 'gestoria').eq('entity_kind', 'company').order('created_at').limit(1).maybeSingle()
        if (!soc) throw new Error('La demo no tiene una sociedad de Gestoría.')
        const empresa = (soc as { id: string }).id
        const { data: cli } = await admin.from('party').select('id').eq('account_id', cuenta).eq('name', HISTORIA.cliente).maybeSingle()
        if (!cli) throw new Error(`No está «${HISTORIA.cliente}» en la demo.`)
        const talleres = (cli as { id: string }).id
        const { data: adm } = await admin.from('user_profiles').select('user_id, display_name').eq('account_id', cuenta).eq('role', 'admin').eq('active', true).order('created_at').limit(1).maybeSingle()
        if (!adm) throw new Error('La demo no tiene administrador: la factura se emite en nombre de quien envía el cobro.')
        const quien = { id: (adm as { user_id: string }).user_id, nombre: (adm as { display_name: string | null }).display_name ?? 'Administración' }
        // Sus trabajadores de entonces: las líneas de gestión laboral que ya tenía (el alta del mes en curso va después, en «cambios»).
        const { data: lab } = await admin.from('conta_servicio').select('id').eq('company_id', empresa).eq('clave', 'gestion_laboral').maybeSingle()
        const { data: tr } = await admin.from('conta_linea').select('empleado_nombre').eq('account_id', cuenta).eq('party_id', talleres)
          .eq('servicio_id', (lab as { id: string } | null)?.id ?? '').not('empleado_nombre', 'is', null).is('hasta', null).order('empleado_nombre')
        const trabajadores = ((tr ?? []) as { empleado_nombre: string }[]).map((x) => x.empleado_nombre).filter((n) => n.toLowerCase() !== CAMBIOS_DEL_MES.alta.trabajador.toLowerCase())
        if (!trabajadores.length) throw new Error(`${HISTORIA.cliente} no tiene trabajadores en la demo: no se siembra su historia.`)
        const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
        const meses = historiaDeTalleres(hoy, trabajadores)
        let facturas = 0; let casados = 0
        for (const h of meses) {
          const { data: ya } = await admin.from('conta_recibo').select('id, invoice_id').eq('account_id', cuenta).eq('party_id', talleres).eq('mes', h.mes).maybeSingle()
          if ((ya as { invoice_id: string | null } | null)?.invoice_id) continue
          const ahora = new Date().toISOString()
          const e1 = await admin.from('conta_gc_payout').upsert({ company_id: empresa, account_id: cuenta, gc_id: h.payoutGc, estado: 'paid', llegada: h.llegada,
            importe: h.netoCent / 100, comision: h.comisionCent / 100, moneda: 'EUR', referencia: h.referencia }, { onConflict: 'company_id,gc_id' })
          if (e1.error) throw new Error(`La liquidación de ${h.mes}: ${e1.error.message}`)
          const e2 = await admin.from('conta_gc_cobro').upsert({ company_id: empresa, account_id: cuenta, gc_id: h.cobroGc, estado: 'paid_out', importe: h.totalCent / 100,
            moneda: 'EUR', fecha: h.cargoEl, payout_gc_id: h.payoutGc}, { onConflict: 'company_id,gc_id' })
          if (e2.error) throw new Error(`El cobro de ${h.mes}: ${e2.error.message}`)
          const fila = { account_id: cuenta, company_id: empresa, party_id: talleres, mes: h.mes, clave: `recibo:${empresa}:${talleres}:${h.mes}`, entorno: 'pruebas',
            total_cent: h.totalCent, cobrar_cent: h.totalCent, anterior_cent: h.totalCent, anterior_de_gocardless: true, factura: h.factura, cambios: [], parado: [],
            decision: 'aprobado', decidido_at: ahora, decidido_por_name: quien.nombre, estado: 'enviado', gc_estado: 'paid_out', gc_cobro_id: h.cobroGc,
            cargo_el: h.cargoEl, confirmado_el: h.cargoEl,
            enviado_at: `${h.cargoEl}T09:00:00Z`, enviado_por: quien.id, enviado_por_name: quien.nombre }
          const ins = ya ? await admin.from('conta_recibo').update(fila).eq('id', (ya as { id: string }).id).select('id').single()
            : await admin.from('conta_recibo').insert(fila).select('id').single()
          if (ins.error) throw new Error(`El recibo de ${h.mes}: ${ins.error.message}`)
          const f = await admin.rpc('_conta_cobro_facturar', { p_recibo: (ins.data as { id: string }).id })
          if (f.error) throw new Error(`La factura de ${h.mes}: ${f.error.message}`)
          facturas++
        }
        // Su ingreso en el banco (el mismo que la siembra de cada liquidación), casado como «Casado solo» y validado.
        const ing = await admin.rpc('demo_gestoria_ingresos_gocardless', { p_cuenta: cuenta })
        if (ing.error) throw new Error(`Los ingresos en el banco: ${ing.error.message}`)
        for (const h of meses) {
          const { data: po } = await admin.from('conta_gc_payout').select('match_id').eq('company_id', empresa).eq('gc_id', h.payoutGc).maybeSingle()
          const yaCasado = (po as { match_id: string | null } | null)?.match_id
          if (yaCasado) {
            // Casado ya (la pasada del banco se adelantó): solo falta validarlo, si sigue propuesto.
            const { data: bm } = await admin.from('bank_match').select('journal_entry_id').eq('id', yaCasado).maybeSingle()
            const asiento = (bm as { journal_entry_id: string | null } | null)?.journal_entry_id
            const { data: je } = asiento ? await admin.from('journal_entry').select('status').eq('id', asiento).maybeSingle() : { data: null }
            if (asiento && (je as { status: string } | null)?.status === 'propuesto') {
              const v = await persona.rpc('journal_entry_validar', { p_entry: asiento, p_quien_nombre: quien.nombre })
              if (v.error) throw new Error(`Validar el ingreso de ${h.mes}: ${v.error.message}`)
            }
            continue
          }
          const { data: mov } = await admin.from('bank_movement').select('id').eq('account_id', cuenta).eq('company_id', empresa)
            .eq('op_date', h.llegada).eq('amount', h.netoCent / 100).limit(1).maybeSingle()
          if (!mov) throw new Error(`No está en el banco el ingreso de ${h.mes} (${(h.netoCent / 100).toFixed(2)} €).`)
          const c = await persona.rpc('conta_abono_gocardless_casar', { p_movement: (mov as { id: string }).id, p_payout: h.payoutGc, p_confianza: 'seguro',
            p_porque: `Pago de GoCardless con 1 cobro, que llegaba el ${h.llegada.slice(8, 10)}/${h.llegada.slice(5, 7)}: ${(h.netoCent / 100).toFixed(2).replace('.', ',')} € netos, exactos.`, p_por: 'folvy' })
          if (c.error) throw new Error(`Casar el ingreso de ${h.mes}: ${c.error.message}`)
          const asiento = (c.data as { asiento?: string } | null)?.asiento
          if (asiento) {
            const v = await persona.rpc('journal_entry_validar', { p_entry: asiento, p_quien_nombre: quien.nombre })
            if (v.error) throw new Error(`Validar el ingreso de ${h.mes}: ${v.error.message}`)
          }
          casados++
        }
        dicho.push(`Historia de ${HISTORIA.cliente}: ${meses.length} meses (${meses[0].mes} a ${meses[meses.length - 1].mes}), ${facturas} facturas nuevas y ${casados} ingresos casados y validados en el banco.`)
        break
      }
      case 'cambios': {
        // nº68 · Los cambios que enseña el cobro del mes que viene, con las funciones de la ficha y la sesión de quien pulsa
        // (la cuenta abierta es esta demo). Repetible: lo que ya está hecho se dice y se sigue.
        const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
        const f = fechasDeLosCambios(hoy)
        const { data: soc } = await admin.from('company').select('id').eq('account_id', cuenta).eq('sector', 'gestoria').eq('entity_kind', 'company').order('created_at').limit(1).maybeSingle()
        if (!soc) throw new Error('La demo no tiene una sociedad de Gestoría.')
        const empresa = (soc as { id: string }).id
        const parte = async (nombre: string) => {
          const { data } = await admin.from('party').select('id').eq('account_id', cuenta).eq('name', nombre).maybeSingle()
          if (!data) throw new Error(`No está «${nombre}» en la demo.`)
          return (data as { id: string }).id
        }
        const servicio = async (clave: string) => {
          const { data } = await admin.from('conta_servicio').select('id').eq('company_id', empresa).eq('clave', clave).maybeSingle()
          if (!data) throw new Error(`La demo no tiene el servicio «${clave}».`)
          return (data as { id: string }).id
        }
        const yaHecho = (e: { code?: string; message: string } | null) => !!e && (e.code === '23505' || /ya est[aá]/i.test(e.message))
        // 1 · Talleres Ruiz, +1 trabajador (alta el 1 de este mes: nº100, la demo cobra el mes en curso).
        const laboral = await servicio('gestion_laboral')
        const talleres = await parte(CAMBIOS_DEL_MES.alta.cliente)
        const alta = await persona.rpc('conta_gestoria_alta_empleado', { p_company: empresa, p_party: talleres, p_servicio: laboral, p_empleado: CAMBIOS_DEL_MES.alta.trabajador, p_desde: f.altaEl })
        if (alta.error && !yaHecho(alta.error)) throw new Error(`El alta en ${CAMBIOS_DEL_MES.alta.cliente}: ${alta.error.message}`)
        // nº109 · El alta guarda el nombre en mayúsculas («LUCAS FERRER GIL»): en la demo, como lo escribe la gestoría, igual
        // que los trabajadores que vienen de GoCardless. Se busca sin distinguir mayúsculas (antes no lo encontraba y
        // `alta_el` se quedaba sin poner).
        const { trabajador } = CAMBIOS_DEL_MES.alta
        const eAlta = await admin.from('conta_linea').update({ alta_el: f.altaEl, empleado_nombre: trabajador }).eq('account_id', cuenta)
          .eq('party_id', talleres).eq('servicio_id', laboral).ilike('empleado_nombre', trabajador).select('id')
        if (eAlta.error) throw new Error(`El alta de ${trabajador}: ${eAlta.error.message}`)
        if (!(eAlta.data ?? []).length) throw new Error(`No está la línea del alta de ${trabajador} en ${CAMBIOS_DEL_MES.alta.cliente}.`)
        dicho.push(alta.error ? `${CAMBIOS_DEL_MES.alta.cliente}: el alta ya estaba.`
          : String((alta.data as { frase?: string } | null)?.frase ?? '').replace(trabajador.toUpperCase(), trabajador))
        // 2 · Imprenta Rápida Sol, de Básica a Premium desde este mes.
        const mensual = await servicio('gestoria_mensual')
        const imprenta = await parte(CAMBIOS_DEL_MES.nivel.cliente)
        const { data: nivel } = await admin.from('conta_servicio_nivel').select('id').eq('servicio_id', mensual).eq('nombre', CAMBIOS_DEL_MES.nivel.nivel).maybeSingle()
        const { data: linea } = await admin.from('conta_linea').select('id').eq('account_id', cuenta).eq('party_id', imprenta).eq('servicio_id', mensual).is('hasta', null).order('desde').limit(1).maybeSingle()
        if (!nivel || !linea) throw new Error(`${CAMBIOS_DEL_MES.nivel.cliente}: no está su gestoría mensual o el nivel ${CAMBIOS_DEL_MES.nivel.nivel}.`)
        const cambio = await persona.rpc('conta_tarifa_nivel_cambiar', { p_linea: (linea as { id: string }).id, p_nivel: (nivel as { id: string }).id, p_desde: f.nivelDesde, p_ensayo: false })
        if (cambio.error && !yaHecho(cambio.error)) throw new Error(`El cambio de nivel de ${CAMBIOS_DEL_MES.nivel.cliente}: ${cambio.error.message}`)
        dicho.push(cambio.error ? `${CAMBIOS_DEL_MES.nivel.cliente}: ya estaba en ${CAMBIOS_DEL_MES.nivel.nivel}.` : String((cambio.data as { frase?: string } | null)?.frase ?? ''))
        // 3 · Reformas Atalaya, baja de un trabajador: cobrada por última vez el mes pasado.
        const reformas = await parte(CAMBIOS_DEL_MES.baja.cliente)
        const { data: tr } = await admin.from('conta_linea').select('id, hasta').eq('account_id', cuenta).eq('party_id', reformas).eq('servicio_id', laboral).not('empleado_nombre', 'is', null).order('empleado_nombre', { ascending: false }).limit(1).maybeSingle()
        if (!tr) throw new Error(`${CAMBIOS_DEL_MES.baja.cliente} no tiene trabajadores en la demo.`)
        if ((tr as { hasta: string | null }).hasta) dicho.push(`${CAMBIOS_DEL_MES.baja.cliente}: la baja ya estaba.`)
        else {
          const baja = await persona.rpc('conta_gestoria_baja_linea', { p_linea: (tr as { id: string }).id, p_mes: f.bajaHasta })
          if (baja.error) throw new Error(`La baja en ${CAMBIOS_DEL_MES.baja.cliente}: ${baja.error.message}`)
          dicho.push(String((baja.data as { frase?: string } | null)?.frase ?? ''))
        }
        break
      }
      case 'portal': {
        // nº94 · El portal de la demo, como si se hubiera pulsado «Preparar el portal de la demo» (la vacía «sumied»).
        // nº98 · Y el acceso de Felipe Herrera para Electricidad Voltio (sale devuelto en cada cobro: el devuelto del
        // portal). El portal deja entrar por el usuario del acceso, y un acceso nuevo nace sin él (solo lo pone el
        // servidor al mandar el enlace): a cada uno se le enlaza su usuario, y si no lo tiene se le crea, confirmado.
        const prep = await admin.rpc('conta_portal_demo_preparar', { p_cuenta: cuenta })
        if (prep.error) throw new Error(`Preparar el portal de la demo: ${prep.error.message}`)
        dicho.push(String((prep.data as { frase?: string } | null)?.frase ?? 'Portal de la demo preparado.'))
        const usuarios = new Map<string, string>()
        const buscarUsuario = async (correo: string): Promise<string | null> => {
          if (!usuarios.size) {
            for (let pagina = 1; pagina <= 20; pagina++) {
              const { data: us, error: eU } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 })
              if (eU) throw new Error(`Buscar los usuarios del portal: ${eU.message}`)
              for (const u of us.users) if (u.email) usuarios.set(u.email.toLowerCase(), u.id)
              if (us.users.length < 1000) break
            }
          }
          return usuarios.get(correo) ?? null
        }
        for (const a of ACCESOS_DE_LA_DEMO) {
          const { data: cli } = await admin.from('party').select('id').eq('account_id', cuenta).eq('name', a.cliente).maybeSingle()
          if (!cli) throw new Error(`No está «${a.cliente}» en la demo: su portal no se puede preparar.`)
          const party = (cli as { id: string }).id
          let { data: acc } = await admin.from('conta_portal_acceso').select('id, user_id').eq('account_id', cuenta)
            .eq('party_id', party).ilike('correo', a.correo).is('revocado_at', null).maybeSingle()
          if (!acc && a !== PORTAL_DE_LA_DEMO) {
            const ins = await admin.from('conta_portal_acceso').insert({ account_id: cuenta, party_id: party, correo: a.correo, nombre: a.persona,
              permiso: 'todo', invitado_por_name: 'Preparación de la demo' }).select('id, user_id').single()
            if (ins.error) throw new Error(`El acceso de ${a.persona}: ${ins.error.message}`)
            acc = ins.data
          }
          if (!acc) throw new Error(`${a.cliente} no tiene el acceso de ${a.persona} después de preparar el portal.`)
          const acceso = acc as { id: string; user_id: string | null }
          if (acceso.user_id) { dicho.push(`${a.persona} ya puede entrar en su portal.`); continue }
          let usuario = await buscarUsuario(a.correo)
          if (!usuario) {
            const nuevo = await admin.auth.admin.createUser({ email: a.correo, email_confirm: true, user_metadata: { nombre: a.persona, demo: 'gd' } })
            if (nuevo.error || !nuevo.data.user) throw new Error(`El usuario de ${a.persona}: ${nuevo.error?.message ?? 'sin usuario'}`)
            usuario = nuevo.data.user.id
          }
          const enl = await admin.rpc('conta_portal_acceso_usuario', { p_acceso: acceso.id, p_user: usuario })
          if (enl.error) throw new Error(`Dejar listo el acceso de ${a.persona}: ${enl.error.message}`)
          dicho.push(`${a.persona} ya puede entrar en el portal de ${a.cliente}.`)
        }
        break
      }
    }
    return json(200, { ok: true, paso, sigue, frase: dicho.filter(Boolean).join(' ') })
  } catch (e) {
    // En el registro, el qué y nunca un secreto.
    const m = e instanceof Error ? e.message : String(e)
    console.error('[conta-gd-volver-a-empezar]', paso, m)
    return json(500, { error: m, paso, hecho: dicho.join(' ') })
  }
})
