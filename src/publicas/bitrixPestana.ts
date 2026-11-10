// src/publicas/bitrixPestana.ts
//
// GB · La pestaña «Sumied» dentro de la ficha de Bitrix24. Desde el nº 10, con
// sus pestañas por área (Resumen · Cuotas y cobros · Laboral · Portal). Entrada aparte de Vite, como pagar.html: no pasa por la app ni lleva
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
import { AREA_DE, areasDe, FRASE_DE, modeloDevueltos, leerAlmohadilla, modeloPestana, modeloMensajes, modeloPortal, modeloSueltos, nombreDelMes, pendientesDe, reciboPrevisto, sueltoPrevisto, type Area, type Cambio, type Devueltos, type Estado, type Mensajes, type Pestana, type Portal, type Sueltos } from './bitrixPestanaModelo'

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
  abierto: null | { tipo: 'alta' } | { tipo: 'suelto' } | { tipo: 'invitar' } | { tipo: 'contestar' } | { tipo: 'baja'; linea: string; nombre: string } | { tipo: 'tarifa'; linea: string } | { tipo: 'solicitud'; id: string }
  /** nº 9, punto 5 · Su portal (se lee después de pintar, para no retrasar la pestaña). */
  portal: Portal | null
  /** nº 10 · Si ya se intentó leer el portal (para decir «Leyendo…» o que no se pudo). */
  portalLeido: boolean
  /** nº 10 · La pestaña de área abierta: abre en Resumen. */
  area: Area
  /** nº 17, A · Sus recibos devueltos y lo que se puede hacer (llegan con «Su portal»). */
  devueltos: Devueltos | null
  /** nº 17, B · Sus trabajos fuera de la cuota y lo que se puede facturar (llegan con «Su portal»). */
  sueltos: Sueltos | null
  /** nº 17, C · Los últimos mensajes de su portal, con su texto (llegan con «Su portal»). */
  mensajes: Mensajes | null
  hecho: null | { titulo: string; texto: string; bitrix: string; tono: 'bien' | 'aviso' | 'mal'; deshacer?: { cuando: string } | null }
  guardando: boolean
} = { ficha: null, r: null, abierto: null, hecho: null, guardando: false, portal: null, portalLeido: false, area: 'resumen', devueltos: null, sueltos: null, mensajes: null }

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

  // nº 10 · Las pestañas por área, con su aviso. Cambiar de pestaña no lee nada: todo está ya leído.
  const pestanas = h('div', { class: 'areas', role: 'tablist', 'aria-label': 'Áreas de Sumied' })
  for (const a of areasDe(p, vista.portal)) {
    const b = h('button', { type: 'button', role: 'tab', class: 'area', 'aria-selected': String(vista.area === a.id), 'data-area': a.id },
      a.nombre, a.chip && a.tono ? h('span', { class: 'area-chip', 'data-tono': a.tono }, a.chip) : null)
    b.addEventListener('click', () => irA(a.id))
    pestanas.append(b)
  }

  const recibo = bloqueRecibo(p)
  const devuelto = vista.devueltos?.lista.length ? [bloqueDevuelto(vista.devueltos)] : []
  const [izquierda, derecha] = vista.area === 'cobros' ? [[bloqueServicios(p), bloqueSueltos(p)], [recibo, ...devuelto, bloqueCobros(p, enSumied)]]
    : vista.area === 'laboral' ? [[bloqueTrabajadores(p, enSumied)], [recibo]]
      : vista.area === 'portal' ? [[vista.portal ? suPortal(p, vista.portal, enSumied) : h('section', { class: 'bloque' }, h('h2', {}, 'Su portal'),
        h('div', { class: 'vacio' }, vista.portalLeido ? 'No se ha podido leer su portal. Ábrelo en Sumied.' : 'Leyendo su portal…'))], [recibo]]
        : [[bloquePendiente(p), bloqueDatos(p)], [recibo, ...devuelto, bloqueCobros(p, enSumied)]]

  raiz().replaceChildren(
    cabeza(`Cuotas, recibos y facturas${p.emisora ? ` · le factura ${p.emisora}` : ''}`, { texto: p.situacion.texto, tono: p.situacion.tono }),
    pestanas,
    h('div', { class: 'cuerpo', role: 'tabpanel', 'data-area': vista.area },
      h('div', { class: 'cliente' }, h('h1', {}, p.cliente),
        p.desde ? h('span', { class: 'pequeno' }, p.desde) : null,
        p.personaDeContacto ? h('span', { class: 'pequeno' }, '· Es una persona de contacto de este cliente') : null),
      vista.hecho ? h('div', { class: 'aviso hecho', role: 'status', 'data-tono': vista.hecho.tono, 'data-prueba': 'hecho' },
        h('b', {}, vista.hecho.titulo), h('div', {}, vista.hecho.texto),
        h('div', { class: 'pequeno-claro' }, vista.hecho.bitrix,
          // nº 13 · «Deshacer» (Code 1, #562): solo si lo último de hoy es este cambio y se puede.
          vista.hecho.deshacer && p.empresaId ? ' · ' : null,
          vista.hecho.deshacer && p.empresaId ? enlaceBoton('Deshacer', () => void deshacerCambio(vista.hecho!.deshacer!.cuando, p.empresaId!)) : null)) : null,
      p.aviso ? h('div', { class: 'aviso', role: 'status', 'data-tono': p.aviso.tono }, p.aviso.texto) : null,
      h('div', { class: 'rejilla' }, h('div', { class: 'columna' }, ...izquierda), h('div', { class: 'columna' }, ...derecha, abrir))))
  // Lo que mide la e2e: cuánto tarda en estar pintada desde que se abre (menos de 1 s).
  performance.mark('gb-pintada')
}

