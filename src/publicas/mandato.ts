// src/publicas/mandato.ts
//
// PC01 · Entrega 3 · La página para FIRMAR un mandato de domiciliación SEPA,
// sin cuenta (mandato.html?t=<enlace>). Es una entrada aparte de Vite: no pasa
// por la app (ni por App.tsx ni por la sesión), no lleva React y pesa poco,
// porque la abre el cliente desde el correo, en el móvil.
//
//   · Lee el mandato con el enlace (conta_mandato_para_firmar, anon): quién
//     cobra, con su identificador de acreedor; a quién; la referencia; y si ya
//     está firmado, caducado o anulado.
//   · Para firmar: el nombre de quien firma, su NIF (si quiere), el IBAN
//     (comprobado aquí con el módulo 97 y otra vez en la base) y el «acepto» al
//     texto del mandato (el de las órdenes de domiciliación SEPA CORE). La base
//     apunta quién, cuándo, desde qué dirección y con qué navegador.
//   · Firmado, enseña la copia del mandato con «Guardar en PDF o imprimir».
// Todo lo que viene de la base se pinta como TEXTO (textContent), nunca como HTML.

import { formatearIban, validarIban } from '@/modules/conta/lib/iban'

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const CLAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

interface Mandato {
  estado: 'por_firmar' | 'firmado' | 'caducado' | 'anulado' | 'no_existe'
  ref?: string
  acreedor?: { nombre: string | null; identificador: string | null; direccion: string | null }
  deudor?: { nombre: string | null; nif: string | null }
  firmado?: { at: string; nombre: string; nif: string | null; iban: string } | null
}

/** El texto de la orden de domiciliación SEPA CORE (el de los formularios de los bancos españoles). */
export const TEXTO_MANDATO =
  'Mediante la firma de esta orden de domiciliación, el deudor autoriza (A) al acreedor a enviar instrucciones a la entidad del deudor para adeudar su cuenta y '
  + '(B) a la entidad para efectuar los adeudos en su cuenta siguiendo las instrucciones del acreedor. Como parte de sus derechos, el deudor está legitimado al '
  + 'reembolso por su entidad en los términos y condiciones del contrato suscrito con la misma. La solicitud de reembolso deberá efectuarse dentro de las ocho '
  + 'semanas que siguen a la fecha de adeudo en cuenta. Puede obtener información adicional sobre sus derechos en su entidad financiera.'

