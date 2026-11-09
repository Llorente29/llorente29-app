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
import { esPaso, porqueNo } from './pasos.ts'

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
  try {
    const siembra = crearSiembra({ b24Url, gcToken, decir: (t) => dicho.push(t.trim().replace(/^✓\s*/, '')) })
    switch (paso) {
      case 'comprobar': dicho.push('Todo listo para volver a empezar.'); break
      case 'portal_borrar': await siembra.borrarBitrix(); break
      case 'portal_sembrar': await siembra.sembrarBitrix(); break
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
        const t = await admin.rpc('demo_gestoria_tarifa_sembrar', { p_cuenta: cuenta })
        if (t.error) throw new Error(t.error.message)
        const i = await admin.rpc('demo_gestoria_ingresos_gocardless', { p_cuenta: cuenta })
        if (i.error) throw new Error(i.error.message)
        dicho.push(String((t.data as { frase?: string } | null)?.frase ?? 'Tarifa sembrada.'), String((i.data as { frase?: string } | null)?.frase ?? ''))
        break
      }
    }
    return json(200, { ok: true, paso, frase: dicho.filter(Boolean).join(' ') })
  } catch (e) {
    // En el registro, el qué y nunca un secreto.
    const m = e instanceof Error ? e.message : String(e)
    console.error('[conta-gd-volver-a-empezar]', paso, m)
    return json(500, { error: m, paso, hecho: dicho.join(' ') })
  }
})