/** Cambiar de pestaña: cierra lo que estuviera a medias y no lee nada. */
function irA(a: Area) { vista.area = a; vista.abierto = null; vista.hecho = null; repintar() }

/** Resumen · «Lo pendiente con este cliente»: cada línea lleva a su pestaña. */
function bloquePendiente(p: Pestana): HTMLElement {
  const caja = h('section', { class: 'bloque', 'aria-labelledby': 'gb-pend' }, h('h2', { id: 'gb-pend' }, 'Lo pendiente con este cliente'))
  const lista = pendientesDe(p, vista.portal)
  if (!lista.length) caja.append(h('div', { class: 'vacio' }, vista.portal || vista.portalLeido ? 'Nada pendiente.' : 'Nada pendiente en cuotas y cobros. Leyendo su portal…'))
  for (const x of lista) {
    caja.append(h('div', { class: 'fila', 'data-prueba': 'pendiente' },
      h('span', {}, h('span', { class: 'etiqueta', 'data-tono': x.tono }, x.etiqueta), x.texto),
      h('span', { class: 'derecha con-enlace' }, enlaceBoton(`${x.boton} →`, () => irA(x.area)))))
  }
  return caja
}

/** Resumen · Lo que tiene, de un vistazo. */
function bloqueDatos(p: Pestana): HTMLElement {
  const dato = (t: string, v: string) => h('div', {}, h('div', { class: 'pequeno' }, t), h('b', {}, v))
  return h('section', { class: 'bloque datos' },
    dato('Servicios', p.servicios.map((s) => s.texto.replace(/ · .*$/, '')).join(' · ') || 'Ninguno'),
    dato('Trabajadores', String(p.trabajadores.length)),
    dato('Mandato', p.mandato ? p.mandato.texto.charAt(0).toUpperCase() + p.mandato.texto.slice(1) : 'Sin mandato'))
}

/** Cuotas y cobros · Servicios, con «Cambiar» (nivel y precio especial) y los trabajos sueltos. */
function bloqueServicios(p: Pestana): HTMLElement {
  const servicios = h('section', { class: 'bloque', 'aria-labelledby': 'gb-serv' }, h('h2', { id: 'gb-serv' }, 'Servicios que tiene'))
  if (!p.servicios.length && !p.sueltos.length) servicios.append(h('div', { class: 'vacio' }, 'No tiene servicios en Sumied.'))
  for (const s of p.servicios) {
    servicios.append(h('div', { class: 'fila' }, h('span', {}, h('b', {}, s.texto), h('div', { class: 'pequeno' }, s.detalle)),
      h('span', { class: 'derecha con-enlace' }, s.importe, s.lineaId && s.servicioId && !vista.abierto ? enlaceBoton('Cambiar', () => abrir_({ tipo: 'tarifa', linea: s.lineaId! })) : null)))
    if (vista.abierto?.tipo === 'tarifa' && vista.abierto.linea === s.lineaId) servicios.append(formulario(p))
  }
  // nº 17, B · Con «Trabajos fuera de la cuota» leído, los sueltos van allí (no dos veces).
  if (!vista.sueltos) for (const s of p.sueltos) servicios.append(h('div', { class: 'fila' }, h('span', {}, h('b', {}, s.texto), h('div', { class: 'pequeno' }, 'Trabajo suelto')), h('span', { class: 'derecha' }, s.importe)))
  return servicios
}

/** nº 17, B · Cuotas y cobros · «Trabajos fuera de la cuota», con «Facturar un trabajo» (Code 1: conta_trabajo_suelto_poner). */
function bloqueSueltos(p: Pestana): HTMLElement | null {
  const s = vista.sueltos
  if (!s) return null
  const caja = h('section', { class: 'bloque', 'aria-labelledby': 'gb-suel' },
    h('div', { class: 'titulo-con-boton' }, h('h2', { id: 'gb-suel' }, 'Trabajos fuera de la cuota'),
      s.puede && s.servicios.length && p.empresaId && !vista.abierto ? boton('Facturar un trabajo', 'normal', () => abrir_({ tipo: 'suelto' })) : null))
  if (vista.abierto?.tipo === 'suelto') caja.append(formularioSuelto(p, s))
  if (!s.puede) caja.append(h('div', { class: 'pequeno' }, 'Puedes verlos, pero solo un administrador o un encargado de la cuenta puede facturar un trabajo.'))
  else if (!s.servicios.length) caja.append(h('div', { class: 'pequeno' }, 'Tu tarifa no tiene servicios que se cobren «cada vez». Ponlos en Sumied para facturarlos desde aquí.'))
  if (!s.hechos.length && s.puede) caja.append(h('div', { class: 'vacio' }, 'Ninguno sin cobrar. Una renta, una escritura, una regularización: se factura desde aquí.'))
  for (const x of s.hechos) caja.append(h('div', { class: 'fila', 'data-prueba': 'suelto' }, h('span', {}, h('b', {}, x.texto), h('div', { class: 'pequeno' }, x.recibo)), h('span', { class: 'derecha' }, x.importe)))
  return caja
}

