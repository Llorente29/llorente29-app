// supabase/functions/_shared/portal/enviar.ts
//
// GP · Tarea 2b (Code 3, 09/11/2026) · LO QUE COMPARTEN conta-portal-entrar y
// conta-portal: mandar un correo del portal y preparar el enlace para entrar.
// Lo puro (los textos) está en portal.ts; aquí, el mundo.
//
//   · El correo sale de sumied.com con el nombre de la gestoría («Gestoría X
//     vía Sumied»), su logo y su color, y las respuestas van a su correo: como
//     las facturas (remitenteFactura) y el mandato (marco).
//   · La puerta de las demos: el correo de una cuenta de demo va SOLO al buzón
//     de pruebas (CORREO_BUZON_PRUEBAS). Sin buzón, no sale, y se dice.
//   · El freno (nº 11): en una demo NO se pasa por él, porque el destino ya es
//     solo el buzón (como la factura de un recibo, #533). En una cuenta de
//     verdad, «portal_enlace», «portal_codigo» y «portal_aviso» siguen cerrados
//     hasta que Julio los abra en CORREO_MARCA_ABIERTOS (cerrojoMarca).
//   · Cada correo queda en conta_portal_aviso con su clave: nunca dos veces lo
//     mismo, y la gestoría ve lo que se mandó.
//   · El enlace: generateLink de Supabase (magiclink), canjeado en la entrada del
//     portal con verifyOtp (token_hash), como /acceso del portal del trabajador.
//     Fuera de producción, el enlace va también en la respuesta, para probar.

import { cuentaPuedeSalir } from '../puerta.ts'
import { correoDeSalida } from '../puertaDePruebas.ts'
import { MARCAS } from '../marcas.ts'
import { frenoDelPortal } from './avisos.ts'
import { correoValido, remitenteFactura } from '../facturaVentaCorreo.ts'
import { origenFirma, type Correo, type Marca } from '../cobroCorreos.ts'

export const PRODUCCION = 'xzmpnchlguibclvxyynt'
export const DOMINIOS = Object.values(MARCAS).flatMap((m) => m.dominios)

// deno-lint-ignore no-explicit-any
type Srv = any

export interface MarcaGestoria extends Marca { correo: string | null; empresaId: string | null }

/** La marca de la gestoría para un cliente: su nombre, su logo (firmado 90 días) y su color. */
export async function marcaDe(srv: Srv, cuenta: string, cliente: string): Promise<MarcaGestoria> {
  const { data } = await srv.rpc('_conta_portal_marca', { p_account: cuenta, p_party: cliente })
  const m = (data ?? {}) as { nombre?: string; logo_ruta?: string | null; color?: string | null; correo?: string | null; empresa_id?: string | null }
  let logo: string | null = null
  if (m.logo_ruta) {
    const { data: f } = await srv.storage.from('company-logos').createSignedUrl(m.logo_ruta, 60 * 60 * 24 * 90)
    logo = f?.signedUrl ?? null
  }
  return { empresa: m.nombre ?? 'Tu gestoría', color: m.color ?? null, logo, correo: correoValido(m.correo), empresaId: m.empresa_id ?? null }
}

export interface Envio {
  cuenta: string
  cliente: string
  para: string
  correo: Correo
  plantilla: string
  marca: MarcaGestoria
  aviso: { tipo: 'invitacion' | 'enlace' | 'firma' | 'factura' | 'recibo_proximo' | 'devuelto' | 'mensaje' | 'peticion'; clave: string }
  /** Los avisos (T4): con el freno cerrado no se apunta nada, para que salgan cuando Julio lo abra. */
  esperarSiCerrado?: boolean
}

export type Resultado = { enviado: true; demo: boolean; para: string } | { enviado: false; demo: boolean; porque: string; espera?: boolean }