async function llamar<T>(funcion: string, cuerpo: Record<string, unknown>): Promise<T> {
  if (!URL_BASE || !CLAVE) throw new Error('Esta página no está bien configurada. Avisa a quien te mandó el enlace.')
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${funcion}`, {
    method: 'POST',
    headers: { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const datos = await r.json().catch(() => null) as unknown
  if (!r.ok) {
    const m = (datos as { message?: string } | null)?.message
    throw new Error(m || 'No se ha podido conectar. Inténtalo de nuevo en un momento.')
  }
  return datos as T
}

/** Un elemento con su texto (siempre como texto, nunca como HTML). */
function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, texto?: string | null, atributos: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (texto !== undefined && texto !== null) e.textContent = texto
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v)
  return e
}

function datos(filas: [string, string | null | undefined][]): HTMLDListElement {
  const dl = el('dl')
  for (const [k, v] of filas) { dl.append(el('dt', k), el('dd', v || '—')) }
  return dl
}

const fecha = (iso: string) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function cabecera(m: Mandato, raiz: HTMLElement) {
  raiz.append(
    el('h1', 'Orden de domiciliación de adeudo directo SEPA'),
    el('p', `Referencia del mandato: ${m.ref ?? '—'} · Tipo de pago: recurrente`, { class: 'sub' }),
  )
  const acreedor = el('section', null, { class: 'caja' })
  acreedor.append(el('h2', 'Quién cobra (el acreedor)'), datos([
    ['Nombre', m.acreedor?.nombre], ['Identificador del acreedor', m.acreedor?.identificador], ['Dirección', m.acreedor?.direccion],
  ]))
  const deudor = el('section', null, { class: 'caja' })
  deudor.append(el('h2', 'A quién (el deudor)'), datos([['Nombre', m.deudor?.nombre], ['NIF', m.deudor?.nif]]))
  const texto = el('section', null, { class: 'caja' })
  texto.append(el('p', TEXTO_MANDATO, { class: 'texto' }))
  raiz.append(acreedor, deudor, texto)
}

function firmado(m: Mandato, raiz: HTMLElement, frase?: string) {
  raiz.replaceChildren()
  if (frase) raiz.append(el('p', frase, { class: 'aviso', 'data-tono': 'bien', role: 'status' }))
  cabecera(m, raiz)
  const f = el('section', null, { class: 'caja' })
  f.append(el('h2', 'Firmado'), datos([
    ['Firmado por', m.firmado?.nombre], ['NIF de quien firma', m.firmado?.nif], ['Cuenta de cargo (IBAN)', m.firmado?.iban],
    ['Fecha y hora', m.firmado?.at ? fecha(m.firmado.at) : null], ['Cómo', 'Firma electrónica desde el enlace del correo'],
  ]))
  const imprimir = el('button', 'Guardar en PDF o imprimir', { type: 'button', class: 'no-imprimir' })
  imprimir.addEventListener('click', () => window.print())
  raiz.append(f, imprimir)
}

function formulario(m: Mandato, raiz: HTMLElement, token: string) {
  raiz.replaceChildren()
  cabecera(m, raiz)
  const form = el('form', null, { class: 'caja', novalidate: '' })
  const nombre = el('input', null, { type: 'text', id: 'nombre', autocomplete: 'name', required: '' }) as HTMLInputElement
  const nif = el('input', null, { type: 'text', id: 'nif', autocomplete: 'off' }) as HTMLInputElement
  const iban = el('input', null, { type: 'text', id: 'iban', autocomplete: 'off', inputmode: 'text', spellcheck: 'false', placeholder: 'ES00 0000 0000 0000 0000 0000' }) as HTMLInputElement
  const ayudaIban = el('p', 'La cuenta donde se cargarán los recibos, con las dos letras del país delante.', { class: 'ayuda', id: 'ayuda-iban' })
  const acepto = el('input', null, { type: 'checkbox', id: 'acepto' }) as HTMLInputElement
  const marca = el('label', null, { class: 'marca', for: 'acepto' })
  marca.append(acepto, el('span', 'He leído la orden de domiciliación y la acepto.'))
  const fallo = el('p', null, { class: 'aviso', 'data-tono': 'mal', role: 'alert', hidden: '' })
  const boton = el('button', 'Firmar el mandato', { type: 'submit' }) as HTMLButtonElement
  form.append(
    el('h2', 'Firma'),
    el('label', 'Nombre y apellidos de quien firma', { for: 'nombre' }), nombre,
    el('label', 'NIF de quien firma (si quieres)', { for: 'nif' }), nif,
    el('label', 'IBAN de la cuenta de cargo', { for: 'iban' }), iban, ayudaIban,
    marca, fallo, boton,
  )
  iban.addEventListener('input', () => {
    const v = iban.value.trim() ? validarIban(iban.value) : null
    ayudaIban.textContent = !v ? 'La cuenta donde se cargarán los recibos, con las dos letras del país delante.' : v.ok ? `Correcto: ${formatearIban(v.normalizado)}` : v.motivo
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    fallo.hidden = true
    const v = validarIban(iban.value)
    const error = nombre.value.trim().length < 3 ? 'Escribe el nombre de quien firma.' : !v.ok ? v.motivo : !acepto.checked ? 'Para firmar, marca que aceptas el mandato.' : null
    if (error) { fallo.textContent = error; fallo.hidden = false; return }
    boton.disabled = true; boton.textContent = 'Firmando…'
    try {
      const r = await llamar<{ frase: string }>('conta_mandato_firmar', { p_token: token, p_nombre: nombre.value.trim(), p_nif: nif.value.trim() || null, p_iban: v.ok ? v.normalizado : '', p_acepto: true })
      const nuevo = await llamar<Mandato>('conta_mandato_para_firmar', { p_token: token })
      firmado(nuevo, raiz, r.frase)
    } catch (x) {
      fallo.textContent = (x as Error).message; fallo.hidden = false
      boton.disabled = false; boton.textContent = 'Firmar el mandato'
    }
  })
  raiz.append(form)
}

async function arrancar() {
  const raiz = document.getElementById('mandato')!
  const token = new URLSearchParams(window.location.search).get('t') ?? ''
  const solo = (texto: string) => raiz.replaceChildren(el('h1', 'Mandato de domiciliación'), el('p', texto, { class: 'aviso', 'data-tono': 'mal', role: 'alert' }))
  if (!/^[0-9a-f]{64}$/.test(token)) { solo('Este enlace no está completo. Ábrelo otra vez desde el correo.'); return }
  try {
    const m = await llamar<Mandato>('conta_mandato_para_firmar', { p_token: token })
    if (m.estado === 'por_firmar') formulario(m, raiz, token)
    else if (m.estado === 'firmado') firmado(m, raiz)
    else if (m.estado === 'caducado') solo('Este enlace ha caducado. Pide otro a quien te lo mandó.')
    else if (m.estado === 'anulado') solo('Este enlace ya no vale: te han mandado otro más nuevo.')
    else solo('Este enlace no existe. Ábrelo otra vez desde el correo.')
  } catch (x) {
    solo((x as Error).message)
  }
}

void arrancar()