/** nº 17, B · «Facturar un trabajo»: servicio, concepto e importe (el de la tarifa, que se puede cambiar), con el recibo nuevo antes de guardar. */
function formularioSuelto(p: Pestana, s: Sueltos): HTMLElement {
  const caja = h('form', { class: 'formulario', 'aria-label': 'Facturar un trabajo' })
  const previsto = h('div', { class: 'previsto', role: 'status', 'data-prueba': 'previsto' })
  const guardar = h('button', { type: 'submit', class: 'boton boton-primario' }, 'Facturarlo') as HTMLButtonElement
  const servicio = h('select', { name: 'servicio' }, ...s.servicios.map((x) => h('option', { value: x.id }, x.nombre))) as HTMLSelectElement
  const concepto = h('input', { name: 'concepto', autocomplete: 'off', placeholder: s.servicios[0]?.nombre ?? '' }) as HTMLInputElement
  const importe = h('input', { name: 'importe', inputmode: 'decimal', autocomplete: 'off' }) as HTMLInputElement
  const elegido = () => s.servicios.find((x) => x.id === servicio.value) ?? s.servicios[0]
  // eslint-disable-next-line no-restricted-syntax -- importe ya filtrado a número finito en modeloSueltos
  const deLaTarifa = () => { const e = elegido(); importe.value = e ? e.importe.toFixed(2).replace('.', ',') : ''; concepto.placeholder = e?.nombre ?? '' }
  deLaTarifa()
  const mes = nombreDelMes(s.mes)
  // «Cobrarlo aparte ahora» espera a la decisión de Julio (con un recibo por cliente y mes): se ve, pero no se puede elegir.
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Cómo se cobra' },
    h('button', { type: 'button', class: 'chip-opcion', role: 'radio', 'aria-checked': 'true' }, `Sumarlo al recibo de ${mes}`),
    Object.assign(h('button', { type: 'button', class: 'chip-opcion', role: 'radio', 'aria-checked': 'false', title: 'Pendiente de decidir' }, 'Cobrarlo aparte ahora'), { disabled: true }))
  caja.append(h('div', { class: 'formulario-titulo' }, 'Facturar un trabajo'),
    h('div', { class: 'campos' }, h('label', {}, 'Servicio', servicio), h('label', {}, 'Concepto (lo verá el cliente)', concepto), h('label', {}, 'Importe', importe)),
    chips, h('div', { class: 'pequeno' }, `Se cobra con la cuota de ${mes}. «Cobrarlo aparte» está pendiente de decidir.`))
  const leido = () => {
    const n = Number(importe.value.replace(/\./g, '').replace(',', '.'))
    return importe.value.trim() && Number.isFinite(n) && n > 0 ? n : null
  }
  function calcular() {
    const n = leido()
    guardar.disabled = n === null || vista.guardando
    const e = elegido()
    previsto.replaceChildren(...(n === null || !vista.r || !p.empresaId ? [h('span', {}, 'Pon un importe mayor que cero para ver el recibo nuevo.')]
      : [h('b', {}, sueltoPrevisto(vista.r, p.empresaId, s, n)),
        h('div', { class: 'pequeno' }, `${concepto.value.trim() || e?.nombre || 'Trabajo suelto'}${e && Math.abs(n - e.importe) < 0.005 ? ` · ${e.suPrecio ? 'su precio' : 'el de la tarifa'}` : ' · importe cambiado a mano'}.`)]))
  }
  servicio.addEventListener('input', () => { deLaTarifa(); calcular() })
  for (const x of [concepto, importe]) x.addEventListener('input', () => calcular())
  calcular()
  caja.append(previsto, h('div', { class: 'botones' }, boton('Cancelar', 'normal', cerrar_), guardar))
  caja.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const n = leido()
    const e = elegido()
    if (n !== null && e && p.empresaId) void facturarSuelto(p.empresaId, e.id, concepto.value.trim() || null, n)
  })
  return caja
}

