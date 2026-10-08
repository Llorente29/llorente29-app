// src/config/navegacion.ts
//
// EL ÚNICO SITIO de la navegación de lo que toca el C01: la entrada de menú
// de Proveedores, la dirección de la lista y de la ficha, y las migas.
//
// Por qué existe (respuesta 1 de Julio al C01, 01/10/2026): toda la
// navegación de Folvy se va a reorganizar pronto. Cuando pase, se cambia
// AQUÍ y no en cada pantalla:
//   · las pantallas no escriben rutas a mano: piden `rutaFichaProveedor(id)`;
//   · las migas salen de `migasProveedores`, no de cada página;
//   · si una dirección cambia, la vieja se apunta en `REDIRECCIONES` y sigue
//     funcionando: los enlaces guardados no se rompen.
//
// Nace solo con lo de este encargo, a propósito. Lo demás de Folvy se irá
// trayendo cuando se reorganice; no se mueve hoy lo que nadie ha pedido.

/** Una miga: la etiqueta y, si lleva a algún sitio, su dirección. */
export interface Miga {
  etiqueta: string
  ruta?: string
}

/**
 * Dónde vive cada pantalla. `modulo` es el basePath del módulo del Shell que
 * la monta; las rutas son relativas a él (es como las declara el Shell).
 *
 * HOY: dentro de Cocina, porque es donde está la entrada de menú. La pantalla
 * no depende de Cocina para nada: si mañana se monta en otro módulo, se
 * cambia `modulo` y se apunta la redirección.
 */
export const PROVEEDORES = {
  modulo: 'kitchen',
  etiquetaMenu: 'Proveedores',
  /** Lista de proveedores. */
  lista: 'proveedores',
  /** Ficha de un proveedor (pestaña Resumen). */
  ficha: 'proveedores/:supplierId',
  /** Un apartado de la ficha: pestaña en ordenador, pantalla en el móvil. */
  apartado: 'proveedores/:supplierId/:apartado',
} as const

/** Lo que va delante de «Proveedores» en las migas. Hoy: «Cocina». */
const MIGA_SECCION: Miga = { etiqueta: 'Cocina', ruta: `/${PROVEEDORES.modulo}` }

function absoluta(relativa: string): string {
  return `/${PROVEEDORES.modulo}/${relativa}`.replace(/\/+$/, '')
}

export function rutaListaProveedores(): string {
  return absoluta(PROVEEDORES.lista)
}

export function rutaFichaProveedor(supplierId: string, apartado?: string): string {
  const base = absoluta(PROVEEDORES.ficha.replace(':supplierId', encodeURIComponent(supplierId)))
  return apartado ? `${base}/${encodeURIComponent(apartado)}` : base
}

/**
 * «Subir factura» / «Foto factura» de la ficha: la pantalla de facturas de
 * proveedor, abriendo directamente el escaneo con este proveedor por defecto.
 * `camara` = desde el móvil, con la cámara.
 */
export function rutaSubirFacturaProveedor(supplierId: string, camara = false): string {
  const q = new URLSearchParams({ escanear: camara ? 'camara' : '1', proveedor: supplierId })
  return `/supply/facturas?${q.toString()}`
}

/** Migas de la lista: Cocina › Proveedores. */
export function migasProveedores(): Miga[] {
  return [MIGA_SECCION, { etiqueta: PROVEEDORES.etiquetaMenu }]
}

/** Migas de la ficha: Cocina › Proveedores › nombre. */
export function migasFichaProveedor(nombre: string): Miga[] {
  return [
    MIGA_SECCION,
    { etiqueta: PROVEEDORES.etiquetaMenu, ruta: rutaListaProveedores() },
    { etiqueta: nombre },
  ]
}

