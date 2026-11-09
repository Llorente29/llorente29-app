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
import { CAMBIOS_DEL_MES, esPaso, fechasDeLosCambios, inicioDeLasCuotas, porqueNo, PRESUPUESTO_MS } from './pasos.ts'

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
        const { data, error } = await admin.rpc('demo_gestoria_volver_a_empezar', { p_cuenta: cuenta })
        if (error) throw new Error(error.message)
        dicho.push(String((data as { frase?: string } | null)?.frase ?? 'Sumied, como el primer día.'))
        break
      }
      case 'leer': {
        const secreto = Deno.env.get('CRON_SECRET') ?? ''
        if (!secreto) throw new Error('Falta CRON_SECRET en las funciones: no se puede volver a leer.')
        const r = await fetch(`${supabaseUrl}/functions/v1/conta-bitrix-leer`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secreto },
          body: JSON.stringify({ accion: 'leer', cuenta }),
        })
        const d = (await r.json().catch(() => ({}))) as { frase?: string; error?: string }
        if (!r.ok) throw new Error(`La lectura del CRM ha fallado: ${d.error ?? r.status}`)
        // conta-bitrix-leer espera a la lectura de cada GoCardless de la cuenta antes de contestar.
        const { data: lect } = await admin.from('conta_gestoria_lectura').select('origen, estado, mensaje')
          .eq('account_id', cuenta).eq('origen', 'gocardless').order('empezada_at', { ascending: false }).limit(2)
        const gcs = (lect ?? []) as { estado: string | null; mensaje: string | null }[]
        const mal = gcs.find((l) => l.estado !== 'bien')
        if (!gcs.length) throw new Error('No se ha leído GoCardless después del CRM: ¿está conectado en la demo?')
        if (mal) throw new Error(`La lectura de GoCardless no ha salido bien (${mal.estado ?? 'sin acabar'}): ${mal.mensaje ?? ''}`)
        dicho.push(d.frase ?? 'Leído el CRM.', `Leído GoCardless (${gcs.length} ${gcs.length === 1 ? 'empresa' : 'empresas'}).`)
        break
      }
      case 'tarifa': {
        // nº63 · Los clientes de la demo son de antes: sus cuotas mensuales de GoCardless empiezan en enero, no en
        // el primer cargo de una suscripción recién creada en el sandbox. Solo esta cuenta demo; ni las anuales ni las manuales.
        const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
        const desde = inicioDeLasCuotas(hoy)
        const { data: movidas, error: eL } = await admin.from('conta_linea').update({ desde })
          .eq('account_id', cuenta).eq('origen', 'gocardless').eq('periodo', 'mes').gt('desde', desde).select('id')
        if (eL) throw new Error(`No se han podido poner las cuotas desde enero: ${eL.message}`)
        dicho.push(`${(movidas ?? []).length} cuotas mensuales de GoCardless, desde el ${desde.split('-').reverse().join('/')}.`)
        const t = await admin.rpc('demo_gestoria_tarifa_sembrar', { p_cuenta: cuenta })
        if (t.error) throw new Error(t.error.message)
        const i = await admin.rpc('demo_gestoria_ingresos_gocardless', { p_cuenta: cuenta })
        if (i.error) throw new Error(i.error.message)
        dicho.push(String((t.data as { frase?: string } | null)?.frase ?? 'Tarifa sembrada.'), String((i.data as { frase?: string } | null)?.frase ?? ''))
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
        // 1 · Talleres Ruiz, +1 trabajador (alta el 1 del mes que viene: nº76, la regla del mes entero).
        const laboral = await servicio('gestion_laboral')
        const talleres = await parte(CAMBIOS_DEL_MES.alta.cliente)
        const alta = await persona.rpc('conta_gestoria_alta_empleado', { p_company: empresa, p_party: talleres, p_servicio: laboral, p_empleado: CAMBIOS_DEL_MES.alta.trabajador, p_desde: f.altaEl })
        if (alta.error && !yaHecho(alta.error)) throw new Error(`El alta en ${CAMBIOS_DEL_MES.alta.cliente}: ${alta.error.message}`)
        await admin.from('conta_linea').update({ alta_el: f.altaEl }).eq('account_id', cuenta).eq('party_id', talleres).eq('servicio_id', laboral).eq('empleado_nombre', CAMBIOS_DEL_MES.alta.trabajador)
        dicho.push(alta.error ? `${CAMBIOS_DEL_MES.alta.cliente}: el alta ya estaba.` : String((alta.data as { frase?: string } | null)?.frase ?? ''))
        // 2 · Imprenta Rápida Sol, de Básica a Premium desde el mes que viene.
        const mensual = await servicio('gestoria_mensual')
        const imprenta = await parte(CAMBIOS_DEL_MES.nivel.cliente)
        const { data: nivel } = await admin.from('conta_servicio_nivel').select('id').eq('servicio_id', mensual).eq('nombre', CAMBIOS_DEL_MES.nivel.nivel).maybeSingle()
        const { data: linea } = await admin.from('conta_linea').select('id').eq('account_id', cuenta).eq('party_id', imprenta).eq('servicio_id', mensual).is('hasta', null).order('desde').limit(1).maybeSingle()
        if (!nivel || !linea) throw new Error(`${CAMBIOS_DEL_MES.nivel.cliente}: no está su gestoría mensual o el nivel ${CAMBIOS_DEL_MES.nivel.nivel}.`)
        const cambio = await persona.rpc('conta_tarifa_nivel_cambiar', { p_linea: (linea as { id: string }).id, p_nivel: (nivel as { id: string }).id, p_desde: f.mesQueViene, p_ensayo: false })
        if (cambio.error && !yaHecho(cambio.error)) throw new Error(`El cambio de nivel de ${CAMBIOS_DEL_MES.nivel.cliente}: ${cambio.error.message}`)
        dicho.push(cambio.error ? `${CAMBIOS_DEL_MES.nivel.cliente}: ya estaba en ${CAMBIOS_DEL_MES.nivel.nivel}.` : String((cambio.data as { frase?: string } | null)?.frase ?? ''))
        // 3 · Reformas Atalaya, baja de un trabajador: se cobra este mes y ya no el que viene.
        const reformas = await parte(CAMBIOS_DEL_MES.baja.cliente)
        const { data: tr } = await admin.from('conta_linea').select('id, hasta').eq('account_id', cuenta).eq('party_id', reformas).eq('servicio_id', laboral).not('empleado_nombre', 'is', null).order('empleado_nombre', { ascending: false }).limit(1).maybeSingle()
        if (!tr) throw new Error(`${CAMBIOS_DEL_MES.baja.cliente} no tiene trabajadores en la demo.`)
        if ((tr as { hasta: string | null }).hasta) dicho.push(`${CAMBIOS_DEL_MES.baja.cliente}: la baja ya estaba.`)
        else {
          const baja = await persona.rpc('conta_gestoria_baja_linea', { p_linea: (tr as { id: string }).id, p_mes: f.esteMes })
          if (baja.error) throw new Error(`La baja en ${CAMBIOS_DEL_MES.baja.cliente}: ${baja.error.message}`)
          dicho.push(String((baja.data as { frase?: string } | null)?.frase ?? ''))
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