/** nº 17, B · Guardar el trabajo suelto: la pantalla dice lo que ha pasado (regla 8), con «Deshacer» si se puede. */
async function facturarSuelto(empresa: string, servicio: string, concepto: string | null, importe: number) {
  if (!vista.ficha || vista.guardando) return
  vista.guardando = true
  repintar()
  let r: Record<string, unknown>
  try { r = await llamar({ paso: 'hacer', ...vista.ficha, accion: 'suelto', datos: { empresa, servicio, concepto, importe } }) } catch { r = { estado: 'error' } }
  vista.guardando = false
  if (r.estado === 'ok') {
    const b = (r.bitrix ?? {}) as { hecho?: string; texto?: string }
    vista.abierto = null
    if (r.pestana && typeof r.pestana === 'object') vista.r = r.pestana as Record<string, unknown>
    if (r.sueltos !== undefined) vista.sueltos = modeloSueltos(r.sueltos) ?? vista.sueltos
    vista.hecho = { titulo: 'Trabajo facturado', texto: String(r.frase ?? ''), tono: b.hecho === 'choque' ? 'aviso' : 'bien',
      bitrix: b.hecho === 'escrito' ? `Bitrix24 actualizado: ${b.texto}` : String(b.texto ?? 'Bitrix24 no se ha tocado.'),
      deshacer: r.deshacer && typeof r.deshacer === 'object' && typeof (r.deshacer as { cuando?: unknown }).cuando === 'string' ? { cuando: (r.deshacer as { cuando: string }).cuando } : null }
  } else {
    vista.hecho = { titulo: 'No se ha facturado', texto: String(r.frase ?? FRASE_DE.error), bitrix: 'No ha cambiado nada.', tono: 'mal', deshacer: null }
  }
  repintar()
}

/** Laboral · Trabajadores, con «Dar de alta» y «Dar de baja». */
function bloqueTrabajadores(p: Pestana, enSumied: string): HTMLElement {
  const trabajadores = h('section', { class: 'bloque', 'aria-labelledby': 'gb-trab' },
    h('div', { class: 'titulo-con-boton' }, h('h2', { id: 'gb-trab' }, `Trabajadores · ${p.trabajadores.length}`),
      p.serviciosPorTrabajador.length && !vista.abierto ? boton('+ Dar de alta', 'primario', () => abrir_({ tipo: 'alta' })) : null))
  if (vista.abierto && (vista.abierto.tipo === 'alta' || vista.abierto.tipo === 'baja')) trabajadores.append(formulario(p))
  if (!p.trabajadores.length) trabajadores.append(h('div', { class: 'vacio' }, 'No tiene trabajadores en Sumied.'))
  const A_LA_VISTA = 8
  for (const t of p.trabajadores.slice(0, A_LA_VISTA)) {
    trabajadores.append(h('div', { class: 'fila' }, h('span', {}, t.nombre, ' ', h('span', { class: 'pequeno' }, `· ${t.desde.toLowerCase()}`)),
      h('span', { class: 'derecha con-enlace' }, t.importe ?? '',
        t.lineaId && !vista.abierto ? enlaceBoton('Dar de baja', () => abrir_({ tipo: 'baja', linea: t.lineaId!, nombre: t.nombre })) : null)))
  }
  if (p.trabajadores.length > A_LA_VISTA) trabajadores.append(h('a', { href: enSumied, target: '_blank', rel: 'noopener' }, `Ver los ${p.trabajadores.length} en Sumied →`))
  return trabajadores
}

/** nº 17, A · «Recibo devuelto», como en la maqueta: lo que se puede hacer (Code 1) y, si no, por qué. */
function bloqueDevuelto(d: Devueltos): HTMLElement {
  const caja = h('section', { class: 'devuelto', 'aria-label': 'Recibo devuelto' }, h('div', { class: 'antetitulo-rojo' }, d.lista.length === 1 ? 'RECIBO DEVUELTO' : 'RECIBOS DEVUELTOS'))
  for (const r of d.lista) {
    const enlace = boton('Enviarle el enlace para pagar', 'primario', () => void resolverDevuelto(r.recibo, 'enlace'), !d.puede || !r.enlace.puede || vista.guardando)
    const pasar = boton('Que lo pasen de nuevo', 'normal', () => void resolverDevuelto(r.recibo, 'pasar'), !d.puede || !r.pasar.puede || vista.guardando)
    const porques = [r.enlace.puede ? null : r.enlace.porque, r.pasar.puede ? null : r.pasar.porque].filter((x): x is string => !!x)
    caja.append(h('div', { class: 'devuelto-recibo', 'data-prueba': 'devuelto' }, h('b', {}, r.texto),
      h('div', { class: 'botones' }, enlace, pasar),
      ...(d.puede ? [...new Set(porques)].map((x) => h('div', { class: 'pequeno' }, x)) : [h('div', { class: 'pequeno' }, 'Puedes verlo, pero solo un administrador o un encargado de la cuenta lo puede resolver.')])))
  }
  caja.append(h('div', { class: 'pequeno' }, 'El enlace le llega por correo y a su portal: paga con tarjeta o Bizum y queda apuntado solo.'))
  return caja
}

