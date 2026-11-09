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
import { FRASE_DE, leerAlmohadilla, modeloPestana, nombreDelMes, reciboPrevisto, type Cambio, type Estado, type Pestana } from './bitrixPestanaModelo'

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

/** nº 9 · Lo de esta apertura: la ficha (para «hacer»), lo leído, el formulario abierto y lo último hecho. */
const vista: {
  ficha: { a: string; p: string; t: string; id: string } | null
  r: Record<string, unknown> | null
  abierto: null | { tipo: 'alta' } | { tipo: 'baja'; linea: string; nombre: string } | { tipo: 'tarifa'; linea: string }
  hecho: null | { titulo: string; texto: string; bitrix: string; tono: 'bien' | 'aviso' | 'mal' }
  guardando: boolean
} = { ficha: null, r: null, abierto: null, hecho: null, guardando: false }

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
  for (const s of p.servicios) {
    servicios.append(h('div', { class: 'fila' }, h('span', {}, h('b', {}, s.texto), h('div', { class: 'pequeno' }, s.detalle)),
      h('span', { class: 'derecha con-enlace' }, s.importe, s.lineaId && s.servicioId && !vista.abierto ? enlaceBoton('Cambiar', () => abrir_({ tipo: 'tarifa', linea: s.lineaId! })) : null)))
    if (vista.abierto?.tipo === 'tarifa' && vista.abierto.linea === s.lineaId) servicios.append(formulario(p))
  }
  for (const s of p.sueltos) servicios.append(h('div', { class: 'fila' }, h('span', {}, h('b', {}, s.texto), h('div', { class: 'pequeno' }, 'Trabajo suelto')), h('span', { class: 'derecha' }, s.importe)))

  const trabajadores = h('section', { class: 'bloque', 'aria-labelledby': 'gb-trab' },
    h('div', { class: 'titulo-con-boton' }, h('h2', { id: 'gb-trab' }, `Trabajadores · ${p.trabajadores.length}`),
      p.serviciosPorTrabajador.length && !vista.abierto ? boton('+ Dar de alta', 'primario', () => abrir_({ tipo: 'alta' })) : null))
  if (vista.abierto && vista.abierto.tipo !== 'tarifa') trabajadores.append(formulario(p))
  if (!p.trabajadores.length) trabajadores.append(h('div', { class: 'vacio' }, 'No tiene trabajadores en Sumied.'))
  const A_LA_VISTA = 8
  for (const t of p.trabajadores.slice(0, A_LA_VISTA)) {
    trabajadores.append(h('div', { class: 'fila' }, h('span', {}, t.nombre, ' ', h('span', { class: 'pequeno' }, `· ${t.desde.toLowerCase()}`)),
      h('span', { class: 'derecha con-enlace' }, t.importe ?? '',
        t.lineaId && !vista.abierto ? enlaceBoton('Dar de baja', () => abrir_({ tipo: 'baja', linea: t.lineaId!, nombre: t.nombre })) : null)))
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
      vista.hecho ? h('div', { class: 'aviso hecho', role: 'status', 'data-tono': vista.hecho.tono, 'data-prueba': 'hecho' },
        h('b', {}, vista.hecho.titulo), h('div', {}, vista.hecho.texto), h('div', { class: 'pequeno-claro' }, vista.hecho.bitrix)) : null,
      p.aviso ? h('div', { class: 'aviso', role: 'status', 'data-tono': p.aviso.tono }, p.aviso.texto) : null,
      h('div', { class: 'rejilla' }, izquierda, derecha)))
  // Lo que mide la e2e: cuánto tarda en estar pintada desde que se abre (menos de 1 s).
  performance.mark('gb-pintada')
}

function boton(texto: string, tipo: 'primario' | 'normal', alPulsar: () => void, desactivado = false): HTMLElement {
  const b = h('button', { type: 'button', class: `boton boton-${tipo}` }, texto) as HTMLButtonElement
  b.disabled = desactivado
  b.addEventListener('click', alPulsar)
  return b
}
function enlaceBoton(texto: string, alPulsar: () => void): HTMLElement {
  const b = h('button', { type: 'button', class: 'enlace' }, texto)
  b.addEventListener('click', alPulsar)
  return b
}
function abrir_(a: NonNullable<typeof vista.abierto>) { vista.abierto = a; vista.hecho = null; repintar() }
function cerrar_() { vista.abierto = null; repintar() }
function repintar() {
  const m = vista.r ? modeloPestana(vista.r, hoyEnMadrid()) : null
  if (m) pintar(m)
}
const mesDe = (hoy: string, mas: number) => { const a = Number(hoy.slice(0, 4)); const n = Number(hoy.slice(5, 7)) - 1 + mas; return `${a + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}` }

