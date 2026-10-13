// supabase/functions/_shared/marcas.ts
//
// LAS MARCAS DEL PRODUCTO (C06 · Contabilidad sola, 13/10/2026). El ÚNICO sitio
// donde está escrito todo lo que depende del nombre: texto, logo, dominio,
// remitente de los correos, pie de los PDF y enlaces legales. Cambiar el nombre
// de la marca es cambiar un valor aquí, no buscar por el código.
//
// Lo leen las dos mitades: el front (src/marca/marca.ts lo importa tal cual) y
// las edge functions (send-email, conta-crear-cuenta, conta-contrasena). Por eso
// vive aquí, en _shared, y no tiene ni una dependencia: solo datos y funciones
// puras, que corren igual en el navegador y en Deno.
//
// Lo que NO decide Code (encargo C06, «Norma»):
//   · el nombre, que antes de fijarse se comprueba en la OEPM y la EUIPO (Julio);
//   · los textos legales (aviso legal y privacidad, con Folvy como encargado del
//     tratamiento): los redacta y aprueba Julio. Aquí son un HUECO (null) y la
//     pantalla lo dice en vez de inventar.

export type IdMarca = 'folvy' | 'contabilidad'

export interface Marca {
  id: IdMarca
  /** El nombre que se ve: títulos, menú, correos, PDF. */
  nombre: string
  /** La letra del logo cuadrado (mientras no haya logo dibujado). */
  inicial: string
  /** Color del logo cuadrado. */
  colorLogo: string
  /** Dominios por los que se entra con esta marca. Vacío: aún no tiene. */
  dominios: string[]
  /** La dirección que se enseña en el pie de la entrada («contabilidad.marca.es»). */
  direccionVisible: string | null
  /** El producto es solo la contabilidad: sin Cocina, sin «Volver a…», sin barra de la IA mientras no conteste. */
  soloContabilidad: boolean
  /** Icono de la pestaña y manifiesto de la aplicación instalable. */
  favicon: string
  manifiesto: string
  /** «Nombre <no-reply@dominio>». Null: la marca aún no tiene dominio verificado en Resend y NO envía. */
  remitente: string | null
  /** A dónde van las respuestas a sus correos. */
  responderA: string | null
  /** Logo de los correos (URL absoluta). Null: se pinta el cuadrado con la inicial. */
  logoCorreo: string | null
  /** Enlaces legales. Null = hueco: los textos los redacta y aprueba Julio. */
  avisoLegal: string | null
  privacidad: string | null
  /** La pantalla de entrada (N18). */
  entrar: {
    titulo: string
    subtitulo: string
    antetitulo: string
    lema: string
    frases: string[]
  }
}

export const MARCAS: Record<IdMarca, Marca> = {
  folvy: {
    id: 'folvy',
    nombre: 'Folvy',
    inicial: 'F',
    colorLogo: '#15171A',
    dominios: ['app.folvy.app', 'foodint.folvy.app', 'folvy-app.vercel.app'],
    direccionVisible: 'app.folvy.app',
    soloContabilidad: false,
    favicon: '/folvy-favicon.svg',
    manifiesto: '/manifest.json',
    remitente: 'Folvy <no-reply@folvy.app>',
    responderA: 'jgcolon@idasal.com',
    logoCorreo: 'https://app.folvy.app/email/folvy-isotipo-email.png',
    avisoLegal: null,
    privacidad: null,
    entrar: {
      titulo: 'Inicio de sesión',
      subtitulo: 'Introduce tu email y contraseña',
      antetitulo: '',
      lema: '',
      frases: [],
    },
  },
  // La marca genérica de pruebas mientras no hay nombre (encargo C06, 1). Sin
  // dominio: en staging y en las vistas previas se fuerza con ?marca=contabilidad.
  contabilidad: {
    id: 'contabilidad',
    nombre: 'Contabilidad',
    inicial: 'C',
    colorLogo: '#2F5BFF',
    dominios: [],
    direccionVisible: null,
    soloContabilidad: true,
    favicon: '/marcas/contabilidad/favicon.svg',
    manifiesto: '/marcas/contabilidad/manifest.json',
    remitente: null,
    responderA: null,
    logoCorreo: null,
    avisoLegal: null,
    privacidad: null,
    entrar: {
      titulo: 'Entra en tu contabilidad',
      subtitulo: 'Te ha invitado tu asesor o tu empresa. Entra con tu correo.',
      antetitulo: 'LO QUE TE ESPERA DENTRO',
      lema: 'Tu contabilidad al día, sin saber de cuentas.',
      // Las cuatro frases de la maqueta N18, tal cual. Cada una promete algo
      // que el producto tiene que cumplir el día que se venda (ver el informe).
      frases: [
        'Subes una factura y se apunta sola.',
        'El banco se casa solo; tú confirmas lo dudoso.',
        'El IVA de cada trimestre, listo para presentar.',
        'Trae tu contabilidad de Cegid Diez, Holded, Sage o A3.',
      ],
    },
  },
}