/** nº 17, A · «Enviarle el enlace para pagar» o «Que lo pasen de nuevo». La pantalla dice lo que ha pasado (regla 8). */
async function resolverDevuelto(recibo: string, que: 'enlace' | 'pasar') {
  if (!vista.ficha || vista.guardando) return
  vista.guardando = true
  repintar()
  let r: Record<string, unknown>
  try { r = await llamar({ paso: 'hacer', ...vista.ficha, accion: 'devuelto', datos: { recibo, que } }) } catch { r = { estado: 'error' } }
  vista.guardando = false
  if (r.estado === 'ok') {
    const b = (r.bitrix ?? {}) as { hecho?: string; texto?: string }
    if (r.pestana && typeof r.pestana === 'object') vista.r = r.pestana as Record<string, unknown>
    if (r.devueltos !== undefined) vista.devueltos = modeloDevueltos(r.devueltos)
    vista.hecho = { titulo: que === 'enlace' ? 'Enlace para pagar enviado' : 'Se pasa de nuevo', texto: String(r.frase ?? ''), tono: b.hecho === 'choque' ? 'aviso' : 'bien', deshacer: null,
      bitrix: b.hecho === 'escrito' ? `Bitrix24 actualizado: ${b.texto}` : String(b.texto ?? 'Bitrix24 no se ha tocado.') }
  } else {
    vista.hecho = { titulo: que === 'enlace' ? 'No se ha enviado el enlace' : 'No se ha pasado de nuevo', texto: String(r.frase ?? FRASE_DE.error), bitrix: 'No ha cambiado nada.', tono: 'mal', deshacer: null }
  }
  repintar()
}

function bloqueRecibo(p: Pestana): HTMLElement {
  const recibo = h('section', { class: 'recibo', 'aria-labelledby': 'gb-rec' },
    h('div', { id: 'gb-rec', class: 'antetitulo' }, `Recibo de ${p.mesRecibo}`),
    h('div', { class: 'total' }, p.totalRecibo))
  if (!p.recibo.length) recibo.append(h('div', { class: 'linea' }, h('span', {}, `Nada en Sumied para ${p.mesRecibo}.`)))
  for (const l of p.recibo) {
    recibo.append(h('div', { class: 'linea' },
      h('span', {}, l.texto, h('div', { class: 'detalle' }, l.detalle), ...l.porque.map((x) => h('span', { class: 'porque' }, x))),
      h('b', { style: 'white-space: nowrap' }, l.importe)))
  }
  return recibo
}