// ── Redirecciones ──────────────────────────────────────────────────────────
// Cuando una dirección cambie, la vieja se apunta aquí con la nueva. Las dos
// son ABSOLUTAS y pueden llevar parámetros (`:supplierId`), que pasan de una a
// otra con el mismo nombre. El módulo que tenga el basePath de `desde` la
// monta como ruta que redirige.
//
// Hoy está vacía: la ficha estrena dirección y no hay ninguna vieja que
// conservar (la de antes se abría encima de la lista, sin dirección propia).
export interface Redireccion {
  desde: string
  hasta: string
}

export const REDIRECCIONES: Redireccion[] = []

/** Las redirecciones que le tocan montar a un módulo, con `desde` relativo a él. */
export function redireccionesDelModulo(
  basePath: string,
  lista: Redireccion[] = REDIRECCIONES,
): { path: string; hasta: string }[] {
  const prefijo = `/${basePath}/`
  return lista
    .filter(r => r.desde.startsWith(prefijo))
    .map(r => ({ path: r.desde.slice(prefijo.length), hasta: r.hasta }))
}

/** Rellena los parámetros de `hasta` con los de la ruta vieja. */
export function resolverRedireccion(hasta: string, params: Record<string, string | undefined>): string {
  return hasta.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, nombre: string) =>
    encodeURIComponent(params[nombre] ?? ''),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Módulo de contabilidad (C00, 02/10/2026)
//
// El módulo tiene su menú propio, el de las maquetas del C00
// (docs/conta/maquetas/c00/). Todas sus entradas están declaradas AQUÍ, también
// las de pantallas que aún no existen: esas llevan `ruta: null` y NO se pintan
// (encargo C00 §7, «las entradas de pantallas que aún no existen no se
// muestran»). Cuando una pantalla llegue, se le pone su ruta y aparece sola.
//
// No depende de Cocina para nada: el módulo podrá venderse solo.
// ════════════════════════════════════════════════════════════════════════════

/** Nombre de los iconos de línea fina de la maqueta (src/modules/conta/ui/Icono.tsx). */
export type IconoConta =
  | 'inicio' | 'porHacer' | 'documentos' | 'bancos' | 'personas' | 'pagos'
  | 'facturas' | 'impuestos' | 'negocio' | 'libros' | 'ajustes' | 'folvy'

export const CONTA = {
  /** basePath del módulo en el Shell. */
  modulo: 'conta',
  nombre: 'Contabilidad',
  /** Interruptor de `feature_flags` que enseña el módulo en la barra de Folvy. */
  interruptor: 'conta',
  rutas: {
    /** Tu empresa (Ajustes). Es la portada del módulo mientras no haya Inicio. */
    empresa: 'ajustes',
    /** Un apartado de Tu empresa (en el móvil, una pantalla por apartado). */
    empresaApartado: 'ajustes/empresa/:apartado',
    /** Tablas generales: la primera tabla. */
    tablas: 'ajustes/tablas',
    /** Una tabla general concreta. */
    tabla: 'ajustes/tablas/:tabla',
    /** Alta conversada de una empresa. */
    alta: 'alta',
    /** Una entrada del índice de Ajustes (C02 §5a): ajustes/impuestos, ajustes/socios… */
    ajustesEntrada: 'ajustes/:entrada',
    /** Ajustes › Plan contable (C02, maqueta N5Plan dentro del marco de N6). */
    plan: 'ajustes/plan',
    /** Ajustes › Plan contable › Qué va a cada sitio. */
    planSitio: 'ajustes/plan/que-va-a-cada-sitio',
    /** La dirección vieja de una cuenta del plan: redirige a su Mayor (respuesta 5). */
    planCuenta: 'ajustes/plan/cuenta/:codigo',
    /**
     * Una cuenta del plan (respuesta 5): el Mayor si es de apunte o subcuenta
     * (40000002), «Sumas y saldos» de ese nivel si tiene hijas (400, 4).
     */
    mayor: 'plan/:codigo',
    /** Clientes y proveedores (C03): la lista única, con filtros por papel. */
    terceros: 'clientes-y-proveedores',
    /** La ficha de un tercero con papel de cliente, plataforma o socio (N9 / N10). */
    tercero: 'clientes-y-proveedores/:partyId',
    /** Un apartado de esa ficha: pestaña en ordenador, pantalla en el móvil. */
    terceroApartado: 'clientes-y-proveedores/:partyId/:apartado',
    /** Libros › Libro diario (C04, maqueta N11Diario). */
    libroDiario: 'libros/diario',
    /** Un asiento a mano, nuevo (C04). */
    nuevoAsiento: 'libros/diario/nuevo',
    /** Un asiento del libro (C04, maqueta N12Asiento). */
    asiento: 'libros/diario/:entryId',
    /** Libros en tres niveles (C05, maqueta N13cLibros): el índice. */
    libros: 'libros',
    /** El diario resumido (C05): ruta propia, para no chocar con un asiento. */
    diarioResumido: 'libros/diario/resumido',
    /** Un área de Libros y su primera acción (C05). */
    librosArea: 'libros/:area',
    /** Una acción de un área de Libros (C05): balance, sumas y saldos, libro registro… */
    librosAccion: 'libros/:area/:accion',
  },
} as const

