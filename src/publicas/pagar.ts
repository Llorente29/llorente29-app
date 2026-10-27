// src/publicas/pagar.ts
//
// PC01 · Entrega 4 · La página para PAGAR una factura con tarjeta o Bizum, sin
// cuenta (pagar.html?t=<enlace>). Entrada aparte de Vite, como la del mandato:
// no pasa por la app, no lleva React y pesa poco (la abre el cliente desde el
// correo del recordatorio, en el móvil).
//
//   · Lee la factura con el enlace (conta_enlace_pago_ver, anon): de quién es,
//     el número, lo pendiente y con qué se puede pagar (tarjeta y, si está
//     activo, Bizum). Si ya está pagada o cobrada, lo dice.
//   · «Pagar …» llama a conta-pago, que abre la página de pago de Stripe.
//   · A la vuelta (?vuelta=ok) dice que el pago está hecho o que Stripe lo está
//     confirmando (Bizum se autoriza en el móvil): el cobro lo apunta el aviso
//     de Stripe, no esta página.
// Todo lo que viene de la base se pinta como TEXTO (textContent), nunca como HTML.

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const CLAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

interface Enlace {
  estado: 'abierto' | 'pagado' | 'cobrada' | 'anulado' | 'sin_cobro' | 'no_existe'
  empresa?: string | null
  color?: string | null
  factura?: string | null
  fecha?: string | null
  vence?: string | null
  total?: number | null
  pendiente?: number | null
  metodos?: ('tarjeta' | 'bizum')[]
  pagado?: { el: string | null; con: string | null; importe: number | null } | null
}

