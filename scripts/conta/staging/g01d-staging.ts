// scripts/conta/staging/g01d-staging.ts
//
// G01d · Deja lista en STAGING la cuenta de pruebas de «Al instante» y la
// prueba, como lo haría una persona administradora desde Ajustes › Cobros
// (las mismas funciones y las mismas llamadas a la base que la pantalla). Lo
// lanza .github/workflows/g01d-staging.yml; los secretos llegan por el
// entorno y NUNCA se escriben: solo se dice si están y, de la dirección de
// Bitrix24, el nombre del portal.
//
//   npx tsx scripts/conta/staging/g01d-staging.ts preparar   conecta y enciende
//   npx tsx scripts/conta/staging/g01d-staging.ts leer       «Leer ahora» del CRM (para la huella)
//   npx tsx scripts/conta/staging/g01d-staging.ts rechazos   un aviso con el código malo a cada función: 401
//
// Solo lee Bitrix24 y GoCardless (las funciones de siempre). No escribe en
// ninguno de los dos.

import { mapaContactosDe, propuestaContactos } from '../../../supabase/functions/conta-bitrix-leer/contactosClientes.ts'
import type { CampoMedido } from '../../../supabase/functions/conta-bitrix-leer/mapa.ts'

const URL_BASE = 'https://oseymswjlzplqoxrfjzi.supabase.co'
export const CUENTA = '901d0000-0000-4000-8000-0000000000a0'
export const EMPRESA = '901d0000-0000-4000-8000-0000000000a9'
const CORREO = 'g01d.admin@g01d-prueba.test'

const env = (k: string): string => process.env[k] ?? ''
const ANON = env('VITE_SUPABASE_ANON_KEY')

type Fila = Record<string, unknown>
const fallo = (texto: string): never => { console.log(`::error::${texto}`); process.exit(1) }
const decir = (texto: string) => console.log(texto)

async function entrar(): Promise<string> {
  const clave = env('CLAVE_PRUEBAS')
  if (!clave) fallo('Falta la contraseña de un solo uso (CLAVE_PRUEBAS).')
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CORREO, password: clave }),
  })
  const d = await r.json().catch(() => null) as { access_token?: string; error_description?: string } | null
  if (!r.ok || !d?.access_token) fallo(`No se ha podido entrar como la administración de pruebas (${r.status}): ${d?.error_description ?? 'sin detalle'}.`)
  console.log(`::add-mask::${d!.access_token}`)
  return d!.access_token!
}