export interface EntradaMenuConta {
  id: string
  etiqueta: string
  icono: IconoConta
  /** Ruta relativa al módulo. `null` = la pantalla aún no existe: no se pinta. */
  ruta: string | null
}

/** El menú de la maqueta, en su orden y con sus separaciones (grupos). */
export const MENU_CONTA: EntradaMenuConta[][] = [
  [
    { id: 'inicio', etiqueta: 'Inicio', icono: 'inicio', ruta: null },
    { id: 'por-hacer', etiqueta: 'Por hacer', icono: 'porHacer', ruta: null },
  ],
  [
    { id: 'documentos', etiqueta: 'Documentos', icono: 'documentos', ruta: null },
    { id: 'bancos', etiqueta: 'Bancos', icono: 'bancos', ruta: null },
    // C03: la lista única de terceros. Un tercero que solo es proveedor abre su
    // ficha de siempre (en Cocina); con papel de cliente, plataforma o socio,
    // la ficha N9/N10 de aquí.
    { id: 'terceros', etiqueta: 'Clientes y proveedores', icono: 'personas', ruta: CONTA.rutas.terceros },
    { id: 'pagos', etiqueta: 'Pagos y cobros', icono: 'pagos', ruta: null },
    { id: 'emitidas', etiqueta: 'Facturas que emites', icono: 'facturas', ruta: null },
  ],
  [
    { id: 'impuestos', etiqueta: 'Impuestos', icono: 'impuestos', ruta: null },
    { id: 'negocio', etiqueta: 'Cómo va tu negocio', icono: 'negocio', ruta: null },
    { id: 'libros', etiqueta: 'Libros', icono: 'libros', ruta: CONTA.rutas.libros },
  ],
  [
    { id: 'ajustes', etiqueta: 'Ajustes', icono: 'ajustes', ruta: CONTA.rutas.empresa },
  ],
]

/** La barra inferior del móvil: dos a cada lado del botón central de la IA. */
export const BARRA_CONTA: { izquierda: EntradaMenuConta[]; derecha: EntradaMenuConta[] } = {
  izquierda: [
    { id: 'inicio', etiqueta: 'Inicio', icono: 'inicio', ruta: null },
    { id: 'por-hacer', etiqueta: 'Por hacer', icono: 'porHacer', ruta: null },
  ],
  derecha: [
    { id: 'bancos', etiqueta: 'Bancos', icono: 'bancos', ruta: null },
    { id: 'ajustes', etiqueta: 'Ajustes', icono: 'ajustes', ruta: CONTA.rutas.empresa },
  ],
}

