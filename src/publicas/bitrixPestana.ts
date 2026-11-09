// src/publicas/bitrixPestana.ts
//
// GB · La pestaña «Sumied» dentro de la ficha de Bitrix24 (primera parte: solo
// ver). Entrada aparte de Vite, como pagar.html: no pasa por la app ni lleva
// React, para abrir en menos de 1 segundo dentro de la pestaña.
//
//   · Llega desde conta-bitrix-pestana con el token, el portal y la ficha
//     detrás del «#». Se leen y se BORRAN de la dirección en el acto.
//   · UNA sola llamada (conta-bitrix-pestana, paso «leer»): el servidor
//     comprueba con Bitrix24 quién mira y, solo entonces, lee Sumied como esa
//     persona. Lo que llega pasa por el modelo de la ficha del G04
//     (bitrixPestanaModelo.ts): la pestaña dice lo mismo que Sumied.
//   · Si es la instalación (#instalar=1), termina la instalación en Bitrix24.
// Todo lo que viene de la base se pinta como TEXTO (textContent), nunca como HTML.

import { rutaClienteGestoria } from '../config/navegacion'
import { hoyEnMadrid } from '../modules/conta/lib/formato'
import { FRASE_DE, leerAlmohadilla, modeloPestana, type Estado, type Pestana } from './bitrixPestanaModelo'

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const CLAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const SDK_BITRIX = 'https://api.bitrix24.com/api/v1/'

type Hijo = Node | string | null | false | undefined
function h(etiqueta: string, atributos: Record<string, string> = {}, ...hijos: Hijo[]): HTMLElement {
  const e = document.createElement(etiqueta)
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v)
  for (const x of hijos) if (x) e.append(typeof x === 'string' ? document.createTextNode(x) : x)
  return e
}

const raiz = () => document.getElementById('pestana')!

function cabeza(texto: string, chip?: { texto: string; tono: string }): HTMLElement {
  return h('div', { class: 'cabeza' }, h('span', { class: 'logo' }, 'Sumied'), h('span', { class: 'cabeza-texto' }, texto),
    chip ? h('span', { class: 'chip', 'data-tono': chip.tono }, chip.texto) : null)
}

function pintarMensaje(titulo: string, texto: string, estado: string) {
  raiz().replaceChildren(cabeza('Cuotas, recibos y facturas'),
    h('div', { class: 'mensaje', role: 'status', 'data-estado': estado }, h('h1', {}, titulo), h('p', {}, texto)))
}

const TONO_A_CLASE: Record<string, string> = { bien: 'estado-bien', mal: 'estado-mal', aviso: 'estado-aviso', neutro: 'estado-neutro' }

function pintar(p: Pestana) {
  const enSumied = `${window.location.origin}${rutaClienteGestoria(p.clienteId, p.empresaId)}`
  const abrir = h('a', { class: 'abrir', href: enSumied, target: '_blank', rel: 'noopener' }, 'Abrir en Sumied ↗')

  const servicios = h('section', { class: 'bloque', 'aria-labelledby': 'gb-serv' }, h('h2', { id: 'gb-serv' }, 'Servicios que tiene'))
  if (!p.servicios.length && !p.sueltos.length) servicios.append(h('div', { class: 'vacio' }, 'No tiene servicios en Sumied.'))
  for (const s of p.servicios) servicios.append(h('div', { class: 'fila' }, h('span', {}, h('b', {}, s.texto), h('div', { class: 'pequeno' }, s.detalle)), h('span', { class: 'derecha' }, s.importe)))
  for (const s of p.sueltos) servicios.append(h('div', { class: 'fila' }, h('span', {}, h('b', {}, s.texto), h('div', { class: 'pequeno' }, 'Trabajo suelto')), h('span', { class: 'derecha' }, s.importe)))

  const trabajadores = h('section', { class: 'bloque', 'aria-labelledby': 'gb-trab' }, h('h2', { id: 'gb-trab' }, `Trabajadores · ${p.trabajadores.length}`))
  if (!p.trabajadores.length) trabajadores.append(h('div', { class: 'vacio' }, 'No tiene trabajadores en Sumied.'))
  const A_LA_VISTA = 8
  for (const t of p.trabajadores.slice(0, A_LA_VISTA)) {
    trabajadores.append(h('div', { class: 'fila' }, h('span', {}, t.nombre, ' ', h('span', { class: 'pequeno' }, `· ${t.desde.toLowerCase()}`)), h('span', { class: 'derecha' }, t.importe ?? '')))
  }
  if (p.trabajadores.length > A_LA_VISTA) trabajadores.append(h('a', { href: enSumied, target: '_blank', rel: 'noopener' }, `Ver los ${p.trabajadores.length} en Sumied →`))

  const izquierda = h('div', { class: 'columna' }, servicios, trabajadores)
  if (p.pendientes.length) {
    const pend = h('section', { class: 'bloque', 'aria-labelledby': 'gb-pend' }, h('h2', { id: 'gb-pend' }, `Pendiente de revisar · ${p.pendientes.length}`))
    for (const x of p.pendientes) pend.append(h('div', { class: 'fila' }, h('span', {}, x.porque)))
    izquierda.append(pend)
  }

  const recibo = h('section', { class: 'recibo', 'aria-labelledby': 'gb-rec' },
    h('div', { id: 'gb-rec', class: 'antetitulo' }, `Recibo de ${p.mesRecibo}`),
    h('div', { class: 'total' }, p.totalRecibo))
  if (!p.recibo.length) recibo.append(h('div', { class: 'linea' }, h('span', {}, `Nada en Sumied para ${p.mesRecibo}.`)))
  for (const l of p.recibo) {
    recibo.append(h('div', { class: 'linea' },
      h('span', {}, l.texto, h('div', { class: 'detalle' }, l.detalle), ...l.porque.map((x) => h('span', { class: 'porque' }, x))),
      h('b', { style: 'white-space: nowrap' }, l.importe)))
  }

  const cobros = h('section', { class: 'bloque', 'aria-labelledby': 'gb-cob' }, h('h2', { id: 'gb-cob', style: 'font-size: 15px' }, 'Cobros'))
  cobros.append(h('div', { class: 'cobro' }, h('span', { style: 'color: var(--suave)' }, 'Mandato SEPA'),
    p.mandato ? h('span', { class: TONO_A_CLASE[p.mandato.tono] }, p.mandato.texto.charAt(0).toUpperCase() + p.mandato.texto.slice(1)) : h('span', { class: 'estado-neutro' }, 'Sin mandato')))
  if (!p.cobros.length) cobros.append(h('div', { class: 'vacio' }, 'Ningún cobro en los últimos 12 meses.'))
  for (const c of p.cobros) cobros.append(h('div', { class: 'cobro' }, h('span', {}, `${c.fecha} · ${c.importe}`), h('span', { class: TONO_A_CLASE[c.tono] }, c.estado)))
  if (p.hayMasCobros) cobros.append(h('a', { href: enSumied, target: '_blank', rel: 'noopener' }, `Ver los ${p.cobros.length + p.hayMasCobros} cobros →`))

  const derecha = h('div', { class: 'columna' }, recibo, cobros, abrir)

  raiz().replaceChildren(
    cabeza(`Cuotas, recibos y facturas${p.emisora ? ` · le factura ${p.emisora}` : ''}`, { texto: p.situacion.texto, tono: p.situacion.tono }),
    h('div', { class: 'cuerpo' },
      h('div', { class: 'cliente' }, h('h1', {}, p.cliente),
        p.desde ? h('span', { class: 'pequeno' }, p.desde) : null,
        p.personaDeContacto ? h('span', { class: 'pequeno' }, '· Es una persona de contacto de este cliente') : null),
      p.aviso ? h('div', { class: 'aviso', role: 'status', 'data-tono': p.aviso.tono }, p.aviso.texto) : null,
      h('div', { class: 'rejilla' }, izquierda, derecha)))
  // Lo que mide la e2e: cuánto tarda en estar pintada desde que se abre (menos de 1 s).
  performance.mark('gb-pintada')
}