/** El formulario abierto (alta o baja), con el recibo nuevo antes de guardar. */
function formulario(p: Pestana): HTMLElement {
  const hoy = hoyEnMadrid()
  const etiqueta = vista.abierto?.tipo === 'alta' ? 'Alta de un trabajador' : vista.abierto?.tipo === 'baja' ? 'Baja de un trabajador' : 'Cambiar un servicio'
  const caja = h('form', { class: 'formulario', 'aria-label': etiqueta })
  const previsto = h('div', { class: 'previsto', role: 'status', 'data-prueba': 'previsto' })
  const guardar = h('button', { type: 'submit', class: 'boton boton-primario' },
    vista.abierto?.tipo === 'alta' ? 'Dar de alta' : vista.abierto?.tipo === 'baja' ? 'Dar de baja' : 'Guardar el cambio') as HTMLButtonElement
  let cambio: () => Cambio | null
  if (vista.abierto?.tipo === 'alta') {
    const nombre = h('input', { name: 'nombre', required: '', autocomplete: 'off' }) as HTMLInputElement
    const servicio = h('select', { name: 'servicio' }, ...p.serviciosPorTrabajador.map((x) => h('option', { value: x.id }, x.nombre))) as HTMLSelectElement
    // Como la ficha del G04: se cobra desde el mes que viene (o desde este).
    const desde = h('select', { name: 'desde' }, ...[1, 0].map((n) => h('option', { value: `${mesDe(hoy, n)}-01` }, `${nombreDelMes(mesDe(hoy, n)).replace(/^./, (x) => x.toUpperCase())} de ${mesDe(hoy, n).slice(0, 4)}`))) as HTMLSelectElement
    caja.append(h('div', { class: 'formulario-titulo' }, 'Alta de un trabajador'),
      h('div', { class: 'campos' }, h('label', {}, 'Nombre y apellidos', nombre),
        p.serviciosPorTrabajador.length > 1 ? h('label', {}, 'Servicio', servicio) : null,
        h('label', {}, 'Se cobra desde', desde)))
    cambio = () => nombre.value.trim() ? { accion: 'alta', servicio: servicio.value || p.serviciosPorTrabajador[0]?.id, nombre: nombre.value.trim(), desde: desde.value } : null
    for (const x of [nombre, servicio, desde]) x.addEventListener('input', () => calcular())
  } else if (vista.abierto?.tipo === 'tarifa') {
    const linea = vista.abierto.linea
    const sv = p.servicios.find((x) => x.lineaId === linea)!
    const desde = `${mesDe(hoy, 1)}-01`
    let nivel = sv.nivelId
    const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Nivel' })
    const pintarChips = () => chips.replaceChildren(...sv.niveles.map((n) => {
      const b = h('button', { type: 'button', class: 'chip-opcion', role: 'radio', 'aria-checked': String(n.id === nivel) }, n.nombre)
      b.addEventListener('click', () => { nivel = n.id; pintarChips(); calcular() })
      return b
    }))
    pintarChips()
    const especial = h('input', { type: 'checkbox', name: 'especial' }) as HTMLInputElement
    const precio = h('input', { name: 'precio', inputmode: 'decimal', autocomplete: 'off' }) as HTMLInputElement
    const motivo = h('input', { name: 'motivo', autocomplete: 'off' }) as HTMLInputElement
    const camposEspecial = h('div', { class: 'campos' }, h('label', {}, sv.porTrabajador ? 'Precio por trabajador' : 'Precio al mes', precio), h('label', {}, 'Por qué (lo verá tu equipo)', motivo))
    camposEspecial.hidden = true
    especial.addEventListener('change', () => { camposEspecial.hidden = !especial.checked; calcular() })
    caja.append(h('div', { class: 'formulario-titulo' }, `Cambiar la ${sv.texto.replace(/ · .*$/, '').toLowerCase()}`),
      ...(sv.niveles.length > 1 ? [chips] : []),
      h('label', { class: 'casilla' }, especial, 'Precio especial para este cliente'), camposEspecial,
      h('div', { class: 'pequeno' }, `Desde ${nombreDelMes(desde)}. Si el recibo sube más de un 30 %, al cobrar te pedirá «Lo he mirado, aprobar».`))
    cambio = () => {
      const importe = Number(precio.value.replace(/\./g, '').replace(',', '.'))
      const conPrecio = especial.checked
      if (conPrecio && (!precio.value.trim() || !Number.isFinite(importe) || importe < 0 || !motivo.value.trim())) return null
      if (!conPrecio && nivel === sv.nivelId) return null
      return { accion: 'tarifa', linea, servicio: sv.servicioId!, nivel, precio: conPrecio ? importe : null, porTrabajador: sv.porTrabajador, motivo: motivo.value.trim(), desde }
    }
    for (const x of [precio, motivo]) x.addEventListener('input', () => calcular())
  } else {
    const b = vista.abierto as { tipo: 'baja'; linea: string; nombre: string }
    const mes = `${hoy.slice(0, 7)}-01`
    caja.append(h('div', { class: 'formulario-titulo' }, `Baja de ${b.nombre}`),
      h('div', { class: 'pequeno' }, `${nombreDelMes(hoy).replace(/^./, (x) => x.toUpperCase())} se cobra entero: es la regla de tu gestoría (mes entero). Deja de cobrarse desde ${nombreDelMes(mesDe(hoy, 1))}.`))
    cambio = () => ({ accion: 'baja', linea: b.linea, mes })
  }
  function calcular() {
    const c = cambio()
    guardar.disabled = !c || vista.guardando
    if (!c || !vista.r || !p.empresaId) {
      previsto.textContent = vista.abierto?.tipo === 'tarifa' ? 'Elige otro nivel o pon un precio especial con su motivo para ver el recibo nuevo.' : 'Escribe el nombre para ver el recibo nuevo.'
      return
    }
    const r = reciboPrevisto(vista.r, hoy, p.empresaId, c)
    const porque = c.accion === 'alta'
      ? `+1 trabajador: ${c.nombre.toUpperCase()}, se cobra desde ${nombreDelMes(c.desde)}.`
      : c.accion === 'baja'
        ? `−1 trabajador: ${(vista.abierto as { nombre: string }).nombre}, deja de cobrarse desde ${nombreDelMes(mesDe(hoy, 1))}.`
        : [c.nivel !== p.servicios.find((x) => x.lineaId === c.linea)?.nivelId ? `Cambia a ${p.servicios.find((x) => x.lineaId === c.linea)?.niveles.find((n) => n.id === c.nivel)?.nombre ?? 'otro nivel'}.` : '',
           c.precio !== null ? `Precio especial: ${c.precio.toFixed(2).replace('.', ',')} €${c.porTrabajador ? ' por trabajador' : ' al mes'}. Por qué: ${c.motivo}.` : ''].filter(Boolean).join(' ')
    previsto.replaceChildren(h('b', {}, r.frase), h('div', { class: 'pequeno' }, porque))
  }
  calcular()
  caja.append(previsto, h('div', { class: 'botones' }, boton('Cancelar', 'normal', cerrar_), guardar))
  caja.addEventListener('submit', (e) => { e.preventDefault(); const c = cambio(); if (c) void guardarCambio(c) })
  return caja
}

