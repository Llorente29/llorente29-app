// src/modules/conta/avisos/alInstante.ts
//
// G01d · «Al instante», en palabras de oficina. Puro: lo prueban las
// unitarias y lo pintan AlInstante.tsx (Ajustes › Cobros) y, cuando fusione el
// G04, la línea «Al día» de Clientes.
//
// Nunca «webhook», «endpoint», «evento», «payload» ni «HMAC» en pantalla: aviso,
// al instante, al día. En los pasos para el administrador sí sale «Webhook
// saliente», porque es el nombre del menú de Bitrix24.

export type OrigenAviso = 'crm' | 'gocardless'

export interface DatosAlInstante {
  encendido: boolean
  tieneCodigo: boolean
  /** Cuándo llegó el último aviso auténtico (ISO), o null. */
  ultimoAviso: string | null
  /** Cuándo se encendió (ISO), o null. */
  encendidoAt: string | null
}

export type Tono = 'apagado' | 'espera' | 'bien' | 'falta'
export interface EstadoAlInstante { tono: Tono; frase: string }

const MIN = 60_000
export const SIN_AVISOS_MS = 24 * 60 * MIN

/** «hace un momento», «hace 2 min», «hace 3 h», «ayer», «hace 4 días». */
export function hace(iso: string, ahora: number): string {
  const ms = Math.max(0, ahora - Date.parse(iso))
  if (ms < MIN) return 'hace un momento'
  if (ms < 60 * MIN) return `hace ${Math.floor(ms / MIN)} min`
  if (ms < 24 * 60 * MIN) return `hace ${Math.floor(ms / (60 * MIN))} h`
  const dias = Math.floor(ms / (24 * 60 * MIN))
  return dias === 1 ? 'ayer' : `hace ${dias} días`
}

/** El estado en una frase (Diseño del G01d). «nombre»: «Bitrix24» o «GoCardless». */
export function estadoAlInstante(d: DatosAlInstante, nombre: string, ahora: number): EstadoAlInstante {
  if (!d.encendido) return { tono: 'apagado', frase: d.tieneCodigo ? 'Apagado. El código está guardado: enciéndelo cuando quieras.' : 'Apagado.' }
  const desde = d.ultimoAviso ?? d.encendidoAt
  // Encendido y ni un aviso en 24 horas (desde el último, o desde que se encendió): se dice, que no se pierda la costumbre.
  if (desde && ahora - Date.parse(desde) >= SIN_AVISOS_MS) {
    return { tono: 'falta', frase: `No llegan avisos desde ${hace(desde, ahora)}. Mira que siga dado de alta en ${nombre}.` }
  }
  if (!d.ultimoAviso) return { tono: 'espera', frase: 'Esperando el primer aviso.' }
  return { tono: 'bien', frase: `Funciona: último aviso ${hace(d.ultimoAviso, ahora)}.` }
}

/** La dirección que se pega en Bitrix24 o en GoCardless (una por conexión). */
export function direccionDelAviso(base: string, o: { origen: 'crm'; cuenta: string; crm: string } | { origen: 'gocardless'; empresa: string }): string {
  const raiz = `${base.replace(/\/+$/, '')}/functions/v1/`
  return o.origen === 'crm'
    ? `${raiz}conta-crm-aviso?${new URLSearchParams({ cuenta: o.cuenta, crm: o.crm })}`
    : `${raiz}conta-gocardless-aviso?${new URLSearchParams({ empresa: o.empresa })}`
}

/** Los pasos para el administrador (los de «avisos_al_instante_qbo»). */
export function pasosParaActivar(origen: OrigenAviso, nombre: string): string[] {
  if (origen === 'crm') {
    return [
      `En ${nombre}, ve a Recursos para desarrolladores › Otros › Webhook saliente (así lo llama ${nombre}).`,
      'En la dirección del controlador, pega la dirección de Sumied de abajo (botón «Copiar»).',
      'Marca los avisos de empresas y de contactos: ONCRMCOMPANYADD, ONCRMCOMPANYUPDATE, ONCRMCOMPANYDELETE, ONCRMCONTACTADD, ONCRMCONTACTUPDATE y ONCRMCONTACTDELETE.',
      `Guarda. ${nombre} enseña un código de seguridad: cópialo y pégalo aquí abajo. No lo mandes por correo ni por chat.`,
      'Enciende «Al instante» y pulsa «Probar».',
    ]
  }
  return [
    'En manage.gocardless.com, como administrador, ve a Desarrolladores › Crear › Endpoint de webhook (así lo llama GoCardless).',
    'Ponle de nombre «Sumied» y, en la dirección, pega la de abajo (botón «Copiar»). Es de esta empresa: cada cuenta de GoCardless tiene la suya.',
    'Créalo, ábrelo y copia su secreto. Pégalo aquí abajo. No lo mandes por correo ni por chat.',
    'Enciende «Al instante» y pulsa «Probar».',
  ]
}

/**
 * La línea discreta de Clientes, junto al título: «Al día: actualizado hace
 * 2 min» si llegan avisos; si no, cuándo fue la última lectura entera.
 */
export function lineaAlDia(o: { ultimoAplicado: string | null; ultimaLectura: string | null; ahora: number; zona?: string }): string {
  if (o.ultimoAplicado && o.ahora - Date.parse(o.ultimoAplicado) < SIN_AVISOS_MS) return `Al día: actualizado ${hace(o.ultimoAplicado, o.ahora)}.`
  if (!o.ultimaLectura) return 'Aún no se ha leído.'
  const zona = o.zona ?? 'Europe/Madrid'
  const dia = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: zona, hour: 'numeric', minute: '2-digit' }).format(new Date(o.ultimaLectura))
  const hoy = dia(new Date(o.ahora).toISOString())
  const ayer = dia(new Date(o.ahora - 24 * 60 * MIN).toISOString())
  const cuando = dia(o.ultimaLectura) === hoy ? 'hoy' : dia(o.ultimaLectura) === ayer ? 'ayer' : `el ${new Intl.DateTimeFormat('es-ES', { timeZone: zona, day: 'numeric', month: 'numeric' }).format(new Date(o.ultimaLectura))}`
  return `Última lectura: ${cuando} a las ${hora}.`
}
