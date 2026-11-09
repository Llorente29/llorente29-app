// supabase/functions/conta-portal-avisos/index.ts
//
// GP · Tarea 4 (Code 3, 09/11/2026) · LOS AVISOS POR CORREO DEL PORTAL DEL
// CLIENTE: factura nueva, recibo próximo, devuelto, mensaje de la gestoría y
// petición de la gestoría. La despierta el cron «portal-avisos» cada 10 minutos
// (conta_portal_despertar, la 2030) solo si hay algo que avisar.
//
//   · Quién puede llamarla: el cron (x-cron-secret = CRON_SECRET) o el servidor
//     con la clave de servicio. Nadie más (verify_jwt = false, como los otros
//     repasos del cron; la puerta está aquí dentro).
//   · Qué manda: lo que dice conta_portal_avisos_pendientes, una fila por aviso
//     y persona, con su clave. mandar() lo apunta en conta_portal_aviso con esa
//     clave: nunca dos veces lo mismo a la misma persona.
//   · La puerta de las demos: el de una cuenta de demo va SOLO al buzón de
//     pruebas, sin pasar por el freno (nº 11, como el #533).
//   · En una cuenta de verdad, el freno: «portal_aviso» cerrado hasta que Julio
//     decida (CORREO_MARCA_ABIERTOS). Cerrado, no se apunta nada: esperan.
//   · Mensajes y peticiones avisados se marcan (conta_portal_avisos_hechos),
//     para no volver a juntarlos.
//
// Contesta 200 con { ok, mandados, esperan, no_enviados, errores }.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { PLANTILLA_AVISO, TIPOS_AVISO, avisados, correoAviso, type Pendiente } from '../_shared/portal/avisos.ts'
import { mandar, marcaDe, portalBase, type MarcaGestoria } from '../_shared/portal/enviar.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LIMITE = 200

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'usa POST' })
  const secreto = Deno.env.get('CRON_SECRET') ?? ''
  const porCron = !!secreto && req.headers.get('x-cron-secret') === secreto
  const porServicio = (req.headers.get('authorization') ?? '') === `Bearer ${SERVICIO}`
  if (!porCron && !porServicio) return json(401, { error: 'No.' })

  const srv = createClient(URL_BASE, SERVICIO, { auth: { persistSession: false } })
  const { data, error } = await srv.rpc('conta_portal_avisos_pendientes', { p_limite: LIMITE })
  if (error) { console.error('[conta-portal-avisos] pendientes', error.message); return json(500, { ok: false, error: 'No se han podido leer los avisos.' }) }
  const lista = ((data ?? []) as Pendiente[]).filter((p) => (TIPOS_AVISO as readonly string[]).includes(p.tipo))

  const marcas = new Map<string, MarcaGestoria>()
  const clientes = new Map<string, string>()
  const portal = portalBase(null, URL_BASE)
  const cuenta = { mandados: 0, esperan: 0, no_enviados: 0, errores: 0 }
  const hechos = { mensajes: [] as string[], peticiones: [] as string[] }

  for (const p of lista) {
    try {
      const k = `${p.account_id}:${p.party_id}`
      if (!marcas.has(k)) marcas.set(k, await marcaDe(srv, p.account_id, p.party_id))
      if (!clientes.has(p.party_id)) {
        const { data: c } = await srv.from('party').select('name').eq('account_id', p.account_id).eq('id', p.party_id).maybeSingle()
        clientes.set(p.party_id, String(c?.name ?? 'tu empresa'))
      }
      const marca = marcas.get(k)!
      const r = await mandar(srv, {
        cuenta: p.account_id, cliente: p.party_id, para: p.para, plantilla: PLANTILLA_AVISO, marca, esperarSiCerrado: true,
        correo: correoAviso(p, { ...marca, cliente: clientes.get(p.party_id)!, portal }),
        aviso: { tipo: p.tipo, clave: p.clave },
      })
      if (r.enviado) {
        cuenta.mandados++
        const a = avisados(p)
        hechos.mensajes.push(...a.mensajes); hechos.peticiones.push(...a.peticiones)
      } else if (r.espera) cuenta.esperan++
      else cuenta.no_enviados++
    } catch (x) {
      cuenta.errores++
      console.error('[conta-portal-avisos]', p.tipo, x instanceof Error ? x.message : String(x))
    }
  }

  if (hechos.mensajes.length || hechos.peticiones.length) {
    const { error: e } = await srv.rpc('conta_portal_avisos_hechos', { p_mensajes: hechos.mensajes, p_peticiones: hechos.peticiones })
    if (e) { console.error('[conta-portal-avisos] hechos', e.message); cuenta.errores++ }
  }
  console.log(`[conta-portal-avisos] ${lista.length} pendientes: ${JSON.stringify(cuenta)}`)
  return json(200, { ok: cuenta.errores === 0, pendientes: lista.length, ...cuenta })
})