/** Una función del servidor, como la llama la pantalla. Devuelve el cuerpo (con «error» si falla). */
async function funcion(jwt: string, nombre: string, cuerpo: Fila): Promise<{ status: number; d: Fila }> {
  const r = await fetch(`${URL_BASE}/functions/v1/${nombre}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  })
  return { status: r.status, d: (await r.json().catch(() => ({}))) as Fila }
}

async function rpc(jwt: string, nombre: string, args: Fila): Promise<Fila> {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nombre}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  const d = await r.json().catch(() => null) as Fila | null
  if (!r.ok) fallo(`${nombre}: ${String(d?.message ?? r.status)}`)
  return d ?? {}
}

async function filaDelCrm(jwt: string): Promise<Fila | null> {
  const r = await fetch(`${URL_BASE}/rest/v1/conta_crm?account_id=eq.${CUENTA}&crm=eq.bitrix24&select=mapa,campos_medidos_contactos,mapa_contactos,portal,empresas_leidas,aviso_encendido`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  })
  const d = await r.json().catch(() => []) as Fila[]
  return d[0] ?? null
}

const conFrase = (que: string, x: { status: number; d: Fila }) => {
  if (x.status !== 200 || x.d.error) fallo(`${que}: ${String(x.d.error ?? `contesta ${x.status}`)}`)
  decir(`✓ ${que}: ${String(x.d.frase ?? 'hecho')}`)
  return x.d
}

async function preparar() {
  const faltan = ['G01D_B24_ENTRANTE_URL', 'G01D_B24_SALIDA_TOKEN', 'G01D_GC_SANDBOX_TOKEN', 'G01D_GC_SANDBOX_WEBHOOK_SECRET'].filter((k) => !env(k))
  if (faltan.length) fallo(`Faltan estos secretos de Actions: ${faltan.join(', ')}.`)
  const jwt = await entrar()

  // 1 · El CRM: conectar con el webhook entrante (entorno pruebas). Mide los campos, propone el mapa y lee.
  const c = conFrase('Bitrix24 conectado', await funcion(jwt, 'conta-bitrix-leer', { accion: 'conectar', cuenta: CUENTA, entorno: 'pruebas', url: env('G01D_B24_ENTRANTE_URL').trim() }))
  decir(`  Portal: ${String(c.portal ?? '—')}. Qué es cada campo:`)
  for (const q of (c.queEsCadaUno ?? []) as { campo: string; codigo: string | null; nota: string | null }[]) decir(`  · ${q.campo}: ${q.codigo ?? 'sin campo'}${q.nota ? ` (${q.nota})` : ''}`)

  // 2 · El mapa de las empresas: se confirma el propuesto, como «Confirmar el mapa y leer».
  let fila = await filaDelCrm(jwt)
  if (!fila?.mapa) fallo('Conectado, pero sin mapa guardado.')
  decir(`✓ ${String((await rpc(jwt, 'conta_crm_confirmar_mapa', { p_account: CUENTA, p_crm: 'bitrix24', p_tipo_ficha: 'empresa', p_mapa: fila!.mapa })).frase)}`)

  // 3 · El de los contactos: lo que propone la pantalla con lo medido (propuestaContactos), confirmado.
  fila = await filaDelCrm(jwt)
  const medidos = fila?.campos_medidos_contactos as Record<string, CampoMedido> | null
  if (!medidos) fallo('Aún no se han medido los campos de contacto del portal.')
  const eleccion = propuestaContactos(medidos!)
  decir(`  Contactos: NIF ${eleccion.nif ?? '—'} · dirección ${eleccion.direccion ?? '—'} · cuota ${eleccion.cuota ?? '—'} · tipo de cliente ${eleccion.tipoCliente ?? '—'}`)
  decir(`✓ ${String((await rpc(jwt, 'conta_crm_confirmar_mapa', { p_account: CUENTA, p_crm: 'bitrix24', p_tipo_ficha: 'contacto', p_mapa: mapaContactosDe(eleccion, medidos!) })).frase)}`)
  conFrase('Leído Bitrix24 con los dos mapas', await funcion(jwt, 'conta-bitrix-leer', { accion: 'leer', cuenta: CUENTA }))

  // 4 · GoCardless (sandbox): conectar con el token de solo lectura.
  conFrase('GoCardless conectado', await funcion(jwt, 'conta-gocardless-leer', { accion: 'conectar', empresa: EMPRESA, entorno: 'pruebas', token: env('G01D_GC_SANDBOX_TOKEN').trim() }))

  // 5 · «Al instante»: el código y el secreto, a Vault (conta_aviso_configurar), encendidos; y «Probar».
  decir(`✓ ${String((await rpc(jwt, 'conta_aviso_configurar', { p_account: CUENTA, p_origen: 'crm', p_crm: 'bitrix24', p_company: null, p_codigo: env('G01D_B24_SALIDA_TOKEN').trim(), p_encender: true })).frase)}`)
  decir(`✓ ${String((await rpc(jwt, 'conta_aviso_configurar', { p_account: CUENTA, p_origen: 'gocardless', p_crm: null, p_company: EMPRESA, p_codigo: env('G01D_GC_SANDBOX_WEBHOOK_SECRET').trim(), p_encender: true })).frase)}`)
  for (const [que, nombre, cuerpo] of [
    ['Probar «Al instante» de Bitrix24', 'conta-crm-aviso', { accion: 'probar', cuenta: CUENTA, crm: 'bitrix24' }],
    ['Probar «Al instante» de GoCardless', 'conta-gocardless-aviso', { accion: 'probar', empresa: EMPRESA }],
  ] as const) {
    const x = await funcion(jwt, nombre, cuerpo)
    if (x.d.ok !== true) fallo(`${que}: ${String(x.d.frase ?? x.d.error ?? `contesta ${x.status}`)}`)
    decir(`✓ ${que}: ${String(x.d.frase)}`)
  }
}

async function leer() {
  const jwt = await entrar()
  conFrase('Leer ahora (Bitrix24)', await funcion(jwt, 'conta-bitrix-leer', { accion: 'leer', cuenta: CUENTA }))
}

/** Un aviso con un código que no es: las dos funciones tienen que contestar 401 y apuntarlo «rechazado». */
async function rechazos() {
  const form = new URLSearchParams({ event: 'ONCRMCOMPANYUPDATE', 'data[FIELDS][ID]': '1', ts: String(Math.floor(Date.now() / 1000)),
    'auth[domain]': 'portal.invalid', 'auth[member_id]': 'g01d', 'auth[application_token]': 'codigo-que-no-es-0000000000' })
  const b = await fetch(`${URL_BASE}/functions/v1/conta-crm-aviso?cuenta=${CUENTA}&crm=bitrix24`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  })
  const g = await fetch(`${URL_BASE}/functions/v1/conta-gocardless-aviso?empresa=${EMPRESA}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Webhook-Signature': '0'.repeat(64) },
    body: JSON.stringify({ events: [{ id: 'EVG01DPRUEBA', resource_type: 'payments', action: 'confirmed', links: { payment: 'PMG01D' }, created_at: new Date().toISOString() }] }),
  })
  decir(`Bitrix24 con el código malo: ${b.status} · GoCardless con la firma mala: ${g.status}`)
  if (b.status !== 401 || g.status !== 401) fallo('Un aviso con el código o la firma mala tiene que contestar 401.')
  decir('✓ Los dos rechazan el aviso que no es auténtico.')
}

const modo = process.argv[2]
const hacer = { preparar, leer, rechazos }[modo as 'preparar' | 'leer' | 'rechazos']
if (!hacer) fallo('uso: g01d-staging.ts preparar | leer | rechazos')
await hacer!()