function bloqueCobros(p: Pestana, enSumied: string): HTMLElement {
  const cobros = h('section', { class: 'bloque', 'aria-labelledby': 'gb-cob' }, h('h2', { id: 'gb-cob', style: 'font-size: 15px' }, 'Cobros'))
  cobros.append(h('div', { class: 'cobro' }, h('span', { style: 'color: var(--suave)' }, 'Mandato SEPA'),
    p.mandato ? h('span', { class: TONO_A_CLASE[p.mandato.tono] }, p.mandato.texto.charAt(0).toUpperCase() + p.mandato.texto.slice(1)) : h('span', { class: 'estado-neutro' }, 'Sin mandato')))
  if (!p.cobros.length) cobros.append(h('div', { class: 'vacio' }, 'Ningún cobro en los últimos 12 meses.'))
  for (const c of p.cobros) cobros.append(h('div', { class: 'cobro' }, h('span', {}, `${c.fecha} · ${c.importe}`), h('span', { class: TONO_A_CLASE[c.tono] }, c.estado)))
  if (p.hayMasCobros) cobros.append(h('a', { href: enSumied, target: '_blank', rel: 'noopener' }, `Ver los ${p.cobros.length + p.hayMasCobros} cobros →`))
  return cobros
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
function abrir_(a: NonNullable<typeof vista.abierto>) { vista.abierto = a; vista.area = AREA_DE[a.tipo]; vista.hecho = null; repintar() }
function cerrar_() { vista.abierto = null; repintar() }
function repintar() {
  const m = vista.r ? modeloPestana(vista.r, hoyEnMadrid()) : null
  if (m) pintar(m)
}
const mesDe = (hoy: string, mas: number) => { const a = Number(hoy.slice(0, 4)); const n = Number(hoy.slice(5, 7)) - 1 + mas; return `${a + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}` }

/** El formulario abierto (alta o baja), con el recibo nuevo antes de guardar. */
function formulario(p: Pestana): HTMLElement {
  const hoy = hoyEnMadrid()
  const etiqueta = vista.abierto?.tipo === 'alta' ? 'Alta de un trabajador' : vista.abierto?.tipo === 'baja' ? 'Baja de un trabajador'
    : vista.abierto?.tipo === 'solicitud' ? 'Hacer lo que pide' : 'Cambiar un servicio'
  const caja = h('form', { class: 'formulario', 'aria-label': etiqueta })
  const previsto = h('div', { class: 'previsto', role: 'status', 'data-prueba': 'previsto' })
  const guardar = h('button', { type: 'submit', class: 'boton boton-primario' },
    vista.abierto?.tipo === 'alta' ? 'Dar de alta' : vista.abierto?.tipo === 'baja' ? 'Dar de baja' : vista.abierto?.tipo === 'solicitud' ? 'Hacerla' : 'Guardar el cambio') as HTMLButtonElement
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
  } else if (vista.abierto?.tipo === 'solicitud') {
    const sol = vista.portal?.solicitudes.find((x) => x.id === (vista.abierto as { id: string }).id)
    const servicio = h('select', { name: 'servicio' }, ...p.serviciosPorTrabajador.map((x) => h('option', { value: x.id }, x.nombre))) as HTMLSelectElement
    caja.append(h('div', { class: 'formulario-titulo' }, sol?.texto ?? 'Lo que pide el cliente'),
      sol?.tipo === 'alta' && p.serviciosPorTrabajador.length > 1 ? h('div', { class: 'campos' }, h('label', {}, 'Se cobra en', servicio)) : h('span', {}),
      h('div', { class: 'pequeno' }, 'Al hacerla, el cliente la ve hecha en su portal.'))
    cambio = () => sol && (sol.tipo === 'baja' || p.serviciosPorTrabajador.length)
      ? { accion: 'solicitud', solicitud: sol.id, tipo: sol.tipo, nombre: sol.nombre, servicio: sol.tipo === 'alta' ? (servicio.value || p.serviciosPorTrabajador[0].id) : null, desde: `${sol.fecha.slice(0, 7)}-01` }
      : null
    servicio.addEventListener('input', () => calcular())
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
    const porque = c.accion === 'solicitud'
      ? `${c.tipo === 'alta' ? '+1' : '−1'} trabajador: ${c.nombre.toUpperCase()}, lo pide el cliente en su portal.`
      : c.accion === 'alta'
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

/** nº 9, punto 5 · «Su portal»: quién entra, lo que pide el cliente («Hacerla») y los mensajes sin leer. */
function suPortal(p: Pestana, pt: Portal, enSumied: string): HTMLElement {
  const caja = h('section', { class: 'bloque', 'aria-labelledby': 'gb-portal' }, h('h2', { id: 'gb-portal', style: 'font-size: 15px' }, 'Su portal'))
  if (!pt.accesos.length) caja.append(h('div', { class: 'vacio' }, 'Todavía no entra nadie de este cliente.'))
  for (const a of pt.accesos) caja.append(h('div', { class: 'cobro' }, h('span', {}, a.nombre), h('span', { class: a.entro ? 'estado-bien' : 'estado-neutro' }, a.entro ? a.permiso : `${a.permiso} · aún no ha entrado`)))
  // nº 17, C · «Invitar», aquí mismo (Code 3, por conta-portal): el correo le llega como desde Sumied.
  if (vista.abierto?.tipo === 'invitar') caja.append(formularioInvitar())
  else if (!vista.abierto) caja.append(h('div', { class: 'botones' }, boton('Invitar a su portal', 'normal', () => abrir_({ tipo: 'invitar' }))))
  for (const s of pt.solicitudes) {
    caja.append(h('div', { class: 'fila', 'data-prueba': 'solicitud' }, h('span', {}, s.texto),
      h('span', { class: 'derecha con-enlace' }, !vista.abierto ? enlaceBoton('Hacerla', () => abrir_({ tipo: 'solicitud', id: s.id })) : null)))
    if (vista.abierto?.tipo === 'solicitud' && vista.abierto.id === s.id) caja.append(formulario(p))
  }
  if (vista.mensajes) caja.append(bloqueMensajes(vista.mensajes, enSumied))
  else if (pt.mensajesSinLeer) caja.append(h('div', { class: 'cobro' }, h('span', {}, `${pt.mensajesSinLeer} ${pt.mensajesSinLeer === 1 ? 'mensaje' : 'mensajes'} sin leer`),
    h('a', { href: enSumied, target: '_blank', rel: 'noopener' }, 'Contestar, en Sumied ↗')))
  return caja
}

/** nº 17, C · «Invitar a su portal»: el correo, el nombre y qué puede ver. Solo un administrador o un encargado (lo comprueba Code 3). */
function formularioInvitar(): HTMLElement {
  const caja = h('form', { class: 'formulario', 'aria-label': 'Invitar a su portal' })
  const correo = h('input', { name: 'correo', type: 'email', required: '', autocomplete: 'off' }) as HTMLInputElement
  const nombre = h('input', { name: 'nombre', autocomplete: 'off' }) as HTMLInputElement
  let permiso: 'todo' | 'facturas_documentos' = 'todo'
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Qué puede ver' })
  const pintarChips = () => chips.replaceChildren(...([['todo', 'Todo'], ['facturas_documentos', 'Solo facturas y documentos']] as const).map(([v, t]) => {
    const b = h('button', { type: 'button', class: 'chip-opcion', role: 'radio', 'aria-checked': String(permiso === v) }, t)
    b.addEventListener('click', () => { permiso = v; pintarChips() })
    return b
  }))
  pintarChips()
  const guardar = h('button', { type: 'submit', class: 'boton boton-primario' }, 'Invitar') as HTMLButtonElement
  const valida = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.value.trim())
  const calcular = () => { guardar.disabled = !valida() || vista.guardando }
  correo.addEventListener('input', calcular)
  calcular()
  caja.append(h('div', { class: 'formulario-titulo' }, 'Invitar a su portal'),
    h('div', { class: 'campos' }, h('label', {}, 'Correo', correo), h('label', {}, 'Nombre (opcional)', nombre)), chips,
    h('div', { class: 'pequeno' }, 'Le llega un correo con el enlace para entrar, con la marca de tu gestoría.'),
    h('div', { class: 'botones' }, boton('Cancelar', 'normal', cerrar_), guardar))
  caja.addEventListener('submit', (e) => { e.preventDefault(); if (valida()) void hacerEnPortal('invitar', { correo: correo.value.trim(), nombre: nombre.value.trim() || null, permiso }) })
  return caja
}

/** nº 17, C · Los últimos mensajes, con su texto, y «Contestar» aquí mismo. */
function bloqueMensajes(ms: Mensajes, enSumied: string): HTMLElement {
  const caja = h('div', { class: 'mensajes', role: 'region', 'aria-label': 'Mensajes' }, h('div', { class: 'antetitulo-suave' }, 'MENSAJES'))
  if (!ms.lista.length) caja.append(h('div', { class: 'vacio' }, 'Todavía no hay mensajes con este cliente.'))
  if (ms.total > ms.lista.length) caja.append(h('a', { href: enSumied, target: '_blank', rel: 'noopener', class: 'pequeno' }, `Ver los ${ms.total} en Sumied ↗`))
  for (const m of ms.lista) {
    caja.append(h('div', { class: 'mensaje-portal', 'data-de': m.delCliente ? 'cliente' : 'gestoria', 'data-prueba': 'mensaje' },
      h('div', { class: 'pequeno' }, h('b', {}, m.quien), ` · ${m.cuando}`, m.sinLeer ? h('span', { class: 'etiqueta', 'data-tono': 'aviso' }, 'Sin leer') : null),
      h('div', { class: 'mensaje-texto' }, m.texto)))
  }
  if (vista.abierto?.tipo === 'contestar') {
    const form = h('form', { class: 'formulario', 'aria-label': 'Contestar' })
    const texto = h('textarea', { name: 'texto', rows: '3', maxlength: '4000' }) as HTMLTextAreaElement
    const mandar = h('button', { type: 'submit', class: 'boton boton-primario' }, 'Mandar') as HTMLButtonElement
    const calcular = () => { mandar.disabled = !texto.value.trim() || vista.guardando }
    texto.addEventListener('input', calcular)
    calcular()
    form.append(h('div', { class: 'campos campos-uno' }, h('label', {}, 'Tu respuesta (la verá en su portal)', texto)), h('div', { class: 'botones' }, boton('Cancelar', 'normal', cerrar_), mandar))
    form.addEventListener('submit', (e) => { e.preventDefault(); if (texto.value.trim()) void hacerEnPortal('contestar', { texto: texto.value.trim() }) })
    caja.append(form)
  } else if (!vista.abierto) caja.append(h('div', { class: 'botones' }, boton('Contestar', 'primario', () => abrir_({ tipo: 'contestar' }))))
  return caja
}

/** nº 17, C · «Invitar» o «Contestar»: la pantalla dice lo que ha pasado (regla 8). Bitrix24 no cambia: no toca lo que se cobra. */
async function hacerEnPortal(accion: 'invitar' | 'contestar', datos: Record<string, unknown>) {
  if (!vista.ficha || vista.guardando) return
  vista.guardando = true
  repintar()
  let r: Record<string, unknown>
  try { r = await llamar({ paso: 'hacer', ...vista.ficha, accion, datos }) } catch { r = { estado: 'error' } }
  vista.guardando = false
  if (r.estado === 'ok') {
    vista.abierto = null
    if (r.portal !== undefined) vista.portal = modeloPortal(r.portal) ?? vista.portal
    if (r.mensajes !== undefined) vista.mensajes = modeloMensajes(r.mensajes) ?? vista.mensajes
    vista.hecho = { titulo: accion === 'invitar' ? 'Invitación enviada' : 'Respuesta mandada', texto: String(r.frase ?? ''), bitrix: 'Bitrix24 no cambia: no toca lo que se cobra.', tono: 'bien', deshacer: null }
  } else {
    vista.hecho = { titulo: accion === 'invitar' ? 'No se ha invitado' : 'No se ha mandado', texto: String(r.frase ?? FRASE_DE.error), bitrix: 'No ha cambiado nada.', tono: 'mal', deshacer: null }
  }
  repintar()
}

async function leerPortal() {
  if (!vista.ficha) return
  try {
    const empresa = vista.r ? modeloPestana(vista.r, hoyEnMadrid())?.empresaId : null
    const r = await llamar({ paso: 'portal', ...vista.ficha, ...(empresa ? { empresa } : {}) })
    vista.portal = modeloPortal(r)
    vista.devueltos = modeloDevueltos(r.devueltos)
    vista.sueltos = modeloSueltos(r.sueltos)
    vista.mensajes = modeloMensajes(r.mensajes)
  } catch { vista.portal = null }
  vista.portalLeido = true
  if (!vista.abierto) repintar()
}

/** Guardar: Sumied hace el cambio (con las funciones de la ficha) y la función actualiza Bitrix24. La pantalla dice lo que ha pasado (regla 8). */
async function guardarCambio(c: Cambio) {
  if (!vista.ficha || vista.guardando) return
  vista.guardando = true
  const datos = c.accion === 'alta'
    ? { empresa: modeloPestana(vista.r!, hoyEnMadrid())?.empresaId, servicio: c.servicio, nombre: c.nombre, desde: c.desde }
    : c.accion === 'baja' ? { linea: c.linea, mes: c.mes, nombre: (vista.abierto as { nombre?: string } | null)?.nombre ?? null }
      : c.accion === 'solicitud' ? { solicitud: c.solicitud, ...(c.servicio ? { servicio: c.servicio } : {}) }
        : { linea: c.linea, desde: c.desde, ...(c.nivel ? { nivel: c.nivel } : {}), ...(c.precio !== null ? { precio: c.precio, motivo: c.motivo } : {}) }
  let r: Record<string, unknown>
  try { r = await llamar({ paso: 'hacer', ...vista.ficha, accion: c.accion, datos }) } catch { r = { estado: 'error' } }
  vista.guardando = false
  const nombre = c.accion === 'alta' || c.accion === 'solicitud' ? c.nombre.toUpperCase() : (vista.abierto as { nombre?: string } | null)?.nombre ?? ''
  const titulos = { alta: [`Alta hecha: ${nombre}`, 'No se ha dado de alta'], baja: [`Baja hecha: ${nombre}`, 'No se ha dado de baja'],
    tarifa: [c.accion === 'tarifa' && c.precio !== null ? 'Precio especial guardado' : 'Nivel cambiado', 'No se ha cambiado'],
    solicitud: [`${c.accion === 'solicitud' && c.tipo === 'baja' ? 'Baja' : 'Alta'} hecha desde la petición del portal: ${nombre}`, 'No se ha hecho'] }[c.accion]
  if (r.estado === 'ok') {
    const b = (r.bitrix ?? {}) as { hecho?: string; texto?: string }
    vista.abierto = null
    if (r.pestana && typeof r.pestana === 'object') vista.r = r.pestana as Record<string, unknown>
    if (c.accion === 'solicitud') void leerPortal()
    vista.hecho = {
      titulo: titulos[0],
      texto: String(r.frase ?? ''),
      bitrix: b.hecho === 'escrito' ? `Bitrix24 actualizado: ${b.texto}` : String(b.texto ?? 'Bitrix24 no se ha tocado.'),
      tono: b.hecho === 'choque' ? 'aviso' : 'bien',
      deshacer: r.deshacer && typeof r.deshacer === 'object' && typeof (r.deshacer as { cuando?: unknown }).cuando === 'string' ? { cuando: (r.deshacer as { cuando: string }).cuando } : null,
    }
  } else {
    vista.hecho = { titulo: titulos[1], texto: String(r.frase ?? FRASE_DE.error), bitrix: 'No ha cambiado nada.', tono: 'mal' }
  }
  repintar()
}

/** nº 13 · «Deshacer» lo último hecho (con la función de Code 1): la pantalla dice lo que ha pasado (regla 8). */
async function deshacerCambio(cuando: string, empresa: string) {
  if (!vista.ficha || vista.guardando) return
  vista.guardando = true
  let r: Record<string, unknown>
  try { r = await llamar({ paso: 'deshacer', ...vista.ficha, empresa, cuando }) } catch { r = { estado: 'error' } }
  vista.guardando = false
  if (r.estado === 'ok') {
    const b = (r.bitrix ?? {}) as { hecho?: string; texto?: string }
    if (r.pestana && typeof r.pestana === 'object') vista.r = r.pestana as Record<string, unknown>
    void leerPortal()
    vista.hecho = { titulo: 'Deshecho', texto: String(r.frase ?? '').replace(/^Deshecho:\s*/, ''), tono: b.hecho === 'choque' ? 'aviso' : 'bien', deshacer: null,
      bitrix: b.hecho === 'escrito' ? `Bitrix24 actualizado: ${b.texto}` : String(b.texto ?? 'Bitrix24 no se ha tocado.') }
  } else {
    vista.hecho = { titulo: 'No se ha deshecho', texto: String(r.frase ?? FRASE_DE.error), bitrix: 'No ha cambiado nada.', tono: 'mal', deshacer: null }
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
    if (m) { pintar(m); void leerPortal() }
    else pintarMensaje('Sin datos en Sumied', 'Este cliente está enlazado, pero todavía no tiene nada en Clientes y cuotas.', 'sin_datos')
  } else {
    const frase = typeof r.frase === 'string' ? r.frase : FRASE_DE[estado] ?? FRASE_DE.error
    const titulo = estado === 'sin_acceso' ? 'Sin acceso a Sumied' : estado === 'sin_enlazar' ? 'Ficha sin enlazar' : 'No se puede enseñar'
    pintarMensaje(titulo, frase, estado)
  }
  if (window.name.includes('|')) conBitrix((bx) => bx.fitWindow?.())
}

void arrancar()