/** Las pestañas de Ajustes, en su orden. */
export const PESTANAS_AJUSTES: EntradaMenuConta[] = [
  { id: 'empresa', etiqueta: 'Tu empresa', icono: 'ajustes', ruta: CONTA.rutas.empresa },
  { id: 'tablas', etiqueta: 'Tablas generales', icono: 'ajustes', ruta: CONTA.rutas.tablas },
  // Vuelve con «Personas y asesor» (respuesta 1 del C00, D4).
  { id: 'personas', etiqueta: 'Personas y asesor', icono: 'personas', ruta: null },
  { id: 'avisos', etiqueta: 'Avisos', icono: 'porHacer', ruta: null },
]

/**
 * Ajustes como índice lateral agrupado (C02 §5a, maqueta N6Ajustes): solo
 * contabilidad, nada de Cocina ni reparto. Cada entrada abre su contenido a la
 * derecha (en el móvil, su pantalla). Las que aún no tienen pantalla salen con
 * su aviso «aún no» (`hueco`), como pide el encargo para Certificados: el
 * índice dice lo que habrá, y la entrada dice que todavía no está.
 */
export interface EntradaAjustes { id: string; etiqueta: string; ruta: string; hueco?: string }
export const INDICE_AJUSTES: { grupo: string; entradas: EntradaAjustes[] }[] = [
  {
    grupo: 'Empresa',
    entradas: [
      { id: 'empresa', etiqueta: 'Tu empresa', ruta: 'ajustes/empresa' },
      { id: 'impuestos', etiqueta: 'Tus impuestos', ruta: 'ajustes/impuestos' },
      { id: 'socios', etiqueta: 'Socios y cargos', ruta: 'ajustes/socios' },
      { id: 'ejercicio', etiqueta: 'Ejercicio', ruta: 'ajustes/ejercicio' },
    ],
  },
  {
    grupo: 'Contabilidad',
    entradas: [
      { id: 'plan', etiqueta: 'Plan contable', ruta: 'ajustes/plan' },
      { id: 'tablas', etiqueta: 'Tablas generales', ruta: 'ajustes/tablas' },
      { id: 'numeracion', etiqueta: 'Numeración', ruta: 'ajustes/numeracion', hueco: 'Las series de tus facturas llegan con las facturas que emites.' },
      { id: 'certificados', etiqueta: 'Certificados y accesos', ruta: 'ajustes/certificados', hueco: 'El certificado digital y los accesos a la sede de Hacienda llegan con la presentación de impuestos.' },
    ],
  },
  {
    grupo: 'Acceso y avisos',
    entradas: [
      { id: 'personas', etiqueta: 'Personas y asesor', ruta: 'ajustes/personas', hueco: 'Quién entra y qué ve, y el acceso de tu asesor, llegan en un encargo propio.' },
      { id: 'avisos', etiqueta: 'Avisos', ruta: 'ajustes/avisos', hueco: 'Qué te avisa Folvy y por dónde llega en un encargo propio.' },
      { id: 'folvy', etiqueta: 'Lo que ha hecho Folvy', ruta: 'ajustes/folvy' },
    ],
  },
]

export const entradaAjustes = (id: string | undefined): EntradaAjustes | null =>
  INDICE_AJUSTES.flatMap((g) => g.entradas).find((e) => e.id === id) ?? null

/** El apartado viejo del móvil (ajustes/empresa/:apartado) → su entrada del índice. */
export const ENTRADA_DE_APARTADO: Record<string, string> = {
  'quien-eres': 'empresa', actividad: 'empresa', impuestos: 'impuestos', presentar: 'impuestos', detalle: 'impuestos',
  ejercicio: 'ejercicio', socios: 'socios', registro: 'folvy',
}

/** Solo las entradas que existen: lo que se pinta. */
export function entradasVisibles(lista: EntradaMenuConta[]): (EntradaMenuConta & { ruta: string })[] {
  return lista.filter((e): e is EntradaMenuConta & { ruta: string } => e.ruta !== null)
}

/** Dirección absoluta de una ruta del módulo, con sus parámetros rellenos. */
export function rutaConta(relativa: string, params: Record<string, string> = {}): string {
  const rellena = relativa.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, n: string) => encodeURIComponent(params[n] ?? ''))
  return `/${CONTA.modulo}/${rellena}`.replace(/\/+$/, '')
}

