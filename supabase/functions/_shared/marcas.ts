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

export type IdMarca = 'folvy' | 'contabilidad' | 'sumied'

/**
 * Los colores y la letra de una marca con identidad propia (C06b, Sumied). Se
 * ponen encima de los tokens del estilo nuevo (--cx-* del módulo y --mx-* de
 * la entrada): lo que no se nombra, como siempre. Todos medidos para AA sobre
 * el blanco y sobre `accionSuave` (tests/unit/modules/conta/marcaSumiedC06b.test.ts).
 */
export interface TemaMarca {
  /** Texto principal. */
  tinta: string
  /** Texto de apoyo (etiquetas y ayudas). */
  apoyo: string
  /** Botón principal, enlaces, menú activo: con texto blanco encima, ≥ 4,5:1. */
  accion: string
  /** Fondo del menú activo y de lo seleccionado. */
  accionSuave: string
  /** Borde de lo seleccionado. */
  accionBorde: string
  /** El punto de la IA y lo hecho: SIEMPRE fondo, con texto oscuro encima. */
  acento: string
  /** La familia de letra (con sus alternativas). */
  letra: string
}

export interface Marca {
  id: IdMarca
  /** El nombre que se ve: títulos, menú, correos, PDF. */
  nombre: string
  /** La letra del logo cuadrado (mientras no haya logo dibujado). */
  inicial: string
  /** Color del logo cuadrado. */
  colorLogo: string
  /** El símbolo dibujado (SVG, ruta del sitio). Null: el cuadrado con la inicial. */
  logo: string | null
  /**
   * S01c (identidad del 14/10): el logo horizontal, símbolo y nombre en un solo
   * fichero, para fondo claro (la cabecera del móvil). Null: el símbolo y el
   * nombre escrito.
   */
  logoHorizontal: string | null
  /** El mismo en blanco, para fondo oscuro (la barra de productos). */
  logoHorizontalBlanco: string | null
  /** Colores y letra propios. Null: el estilo nuevo tal cual (azul #2F5BFF, Geist). */
  tema: TemaMarca | null
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
  /**
   * El dominio que RECIBE correo (las facturas que el cliente reenvía): la
   * dirección de cada empresa es `facturas-<empresa>@<este dominio>`
   * (direccionDeFacturas). Null: la marca aún no recibe correo (sin MX).
   */
  dominioEntradaCorreo: string | null
  /**
   * Lo que enseña un enlace compartido (WhatsApp, correo, buscadores), que
   * leen el HTML sin ejecutar nada: descripción e imagen de vista previa
   * (1200 × 630, ruta del sitio). El título es el nombre.
   */
  descripcion: string
  /** Null: sin imagen (Folvy hoy no tiene, y su index.html no se toca). */
  imagenVistaPrevia: string | null
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
    logo: null,
    logoHorizontal: null,
    logoHorizontalBlanco: null,
    tema: null,
    dominios: ['app.folvy.app', 'foodint.folvy.app', 'folvy-app.vercel.app'],
    direccionVisible: 'app.folvy.app',
    soloContabilidad: false,
    favicon: '/folvy-favicon.svg',
    manifiesto: '/manifest.json',
    remitente: 'Folvy <no-reply@folvy.app>',
    responderA: 'jgcolon@idasal.com',
    dominioEntradaCorreo: 'entrada.folvy.app',
    // La de index.html, tal cual: el index de Folvy no cambia.
    descripcion: 'Folvy - Hosteleria profesional. Software profesional.',
    imagenVistaPrevia: null,
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
    logo: null,
    logoHorizontal: null,
    logoHorizontalBlanco: null,
    tema: null,
    dominios: [],
    direccionVisible: null,
    soloContabilidad: true,
    favicon: '/marcas/contabilidad/favicon.svg',
    manifiesto: '/marcas/contabilidad/manifest.json',
    remitente: null,
    responderA: null,
    dominioEntradaCorreo: null,
    descripcion: 'Tu contabilidad al día, sin saber de cuentas.',
    imagenVistaPrevia: '/marcas/contabilidad/vista-previa.png',
    logoCorreo: null,
    avisoLegal: null,
    privacidad: null,
    entrar: {
      titulo: 'Entra en tu contabilidad',
      subtitulo: 'Te ha invitado tu asesor o tu empresa. Entra con tu correo.',
      antetitulo: 'LO QUE TE ESPERA DENTRO',
      lema: 'Tu contabilidad al día, sin saber de cuentas.',
      // Cuatro frases CIERTAS hoy, con la forma y el sitio de la maqueta N18
      // (Julio, C06 respuesta 2: no se enseña lo que no funciona). Las de la
      // maqueta vuelven cuando exista lo que prometen:
      //   «Subes una factura y se apunta sola.»               → facturas recibidas (frente A)
      //   «El banco se casa solo; tú confirmas lo dudoso.»     → bancos (frente B)
      //   «El IVA de cada trimestre, listo para presentar.»    → impuestos
      //   «Trae tu contabilidad de Cegid Diez, Holded, Sage o A3.» → hoy solo Diez, y lo configura Folvy
      frases: [
        'Tus libros —diario, balance y resultados— en un solo sitio.',
        'El IVA del trimestre a la vista, con su libro registro.',
        'Cada mes se cierra con sus pasos, y lo cerrado no se toca.',
        'Lo que hago yo, lo ves y lo puedes deshacer.',
      ],
    },
  },
  // C06b (respuesta 6 de Julio, tarea 6): la marca con nombre y dominio.
  // Identidad aprobada por Julio el 14/10 (lienzo «Sumied · Identidad»,
  // Marca.dc.html): azul noche #0B1F3B, azul #2F80ED, turquesa #00D1B2, gris
  // claro #EAF2F8 y blanco; Inter; la «S» de dos píldoras. El azul #2F80ED es
  // el del logo: con texto blanco encima da 3,87:1 (no llega a AA), así que lo
  // que se pulsa y los enlaces van con #1E63C9, el azul más hondo del propio
  // lienzo (5,70:1 con blanco). El turquesa, solo fondo (1,95:1 sobre blanco).
  sumied: {
    id: 'sumied',
    nombre: 'Sumied',
    inicial: 'S',
    colorLogo: '#0B1F3B',
    // Los ficheros de la identidad del 14/10 (S01c, 18/10).
    logo: '/marcas/sumied/sumied-simbolo.svg',
    logoHorizontal: '/marcas/sumied/sumied-logo-horizontal.svg',
    logoHorizontalBlanco: '/marcas/sumied/sumied-logo-horizontal-blanco.svg',
    tema: {
      tinta: '#0B1F3B',
      apoyo: '#4A5B73',
      accion: '#1E63C9',
      accionSuave: '#EAF2F8',
      accionBorde: '#B8D0F0',
      acento: '#00D1B2',
      letra: "'Inter Variable', 'Inter', 'Helvetica Neue', Arial, sans-serif",
    },
    dominios: ['app.sumied.com'],
    direccionVisible: 'app.sumied.com',
    soloContabilidad: true,
    favicon: '/marcas/sumied/favicon.svg',
    manifiesto: '/marcas/sumied/manifest.json',
    // P01 (19/10): sumied.com verificado en Resend (Julio). Que haya remitente
    // NO abre ningún correo: send-email los tiene todos cerrados por tipo hasta
    // que Julio los abra (CORREO_MARCA_ABIERTOS, marca.ts · cerrojoMarca).
    // Sin «responder a» de la marca: las respuestas van a quien manda cada
    // correo (el de la asesoría, en el resumen del trimestre).
    remitente: 'Sumied <impuestos@sumied.com>',
    responderA: null,
    // Null hasta que entrada.sumied.com reciba correo (su MX en Resend).
    dominioEntradaCorreo: null,
    descripcion: 'Tu contabilidad al día, sin saber de cuentas.',
    imagenVistaPrevia: '/marcas/sumied/vista-previa.png',
    logoCorreo: 'https://app.sumied.com/marcas/sumied/logo-correo.png',
    avisoLegal: null,
    privacidad: null,
    entrar: {
      titulo: 'Entra en Sumied',
      subtitulo: 'Te ha invitado tu asesor o tu empresa. Entra con tu correo.',
      antetitulo: 'LO QUE TE ESPERA DENTRO',
      lema: 'Tu contabilidad al día, sin saber de cuentas.',
      // Las mismas cuatro frases CIERTAS de la marca de pruebas (Julio, C06
      // respuesta 2): lo que el lienzo dice de nóminas y personal aún no existe.
      frases: [
        'Tus libros —diario, balance y resultados— en un solo sitio.',
        'El IVA del trimestre a la vista, con su libro registro.',
        'Cada mes se cierra con sus pasos, y lo cerrado no se toca.',
        'Lo que hago yo, lo ves y lo puedes deshacer.',
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

/**
 * La dirección a la que una empresa reenvía sus facturas:
 * `facturas-<empresa>@<dominio de entrada>` (Julio, C06 respuesta 2). <empresa>
 * es el identificador corto que decida quien la use (frente A), pasado a
 * minúsculas, sin acentos y solo con letras, cifras y guiones. Null si la marca
 * aún no recibe correo o el identificador queda vacío.
 */
export function direccionDeFacturas(m: Marca, empresa: string): string | null {
  if (!m.dominioEntradaCorreo) return null
  const corto = empresa.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return corto ? `facturas-${corto}@${m.dominioEntradaCorreo}` : null
}