/** El SDK de Bitrix24, sin esperar por él: para terminar la instalación y ajustar el alto de la pestaña. */
function conBitrix(hacer: (bx: { installFinish?: () => void; fitWindow?: () => void }) => void) {
  const s = document.createElement('script')
  s.src = SDK_BITRIX
  s.async = true
  s.onload = () => {
    const bx = (window as unknown as { BX24?: { init: (f: () => void) => void; installFinish?: () => void; fitWindow?: () => void } }).BX24
    bx?.init(() => hacer(bx))
  }
  document.head.append(s)
}

async function leer(a: string, p: string, t: string, id: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${URL_BASE}/functions/v1/conta-bitrix-pestana`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(CLAVE ? { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` } : {}) },
    body: JSON.stringify({ paso: 'leer', a, p, t, id }),
  })
  return (await r.json().catch(() => ({ estado: 'error' }))) as Record<string, unknown>
}

async function arrancar() {
  const x = leerAlmohadilla(window.location.hash)
  // El token no se queda en la dirección ni en el historial.
  if (window.location.hash) history.replaceState(null, '', window.location.pathname)

  if (x.instalar) {
    if (x.instalar === 'fallo') {
      pintarMensaje('No se ha podido instalar', `Bitrix24 no ha dejado poner la pestaña: ${x.que ?? 'sin detalle'}.`, 'instalar_fallo')
      return
    }
    pintarMensaje('Sumied, instalado', 'Abre la ficha de una empresa o de un contacto: tienes la pestaña «Sumied».', 'instalado')
    conBitrix((bx) => bx.installFinish?.())
    return
  }
  if (!x.a || !x.p || !x.t || !x.id) {
    pintarMensaje('Abre la pestaña desde Bitrix24', 'Esta página se abre dentro de la ficha de una empresa o de un contacto de Bitrix24.', 'sin_datos')
    return
  }
  if (!URL_BASE) { pintarMensaje('Sumied no está disponible', FRASE_DE.error, 'error'); return }

  let r: Record<string, unknown>
  try { r = await leer(x.a, x.p, x.t, x.id) } catch { r = { estado: 'error' } }
  const estado = String(r.estado ?? 'error') as Estado
  if (estado === 'ok') {
    const m = modeloPestana(r, hoyEnMadrid())
    if (m) pintar(m)
    else pintarMensaje('Sin datos en Sumied', 'Este cliente está enlazado, pero todavía no tiene nada en Clientes y cuotas.', 'sin_datos')
  } else {
    const frase = typeof r.frase === 'string' ? r.frase : FRASE_DE[estado] ?? FRASE_DE.error
    const titulo = estado === 'sin_acceso' ? 'Sin acceso a Sumied' : estado === 'sin_enlazar' ? 'Ficha sin enlazar' : 'No se puede enseñar'
    pintarMensaje(titulo, frase, estado)
  }
  if (window.name.includes('|')) conBitrix((bx) => bx.fitWindow?.())
}

void arrancar()