export const MARCA_POR_DEFECTO: IdMarca = 'folvy'

export function esIdMarca(x: unknown): x is IdMarca {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(MARCAS, x)
}

/** Hosts de producción de Folvy: por ellos nunca se fuerza una marca con ?marca=. */
export function esHostDeProduccion(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'folvy.app' || h.endsWith('.folvy.app')) return true
  return Object.values(MARCAS).some((m) => m.dominios.includes(h))
}

export interface EntradaResolver {
  /** window.location.hostname */
  host: string
  /** window.location.search */
  buscar: string
  /** Lo recordado en la sesión del navegador (sessionStorage), si lo hay. */
  recordada: string | null
}

export interface MarcaResuelta {
  id: IdMarca
  /** Qué hay que recordar en la sesión: un id, null para olvidar, undefined para no tocar. */
  recordar: IdMarca | null | undefined
  /** Por qué: el dominio, ?marca=, lo recordado o el defecto. */
  por: 'dominio' | 'parametro' | 'recordada' | 'defecto'
}

/**
 * Con qué marca se enseña la aplicación (encargo C06, 1 y respuesta 1).
 *   1. El dominio de una marca manda siempre.
 *   2. En producción (cualquier *.folvy.app o el dominio de una marca), Folvy:
 *      ?marca= no hace nada y lo recordado tampoco.
 *   3. Fuera de producción (staging, vistas previas, local), ?marca=<id> la
 *      fuerza y se recuerda en la sesión del navegador; ?marca=folvy la olvida.
 *      Sin parámetro, la recordada; si no, Folvy.
 */
export function resolverMarca({ host, buscar, recordada }: EntradaResolver): MarcaResuelta {
  const h = host.toLowerCase()
  const porDominio = Object.values(MARCAS).find((m) => m.dominios.includes(h))
  if (porDominio) return { id: porDominio.id, recordar: undefined, por: 'dominio' }
  if (esHostDeProduccion(h)) return { id: MARCA_POR_DEFECTO, recordar: undefined, por: 'defecto' }
  const pedida = new URLSearchParams(buscar).get('marca')
  if (pedida !== null) {
    if (esIdMarca(pedida)) {
      return { id: pedida, recordar: pedida === MARCA_POR_DEFECTO ? null : pedida, por: 'parametro' }
    }
  }
  if (esIdMarca(recordada)) return { id: recordada, recordar: undefined, por: 'recordada' }
  return { id: MARCA_POR_DEFECTO, recordar: undefined, por: 'defecto' }
}

/** La dirección web de una marca para los enlaces de sus correos, o null si aún no tiene dominio. */
export function urlBaseDeMarca(m: Marca): string | null {
  return m.dominios.length > 0 ? `https://${m.dominios[0]}` : null
}

/**
 * La dirección de los enlaces de un correo con marca: su dominio; si no tiene
 * (marca de pruebas), la base que se le pase (staging o vista previa) con
 * ?marca=<id>, que fuera de producción la fuerza. Null si no hay ninguna de
 * las dos: el correo no se puede mandar, y se dice.
 */
export function enlaceDeMarca(m: Marca, ruta: string, params: Record<string, string>, basePruebas: string | null): string | null {
  const base = urlBaseDeMarca(m) ?? basePruebas
  if (!base) return null
  const q = new URLSearchParams(params)
  if (!urlBaseDeMarca(m) && m.id !== MARCA_POR_DEFECTO) q.set('marca', m.id)
  return `${base.replace(/\/+$/, '')}${ruta}?${q.toString()}`
}