const euros = (x: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x)} €`
const fecha = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

async function llamar<T>(url: string, cuerpo: Record<string, unknown>): Promise<T> {
  if (!URL_BASE || !CLAVE) throw new Error('Esta página no está bien configurada. Avisa a quien te mandó el enlace.')
  const r = await fetch(`${URL_BASE}${url}`, {
    method: 'POST',
    headers: { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const datos = await r.json().catch(() => null) as unknown
  if (!r.ok) {
    const m = (datos as { message?: string; texto?: string } | null)
    throw new Error(m?.texto || m?.message || 'No se ha podido conectar. Inténtalo de nuevo en un momento.')
  }
  return datos as T
}

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, texto?: string | null, atributos: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (texto !== undefined && texto !== null) e.textContent = texto
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v)
  return e
}

function cabecera(e: Enlace, raiz: HTMLElement) {
  if (e.color && /^#[0-9a-f]{6}$/i.test(e.color)) document.documentElement.style.setProperty('--marca', e.color)
  const caja = el('section', null, { class: 'caja' })
  const dl = el('dl')
  for (const [k, v] of [['Factura', e.factura], ['Fecha', fecha(e.fecha)], ['Vence', fecha(e.vence)], ['Total', e.total != null ? euros(e.total) : null]] as [string, string | null | undefined][]) {
    dl.append(el('dt', k), el('dd', v || '—'))
  }
  caja.append(el('p', e.empresa ?? '', { class: 'empresa' }), dl)
  raiz.append(caja)
  return caja
}

/** «tarjeta» o «tarjeta y Bizum»: con qué deja pagar el enlace, para ir dentro de una frase. */
export function metodosEnFrase(m: readonly string[] | undefined): string {
  const xs = (m ?? []).map((x) => (x === 'bizum' ? 'Bizum' : 'tarjeta'))
  return xs.length === 2 ? `${xs[0]} y ${xs[1]}` : xs[0] ?? 'tarjeta'
}

async function arrancar() {
  const raiz = document.getElementById('pagar')!
  const q = new URLSearchParams(window.location.search)
  const token = q.get('t') ?? ''
  const vuelta = q.get('vuelta')
  const solo = (texto: string, tono: 'bien' | 'mal' = 'mal') => raiz.replaceChildren(el('h1', 'Pagar la factura'), el('p', texto, { class: 'aviso', 'data-tono': tono, role: tono === 'mal' ? 'alert' : 'status' }))
  if (!/^[0-9a-f]{64}$/.test(token)) { solo('Este enlace no está completo. Ábrelo otra vez desde el correo.'); return }
  try {
    const e = await llamar<Enlace>('/rest/v1/rpc/conta_enlace_pago_ver', { p_token: token })
    raiz.replaceChildren(el('h1', 'Pagar la factura'))
    if (e.estado === 'no_existe') { solo('Este enlace no existe. Ábrelo otra vez desde el correo.'); return }
    if (e.estado === 'pagado' || (vuelta === 'ok' && e.estado !== 'abierto')) {
      raiz.append(el('p', e.pagado?.importe != null
        ? `Pagado: ${euros(e.pagado.importe)} con ${e.pagado.con === 'bizum' ? 'Bizum' : 'tarjeta'}${e.pagado.el ? ` el ${fecha(e.pagado.el.slice(0, 10))}` : ''}. Gracias.`
        : 'Esta factura ya está pagada. Gracias.', { class: 'aviso', 'data-tono': 'bien', role: 'status' }))
      cabecera(e, raiz); return
    }
    if (vuelta === 'ok') {
      raiz.append(el('p', 'Pago recibido: Stripe lo está confirmando. Si has pagado con Bizum, termina de aceptarlo en el móvil. No hace falta que hagas nada más.', { class: 'aviso', 'data-tono': 'bien', role: 'status' }))
      cabecera(e, raiz); return
    }
    if (e.estado === 'cobrada') { raiz.append(el('p', 'Esta factura no tiene nada pendiente de pagar. Gracias.', { class: 'aviso', 'data-tono': 'bien', role: 'status' })); cabecera(e, raiz); return }
    if (e.estado === 'anulado') { solo('Este enlace ya no vale. Pide otro a quien te lo mandó.'); return }
    if (e.estado === 'sin_cobro') { solo(`${e.empresa ?? 'La empresa'} aún no cobra con tarjeta por aquí. Pregúntale cómo pagar.`); return }
    if (vuelta === 'no') raiz.append(el('p', 'No se ha hecho ningún pago. Puedes intentarlo otra vez.', { class: 'aviso', 'data-tono': 'mal', role: 'status' }))
    const caja = cabecera(e, raiz)
    caja.append(el('p', euros(Number(e.pendiente ?? 0)), { class: 'importe' }), el('p', 'Pendiente de pagar', { class: 'ayuda' }))
    const metodos = el('ul', null, { class: 'metodos', 'aria-label': 'Puedes pagar con' })
    for (const m of e.metodos ?? []) metodos.append(el('li', m === 'bizum' ? 'Bizum' : 'Tarjeta'))
    caja.append(metodos)
    const fallo = el('p', null, { class: 'aviso', 'data-tono': 'mal', role: 'alert', hidden: '' })
    const boton = el('button', `Pagar ${euros(Number(e.pendiente ?? 0))}`, { type: 'button' }) as HTMLButtonElement
    boton.addEventListener('click', async () => {
      fallo.hidden = true; boton.disabled = true; boton.textContent = 'Abriendo el pago…'
      try {
        const r = await llamar<{ ok: boolean; url?: string; texto?: string }>('/functions/v1/conta-pago', { token, origen: window.location.origin })
        if (!r.ok || !r.url) throw new Error(r.texto || 'No se ha podido abrir el pago.')
        window.location.assign(r.url)
      } catch (x) {
        fallo.textContent = (x as Error).message; fallo.hidden = false
        boton.disabled = false; boton.textContent = `Pagar ${euros(Number(e.pendiente ?? 0))}`
      }
    })
    caja.append(fallo, boton, el('p', `Pagas en la página segura de Stripe, con ${metodosEnFrase(e.metodos)}. ${e.empresa ?? 'La empresa'} no ve los datos de tu tarjeta.`, { class: 'ayuda' }))
  } catch (x) {
    solo((x as Error).message)
  }
}

void arrancar()
