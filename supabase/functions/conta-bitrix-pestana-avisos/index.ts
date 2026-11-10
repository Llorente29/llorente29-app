// supabase/functions/conta-bitrix-pestana-avisos/index.ts
//
// GB · nº 13, punto 4 · LAS TAREAS EN BITRIX24 a partir de lo que pasa en
// Sumied, por la API (sin robots que configurar a mano):
//   · recibo devuelto → al responsable de la ficha;
//   · mandato sin firmar a los 7 días → al responsable (el comercial);
//   · alta o baja pedida en el portal → al jefe del Dpto. Laboral (si el
//     webhook no puede leer los departamentos, al responsable de la ficha).
// Cada una se cierra sola cuando se resuelve en Sumied.
//
// La despierta el cron (conta_bitrix_pestana_avisos_despertar, cada 15 minutos,
// solo si hay algo), con x-cron-secret = CRON_SECRET y sin sesión
// (verify_jwt = false en config.toml). Pide lo que toca
// (conta_bitrix_pestana_avisos_por_hacer), lo pone o lo cierra con el webhook
// de la conexión (conta_crm_secreto, de Vault) y lo apunta
// (conta_bitrix_pestana_aviso_apuntar), también lo que no se ha podido y por qué.
//
// SOLO EL BITRIX24 DE PRUEBAS: la base solo da conexiones de pruebas, y aquí se
// comprueba además que el webhook es del portal de pruebas (avisos.ts).
// Una petición cada 500 ms (el límite de Bitrix24 son 2 por segundo).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { jefeDeLaboral, responsableDe, tareaDe, webhookDePruebas, type PorAbrir } from './avisos.ts'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function b24(url: string, metodo: string, cuerpo: Record<string, unknown>): Promise<{ result?: unknown; error?: string; error_description?: string } | null> {
  await esperar(500)
  const r = await fetch(`${url}${metodo}.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  return await r.json().catch(() => null)
}
const porqueDe = (r: { error?: string; error_description?: string } | null) => String(r?.error_description || r?.error || 'sin respuesta').slice(0, 120)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Solo POST.' })
  const secreto = Deno.env.get('CRON_SECRET') ?? ''
  if (!secreto || req.headers.get('x-cron-secret') !== secreto) return json(401, { error: 'Solo el cron.' })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data, error } = await db.rpc('conta_bitrix_pestana_avisos_por_hacer', { p_limite: 50 })
  if (error) return json(500, { error: `No se ha podido leer lo que toca: ${error.message}` })
  const abrir = ((data as { abrir?: PorAbrir[] })?.abrir ?? [])
  const cerrar = ((data as { cerrar?: { id: string; cuenta: string; bitrix_id: string }[] })?.cerrar ?? [])

  // El webhook de cada cuenta, una vez (y la puerta: solo el de pruebas).
  const webhooks = new Map<string, { ok: true; url: string; laboral: number | null | undefined } | { ok: false; porque: string }>()
  const webhookDe = async (cuenta: string) => {
    if (!webhooks.has(cuenta)) {
      const { data: sec } = await db.rpc('conta_crm_secreto', { p_account: cuenta, p_crm: 'bitrix24' })
      const fila = Array.isArray(sec) ? sec[0] : sec
      const w = webhookDePruebas(fila?.entorno, fila?.url)
      webhooks.set(cuenta, w.ok ? { ...w, laboral: undefined } : w)
    }
    return webhooks.get(cuenta)!
  }

  const hecho = { abiertas: 0, cerradas: 0, no_se_pudo: 0 }
  for (const a of abrir) {
    const w = await webhookDe(a.cuenta)
    if (!w.ok) {
      await db.rpc('conta_bitrix_pestana_aviso_apuntar', { p: { ...a, estado: 'no_se_pudo', porque: w.porque } })
      hecho.no_se_pudo++
      continue
    }
    try {
      let responsable: number | null = null
      if (a.laboral) {
        if (w.laboral === undefined) w.laboral = jefeDeLaboral(await b24(w.url, 'department.get', {}))
        responsable = w.laboral ?? null
      }
      if (!responsable) responsable = responsableDe(await b24(w.url, a.tipo_ficha === 'empresa' ? 'crm.company.get' : 'crm.contact.get', { id: a.id_externo }))
      const r = await b24(w.url, 'crm.activity.todo.add', tareaDe(a, responsable, new Date()))
      const id = (r?.result as { id?: unknown } | undefined)?.id
      await db.rpc('conta_bitrix_pestana_aviso_apuntar', { p: id
        ? { ...a, estado: 'abierta', bitrix_id: String(id), porque: null }
        : { ...a, estado: 'no_se_pudo', porque: `Bitrix24 no ha dejado ponerla: ${porqueDe(r)}.` } })
      if (id) hecho.abiertas++; else hecho.no_se_pudo++
    } catch (e) {
      await db.rpc('conta_bitrix_pestana_aviso_apuntar', { p: { ...a, estado: 'no_se_pudo', porque: `Bitrix24 no contesta (${e instanceof Error ? e.name : 'error'}).` } })
      hecho.no_se_pudo++
    }
  }
  for (const c of cerrar) {
    const w = await webhookDe(c.cuenta)
    if (!w.ok) continue
    try {
      const r = await b24(w.url, 'crm.activity.update', { id: Number(c.bitrix_id), fields: { COMPLETED: 'Y' } })
      if (r?.result) {
        await db.rpc('conta_bitrix_pestana_aviso_apuntar', { p: { id: c.id, estado: 'cerrada', porque: 'Resuelto en Sumied: se ha cerrado sola.' } })
        hecho.cerradas++
      } else {
        await db.rpc('conta_bitrix_pestana_aviso_apuntar', { p: { id: c.id, estado: 'abierta', porque: `Resuelto en Sumied, pero Bitrix24 no ha dejado cerrarla: ${porqueDe(r)}.` } })
      }
    } catch (e) {
      console.warn(JSON.stringify({ gb: 'avisos', cerrar: c.id, porque: e instanceof Error ? e.name : 'error' }))
    }
  }
  console.log(JSON.stringify({ gb: 'avisos', ...hecho }))
  return json(200, hecho)
})