/** Guardar: Sumied hace el cambio (con las funciones de la ficha) y la función actualiza Bitrix24. La pantalla dice lo que ha pasado (regla 8). */
async function guardarCambio(c: Cambio) {
  if (!vista.ficha || vista.guardando) return
  vista.guardando = true
  const datos = c.accion === 'alta'
    ? { empresa: modeloPestana(vista.r!, hoyEnMadrid())?.empresaId, servicio: c.servicio, nombre: c.nombre, desde: c.desde }
    : c.accion === 'baja' ? { linea: c.linea, mes: c.mes }
      : { linea: c.linea, desde: c.desde, ...(c.nivel ? { nivel: c.nivel } : {}), ...(c.precio !== null ? { precio: c.precio, motivo: c.motivo } : {}) }
  let r: Record<string, unknown>
  try { r = await llamar({ paso: 'hacer', ...vista.ficha, accion: c.accion, datos }) } catch { r = { estado: 'error' } }
  vista.guardando = false
  const nombre = c.accion === 'alta' ? c.nombre.toUpperCase() : (vista.abierto as { nombre?: string } | null)?.nombre ?? ''
  const titulos = { alta: [`Alta hecha: ${nombre}`, 'No se ha dado de alta'], baja: [`Baja hecha: ${nombre}`, 'No se ha dado de baja'],
    tarifa: [c.accion === 'tarifa' && c.precio !== null ? 'Precio especial guardado' : 'Nivel cambiado', 'No se ha cambiado'] }[c.accion]
  if (r.estado === 'ok') {
    const b = (r.bitrix ?? {}) as { hecho?: string; texto?: string }
    vista.abierto = null
    if (r.pestana && typeof r.pestana === 'object') vista.r = r.pestana as Record<string, unknown>
    vista.hecho = {
      titulo: titulos[0],
      texto: String(r.frase ?? ''),
      bitrix: b.hecho === 'escrito' ? `Bitrix24 actualizado: ${b.texto}` : String(b.texto ?? 'Bitrix24 no se ha tocado.'),
      tono: b.hecho === 'choque' ? 'aviso' : 'bien',
    }
  } else {
    vista.hecho = { titulo: titulos[1], texto: String(r.frase ?? FRASE_DE.error), bitrix: 'No ha cambiado nada.', tono: 'mal' }
  }
  repintar()
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

async function llamar(cuerpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${URL_BASE}/functions/v1/conta-bitrix-pestana`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(CLAVE ? { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` } : {}) },
    body: JSON.stringify(cuerpo),
  })
  return (await r.json().catch(() => ({ estado: 'error' }))) as Record<string, unknown>
}
const leer = (a: string, p: string, t: string, id: string) => llamar({ paso: 'leer', a, p, t, id })

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
    vista.ficha = { a: x.a, p: x.p, t: x.t, id: x.id }
    vista.r = r
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