/** Manda un correo del portal por la puerta y el freno, y lo apunta. */
export async function mandar(srv: Srv, e: Envio): Promise<Resultado> {
  const apuntar = (estado: string, detalle: string | null, para: string) =>
    srv.from('conta_portal_aviso').insert({ account_id: e.cuenta, party_id: e.cliente, tipo: e.aviso.tipo, clave: e.aviso.clave, para, estado, detalle,
      enviado_at: estado === 'enviado' || estado === 'buzon_de_pruebas' ? new Date().toISOString() : null })
  let para = e.para
  const demo = !(await cuentaPuedeSalir(srv, e.cuenta))
  if (demo) {
    const s = correoDeSalida(true, para, Deno.env.get('CORREO_BUZON_PRUEBAS'))
    if ('porque' in s) { await apuntar('no_enviado', s.porque, e.para); return { enviado: false, demo, porque: s.porque } }
    para = s.para
  }
  // En la demo, al buzón de pruebas sin el freno (nº 11, como el #533); en las de verdad, con él.
  const cerrojo = frenoDelPortal(demo, e.plantilla, para, Deno.env.get('CORREO_MARCA_ABIERTOS'))
  if (!cerrojo.abierto) {
    const porque = 'Los correos del portal a los clientes de verdad aún están cerrados (los abre Julio).'
    if (e.esperarSiCerrado) return { enviado: false, demo, porque, espera: true }
    await apuntar('no_enviado', porque, e.para)
    return { enviado: false, demo, porque }
  }
  const resend = Deno.env.get('RESEND_API_KEY')
  if (!resend) { await apuntar('error', 'Sin servicio de correo.', e.para); return { enviado: false, demo, porque: 'El servicio de correo no está configurado.' } }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: remitenteFactura(e.marca.empresa), to: [para], subject: e.correo.asunto, html: e.correo.html, text: e.correo.texto,
      ...(e.marca.correo ? { reply_to: e.marca.correo } : {}) }),
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { message?: string }
    await apuntar('error', `Resend ${r.status}: ${j.message ?? ''}`.slice(0, 300), e.para)
    return { enviado: false, demo, porque: 'El proveedor de correo lo ha rechazado.' }
  }
  await apuntar(demo ? 'buzon_de_pruebas' : 'enviado', demo ? `Demo: al buzón de pruebas en vez de ${e.para}.` : null, e.para)
  return { enviado: true, demo, para }
}

/** El usuario de un correo (el que hay o uno nuevo, sin contraseña que nadie conozca) y el enlace para entrar. */
export async function enlaceParaEntrar(srv: Srv, correo: string, origen: unknown, url: string): Promise<{ usuario: string; enlace: string } | { porque: string }> {
  const { data: ya } = await srv.rpc('_usuario_por_correo', { p_correo: correo })
  let usuario = (ya as string | null) ?? null
  if (!usuario) {
    const azar = crypto.getRandomValues(new Uint8Array(24))
    const { data: n, error } = await srv.auth.admin.createUser({ email: correo, password: btoa(String.fromCharCode(...azar)), email_confirm: true })
    if (error || !n?.user) return { porque: 'No se ha podido preparar tu acceso.' }
    usuario = n.user.id as string
  }
  const { data: link, error } = await srv.auth.admin.generateLink({ type: 'magiclink', email: correo })
  const hash = link?.properties?.hashed_token
  if (error || !hash) return { porque: 'No se ha podido preparar el enlace.' }
  const base = url.includes(PRODUCCION) ? origenFirma(origen, DOMINIOS) : (origenOPruebas(origen) ?? origenFirma(origen, DOMINIOS))
  return { usuario: usuario!, enlace: `${base}/portal.html?${new URLSearchParams({ token_hash: hash, type: 'magiclink' })}` }
}

/** Fuera de producción, la vuelta puede ser la dirección de pruebas (Vercel, localhost con https). */
function origenOPruebas(origen: unknown): string | null {
  try {
    const u = new URL(String(origen ?? ''))
    return u.protocol === 'https:' ? `https://${u.host}` : null
  } catch { return null }
}

/** La dirección del portal para volver (de GoCardless o de Stripe). */
export function portalBase(origen: unknown, url: string): string {
  return url.includes(PRODUCCION) ? origenFirma(origen, DOMINIOS) : (origenOPruebas(origen) ?? origenFirma(origen, DOMINIOS))
}