export const rutaTuEmpresa = (): string => rutaConta(CONTA.rutas.empresa)
export const rutaApartadoEmpresa = (apartado: string): string => rutaConta(CONTA.rutas.empresaApartado, { apartado })
export const rutaTablasGenerales = (tabla?: string): string =>
  tabla ? rutaConta(CONTA.rutas.tabla, { tabla }) : rutaConta(CONTA.rutas.tablas)
export const rutaAltaEmpresa = (): string => rutaConta(CONTA.rutas.alta)
export const rutaAjustes = (entrada?: string): string => (entrada ? rutaConta(CONTA.rutas.ajustesEntrada, { entrada }) : rutaConta(CONTA.rutas.empresa))
export const rutaPlan = (): string => rutaConta(CONTA.rutas.plan)
export const rutaPlanSitio = (): string => rutaConta(CONTA.rutas.planSitio)
export const rutaMayor = (codigo: string): string => rutaConta(CONTA.rutas.mayor, { codigo })
export const rutaTerceros = (filtro?: string): string => `${rutaConta(CONTA.rutas.terceros)}${filtro ? `?ver=${encodeURIComponent(filtro)}` : ''}`
export const rutaLibroDiario = (filtro?: string): string => `${rutaConta(CONTA.rutas.libroDiario)}${filtro ? `?ver=${encodeURIComponent(filtro)}` : ''}`
export const rutaAsiento = (entryId: string): string => rutaConta(CONTA.rutas.asiento, { entryId })
export const rutaNuevoAsiento = (): string => rutaConta(CONTA.rutas.nuevoAsiento)
/**
 * Libros (C05). El libro diario conserva su ruta del C04 y el diario resumido
 * tiene la suya (libros/diario/<algo> es un asiento).
 */
export const rutaLibros = (area?: string, accion?: string): string => {
  if (!area) return rutaConta(CONTA.rutas.libros)
  if (area === 'diario') return accion === 'diario-resumido' ? rutaConta(CONTA.rutas.diarioResumido) : rutaConta(CONTA.rutas.libroDiario)
  return accion ? rutaConta(CONTA.rutas.librosAccion, { area, accion }) : rutaConta(CONTA.rutas.librosArea, { area })
}
export const rutaFichaTercero = (partyId: string, apartado?: string): string =>
  apartado ? rutaConta(CONTA.rutas.terceroApartado, { partyId, apartado }) : rutaConta(CONTA.rutas.tercero, { partyId })

/**
 * Migas de la ficha de un tercero: Clientes y proveedores › <su lista> › nombre.
 * La lista intermedia, la de su papel principal (Plataformas, Socios de marca, Clientes).
 */
export function migasFichaTercero(nombre: string, lista: { etiqueta: string; filtro: string }): Miga[] {
  return [
    { etiqueta: 'Clientes y proveedores', ruta: rutaTerceros() },
    { etiqueta: lista.etiqueta, ruta: rutaTerceros(lista.filtro) },
    { etiqueta: nombre },
  ]
}

/**
 * ¿Qué entrada del menú está activa para esta dirección? La de prefijo más
 * largo, como el Shell (C01): «ajustes/tablas/impuestos» sigue siendo Ajustes.
 */
export function entradaActiva(pathname: string, lista: EntradaMenuConta[]): string | null {
  const base = `/${CONTA.modulo}`
  if (!pathname.startsWith(base)) return null
  const resto = pathname.slice(base.length).replace(/^\/+|\/+$/g, '')
  const candidatas = entradasVisibles(lista)
    .filter(e => resto === e.ruta || (e.ruta === '' ? true : resto.startsWith(`${e.ruta}/`)))
    .sort((a, b) => b.ruta.length - a.ruta.length)
  return candidatas[0]?.id ?? null
}
