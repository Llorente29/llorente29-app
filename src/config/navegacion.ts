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

import { MARCA } from '../marca/marca'

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

/**
 * C06 · En el producto vendido solo (marca de solo contabilidad) no hay Cocina:
 * la ficha del proveedor se abre dentro de contabilidad, bajo «Clientes y
 * proveedores», y la lista es la de terceros filtrada a proveedores. Con
 * Folvy, todo como siempre (Cocina › Proveedores).
 */
const PROVEEDOR_EN_CONTA = MARCA.soloContabilidad

function absoluta(relativa: string): string {
  return `/${PROVEEDORES.modulo}/${relativa}`.replace(/\/+$/, '')
}

export function rutaListaProveedores(): string {
  if (PROVEEDOR_EN_CONTA) return `/conta/clientes-y-proveedores?ver=proveedores`
  return absoluta(PROVEEDORES.lista)
}

export function rutaFichaProveedor(supplierId: string, apartado?: string): string {
  const base = PROVEEDOR_EN_CONTA
    ? `/conta/clientes-y-proveedores/proveedor/${encodeURIComponent(supplierId)}`
    : absoluta(PROVEEDORES.ficha.replace(':supplierId', encodeURIComponent(supplierId)))
  return apartado ? `${base}/${encodeURIComponent(apartado)}` : base
}

/**
 * «Subir factura» / «Foto factura» de la ficha: la pantalla de facturas de
 * proveedor, abriendo directamente el escaneo con este proveedor por defecto.
 * `camara` = desde el móvil, con la cámara.
 */
export function rutaSubirFacturaProveedor(supplierId: string, camara = false): string {
  // C06: sin Cocina, la factura se sube en Compras de contabilidad (SubirFactura).
  if (PROVEEDOR_EN_CONTA) return `/conta/compras?${new URLSearchParams({ subir: supplierId }).toString()}`
  const q = new URLSearchParams({ escanear: camara ? 'camara' : '1', proveedor: supplierId })
  return `/supply/facturas?${q.toString()}`
}

/** Migas de la lista: Cocina › Proveedores (C06: sin Cocina, Clientes y proveedores › Proveedores). */
export function migasProveedores(): Miga[] {
  if (PROVEEDOR_EN_CONTA) return [{ etiqueta: 'Clientes y proveedores', ruta: '/conta/clientes-y-proveedores' }, { etiqueta: PROVEEDORES.etiquetaMenu }]
  return [MIGA_SECCION, { etiqueta: PROVEEDORES.etiquetaMenu }]
}

/** Migas de la ficha: Cocina › Proveedores › nombre. */
export function migasFichaProveedor(nombre: string): Miga[] {
  return [
    ...(PROVEEDOR_EN_CONTA ? [{ etiqueta: 'Clientes y proveedores', ruta: '/conta/clientes-y-proveedores' }] : [MIGA_SECCION]),
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
  | 'facturas' | 'impuestos' | 'negocio' | 'libros' | 'ajustes' | 'folvy' | 'mas'

export const CONTA = {
  /** basePath del módulo en el Shell. */
  modulo: 'conta',
  nombre: 'Contabilidad',
  /** Interruptor de `feature_flags` que enseña el módulo en la barra de Folvy. */
  interruptor: 'conta',
  rutas: {
    /** Inicio (C06, «Estilo nuevo · Inicio»): la portada del módulo vendido solo. */
    inicio: 'inicio',
    /** V02 · Inicio › Documentos (tablero 19): la puerta por la que entra todo. */
    puerta: 'inicio/documentos',
    /** V02d · Inicio › Documentos › Qué esperas cada mes (tablero 23): una página, no un cuadro. */
    queEsperas: 'inicio/documentos/que-esperas',
    /** Tu empresa (Ajustes). Es la portada del módulo con Folvy (sin Inicio). */
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
    /** «Cómo te factura» de un proveedor, en su pantalla (maqueta N20; respuesta 1 del repaso de compras). */
    comoTeFactura: 'clientes-y-proveedores/proveedor/:supplierId/como-te-factura',
    /** C06 · La ficha del proveedor dentro de contabilidad (sin Cocina, producto vendido solo). */
    fichaProveedor: 'clientes-y-proveedores/proveedor/:supplierId',
    fichaProveedorApartado: 'clientes-y-proveedores/proveedor/:supplierId/:apartado',
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
    /** C06b R7 · Pendientes de adjuntar en Diez: ruta propia, como el resumido, para no chocar con un asiento. */
    pendientesDiez: 'libros/diario/pendientes-diez',
    /** Un área de Libros y su primera acción (C05). */
    librosArea: 'libros/:area',
    /** Una acción de un área de Libros (C05): balance, sumas y saldos, libro registro… */
    librosAccion: 'libros/:area/:accion',
    /** Compras (encargo de compras, N18): lo que hay que mirar, lo que espera factura, las liquidaciones. */
    compras: 'compras',
    /** Ventas (en el menú como la maqueta; su pantalla, con el detalle de las plataformas). */
    ventas: 'ventas',
    /** S02 · PR 3 · Compras y gastos › Liquidaciones: todas, las mensuales y las quincenas de Catcher.
     *  PC01 · E2 (Julio, 26/10): pasa a llamarse «Repartidores» (la quincena de los riders); esta es la
     *  dirección de antes, que redirige (module.tsx). «Liquidaciones» queda solo para Ventas. */
    liquidaciones: 'compras/liquidaciones',
    /** PC01 · E2 · Compras y gastos › Repartidores (antes «Liquidaciones»): las quincenas de Catcher. */
    repartidores: 'compras/repartidores',
    /** PC01 · E2 · Compras y gastos › Pagos (tablero 15): lo que debes a tus proveedores, sus remesas y la ficha de una (tablero 16). */
    pagos: 'compras/pagos',
    remesasPagos: 'compras/pagos/remesas',
    remesaPagos: 'compras/pagos/remesas/:remesaId',
    /** Subir los documentos de una liquidación mensual (N19). */
    liquidacionNueva: 'compras/liquidacion/nueva',
    /** Una liquidación mensual y su contraste (N19). */
    liquidacion: 'compras/liquidacion/:liqId',
    /** D01 · Documentos › Facturas recibidas (N22). */
    documentos: 'documentos',
    /** D01 · Revisar una factura recibida (N23). */
    revisarFactura: 'documentos/recibidas/:invoiceId',
    /** S01 · La misma factura recibida vista desde Contabilidad › Asientos (maqueta 3): la primera para revisar… */
    recibidasEnAsientos: 'libros/diario/recibidas',
    /** …y una en concreto. S02 · PR 2: las dos se quedan solo para llevar a Compras (module.tsx). */
    recibidaEnAsientos: 'libros/diario/recibidas/:invoiceId',
    /** S02 · PR 2 · Una factura recibida escrita a mano, sin papel (antes, libros/diario/recibidas?nueva=a-mano). */
    recibidaAMano: 'documentos/nueva',
    /** S02 · PR 2 · Facturación › Facturas emitidas, y una nueva. V01: solo para llevar a Ventas › Facturas (module.tsx). */
    facturasEmitidas: 'facturacion/emitidas',
    nuevaEmitida: 'facturacion/emitidas/nueva',
    /** V01 · Ventas › Facturas: la lista, una nueva a mano y la ficha de una. */
    facturasVenta: 'ventas/facturas',
    nuevaFacturaVenta: 'ventas/facturas/nueva',
    facturaVenta: 'ventas/facturas/:facturaId',
    /** V01 · Entrega 2 · Ventas › Cierres del día (solo con «Vendo en hostelería»): la lista y la ficha de uno. */
    cierres: 'ventas/cierres',
    cierre: 'ventas/cierres/:cierreId',
    /**
     * V01 · Entrega 3 · Ventas › Liquidaciones (solo con «Vendo en hostelería»):
     * las de plataforma, por periodo, plataforma y local (y la ficha de una
     * fila: canal:local:desde:hasta), y las de los socios de marca (su ficha
     * sigue en compras/liquidacion/:liqId, que la barra marca en Ventas).
     */
    liquidacionesVentas: 'ventas/liquidaciones',
    /** PC01 · E3 · Ventas › Cobros (tablero cobros-1): lo que te deben tus clientes, las remesas de recibos y la ficha de una (cobros-2). */
    cobros: 'ventas/cobros',
    remesaCobros: 'ventas/cobros/remesas/:remesaId',
    liquidacionPlataforma: 'ventas/liquidaciones/plataforma/:clave',
    /** S01j·2 · La ficha de UNA liquidación de plataforma: sus cifras, su factura de comisión y el correo del que salió. */
    liquidacionFicha: 'ventas/liquidaciones/liquidacion/:id',
    /** E05 · Una quincena de Catcher subida: sus facturas, lo por aclarar, el pago y el saldo prepago. */
    loteCatcher: 'documentos/catcher/:loteId',
    /** Bancos (B01, maqueta N17Bancos): Movimientos, Reglas, Cuentas y extractos y Cierre del mes. */
    bancos: 'bancos',
    /** Una pestaña de Bancos, o una de sus acciones (subir, hecho-por-folvy). */
    bancosPestana: 'bancos/:pestana',
    /** M01 · La muestra de las tres piezas comunes, con datos inventados. Solo fuera de producción (module.tsx). */
    muestraPiezas: 'ajustes/muestra-piezas',
    /** S01 · El sistema de diseño: tokens y componentes, con datos inventados. Solo fuera de producción (module.tsx). */
    sistemaDiseno: 'ajustes/sistema-diseno',
    /** S01 · Contabilidad › Definiciones › Analítica: los ejes de la empresa (conta_eje_analitico). */
    analitica: 'ajustes/analitica',
    /** I01b · Impuestos › Calendario (tablero 8). */
    impuestos: 'impuestos',
    /** I01b · Una pestaña de Impuestos: presentados, sociedades, certificados. */
    impuestosPestana: 'impuestos/:pestana',
    /** LS1 · Laboral (28/10): Equipo, y cada página por su nombre, el mismo que en Folvy › Personal. */
    laboral: 'laboral',
    laboralPagina: 'laboral/:pagina',
    /** LS1 · Lo que llega más adelante (contrato y convenio, nóminas, seguros sociales, SEPE). */
    laboralLlega: 'laboral/llega/:que',
    /** I01b · El IVA de un periodo (tablero 9): impuestos/iva/2026/3T. */
    impuestoIva: 'impuestos/iva/:ejercicio/:periodo',
    /** I01c · El trimestre (maqueta_303_v2): impuestos/trimestre/2026/3T. */
    impuestoTrimestre: 'impuestos/trimestre/:ejercicio/:trimestre',
    impuestoAnual: 'impuestos/anual/:ejercicio/:modelo',
    /** I01c · El trimestre de una empresa por la ruta (la vista de despacho de P abre el de un cliente). */
    impuestoTrimestreEmpresa: 'impuestos/empresa/:empresa/trimestre/:ejercicio/:trimestre',
    /** P01 · El trimestre de un cliente de la asesoría: impuestos/clientes/<empresa>. */
    impuestosCliente: 'impuestos/clientes/:empresa',
    /** I01b · Aceptar la invitación de una empresa a su asesoría (también sin sesión: AuthRouter). */
    aceptarAsesoria: 'asesoria',
  },
} as const

// S02 · Aquí estaba el menú del C00 (MENU_CONTA, BARRA_CONTA y PESTANAS_AJUSTES,
// con entradasVisibles y entradaActiva). No lo pintaba nada desde el S01: la
// barra de contabilidad sale de src/modules/conta/esqueleto/productos.ts.

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
      // S01e: las series ya se crean en Tablas generales › Numeración de facturas: la entrada lleva allí y cuenta las que hay.
      { id: 'numeracion', etiqueta: 'Numeración', ruta: 'ajustes/tablas/numeracion' },
      // S01o · El interruptor de la empresa: lo que Sumied sabe al 100 % se apunta solo.
      { id: 'apuntar-solo', etiqueta: 'Apuntar solo lo seguro', ruta: 'ajustes/apuntar-solo' },
      { id: 'certificados', etiqueta: 'Certificados y accesos', ruta: 'ajustes/certificados', hueco: 'El certificado digital y los accesos a la sede de Hacienda llegan con la presentación de impuestos.' },
    ],
  },
  {
    // S01c · Ajustes › Correo de facturas: la dirección, el reenvío de Gmail y lo que ha llegado.
    grupo: 'Compras',
    entradas: [
      { id: 'correo-facturas', etiqueta: 'Correo de facturas', ruta: 'ajustes/correo-facturas' },
    ],
  },
  {
    // V03 E2 · Ajustes › Facturación › Verifactu (tablero 25).
    grupo: 'Facturación',
    entradas: [
      { id: 'verifactu', etiqueta: 'Verifactu', ruta: 'ajustes/verifactu' },
      // PC01 E4 · Ajustes › Cobros: los recordatorios (y, cuando llegue, el enlace de pago).
      { id: 'cobros', etiqueta: 'Cobros', ruta: 'ajustes/cobros' },
    ],
  },
  {
    grupo: 'Acceso y avisos',
    entradas: [
      // DM1 · PR 1 (30/10): ya no es un hueco. Quién entra e «Invitar a una persona» (tablero 4).
      { id: 'personas', etiqueta: 'Usuarios', ruta: 'ajustes/personas' },
      { id: 'avisos', etiqueta: 'Avisos', ruta: 'ajustes/avisos', hueco: `Qué te avisa ${MARCA.nombre} y por dónde llega en un encargo propio.` },
      { id: 'folvy', etiqueta: `Lo que ha hecho ${MARCA.nombre}`, ruta: 'ajustes/folvy' },
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

/** Las entradas del índice de Ajustes que se pintan: en el producto vendido solo, sin las que dicen «aún no». */
export function indiceAjustes(solo = false): typeof INDICE_AJUSTES {
  if (!solo) return INDICE_AJUSTES
  return INDICE_AJUSTES.map((g) => ({ ...g, entradas: g.entradas.filter((e) => !e.hueco) })).filter((g) => g.entradas.length > 0)
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
  if (area === 'diario' && accion === 'diario-resumido') return rutaConta(CONTA.rutas.diarioResumido)
  if (area === 'diario' && accion === 'pendientes-diez') return rutaConta(CONTA.rutas.pendientesDiez)
  if (area === 'diario' && (!accion || accion === 'libro-diario')) return rutaConta(CONTA.rutas.libroDiario)
  return accion ? rutaConta(CONTA.rutas.librosAccion, { area, accion }) : rutaConta(CONTA.rutas.librosArea, { area })
}
export const rutaCompras = (): string => rutaConta(CONTA.rutas.compras)
/** V02 · La puerta (Inicio › Documentos), en una de sus pestañas: lo último, «necesita que lo mires» o colocado. */
/** V02d · Qué esperas cada mes (tablero 23). */
export const rutaQueEsperas = (): string => rutaConta(CONTA.rutas.queEsperas)
export const rutaPuerta = (ver?: 'mirar' | 'colocado'): string => `${rutaConta(CONTA.rutas.puerta)}${ver ? `?ver=${ver}` : ''}`
/** D01 · N22, con su filtro (para-mirar, por-aclarar, apuntadas, todas) y su mes ('YYYY-MM'). */
export const rutaDocumentos = (ver?: string, mes?: string): string => {
  const q = new URLSearchParams()
  if (ver) q.set('ver', ver)
  if (mes) q.set('mes', mes)
  const t = q.toString()
  return `${rutaConta(CONTA.rutas.documentos)}${t ? `?${t}` : ''}`
}
/** D01 · N23. */
export const rutaRevisarFactura = (invoiceId: string): string => rutaConta(CONTA.rutas.revisarFactura, { invoiceId })
/**
 * S02 · PR 2 · Las recibidas son de Compras y gastos (regla 1 del patrón: cada
 * cosa en un sitio). Sin id, la lista en «Por revisar»; con id, su ficha.
 */
export const rutaRecibidaEnAsientos = (invoiceId?: string): string =>
  invoiceId ? rutaRevisarFactura(invoiceId) : `${rutaConta(CONTA.rutas.documentos)}?ver=por-revisar`
/** S01d · La consulta de antes para «Nueva recibida a mano» (libros/diario/recibidas?nueva=a-mano): module.tsx la lleva a Compras. */
export const CONSULTA_RECIBIDA_A_MANO = 'nueva=a-mano'
/** S02 · PR 2 · «Escribir una a mano», en Compras y gastos › Facturas recibidas. */
export const rutaRecibidaAMano = (): string => rutaConta(CONTA.rutas.recibidaAMano)
/** V01 · Ventas › Facturas (la de antes, Facturación › Facturas emitidas, lleva aquí), una nueva y una. */
export const rutaFacturasVenta = (): string => rutaConta(CONTA.rutas.facturasVenta)
export const rutaNuevaFacturaVenta = (): string => rutaConta(CONTA.rutas.nuevaFacturaVenta)
export const rutaFacturaVenta = (facturaId: string): string => rutaConta(CONTA.rutas.facturaVenta, { facturaId })
/** V01 · Entrega 2 · Ventas › Cierres del día y un cierre. */
export const rutaCierres = (): string => rutaConta(CONTA.rutas.cierres)
export const rutaCierre = (cierreId: string): string => rutaConta(CONTA.rutas.cierre, { cierreId })
/** V01 · Entrega 3 · Ventas › Liquidaciones (ver: plataformas · socios) y la ficha de una fila de plataforma. */
export const rutaLiquidacionesVentas = (ver?: 'plataformas' | 'socios'): string => `${rutaConta(CONTA.rutas.liquidacionesVentas)}${ver ? `?ver=${ver}` : ''}`
export const rutaLiquidacionPlataforma = (clave: string): string => rutaConta(CONTA.rutas.liquidacionPlataforma, { clave })
export const rutaLiquidacionFicha = (id: string): string => rutaConta(CONTA.rutas.liquidacionFicha, { id })
/** Lo de antes: llevan a Ventas › Facturas. */
export const rutaFacturasEmitidas = rutaFacturasVenta
export const rutaNuevaEmitida = rutaNuevaFacturaVenta
/** E05 · Una quincena de Catcher. */
export const rutaLoteCatcher = (loteId: string): string => rutaConta(CONTA.rutas.loteCatcher, { loteId })
/** Bancos (B01): sin pestaña, Movimientos. */
export const rutaBancos = (pestana?: string): string => (pestana ? rutaConta(CONTA.rutas.bancosPestana, { pestana }) : rutaConta(CONTA.rutas.bancos))
/** S02 · PR 3 · Compras y gastos › Liquidaciones (con ?subir=catcher, abierta la de subir la quincena). */
export const rutaLiquidaciones = (subir?: 'catcher'): string => `${rutaConta(CONTA.rutas.repartidores)}${subir ? `?subir=${subir}` : ''}`
/** PC01 · E2 · Compras › Pagos, con su pestaña si se dice. */
export const rutaPagos = (pestana?: string): string => `${rutaConta(CONTA.rutas.pagos)}${pestana ? `?pestana=${pestana}` : ''}`
export const rutaRemesasPagos = (): string => rutaConta(CONTA.rutas.remesasPagos)
export const rutaRemesaPagos = (remesaId: string): string => rutaConta(CONTA.rutas.remesaPagos, { remesaId })
/** PC01 · E3 · Ventas › Cobros, con su pestaña si se dice; y la ficha de una remesa de recibos. */
export const rutaCobros = (pestana?: string): string => `${rutaConta(CONTA.rutas.cobros)}${pestana ? `?pestana=${pestana}` : ''}`
export const rutaRemesaCobros = (remesaId: string): string => rutaConta(CONTA.rutas.remesaCobros, { remesaId })
export const rutaLiquidacion = (liqId: string): string => rutaConta(CONTA.rutas.liquidacion, { liqId })
/** I01b · Impuestos: el calendario, o una de sus pestañas (presentados, sociedades, certificados). */
export const rutaImpuestos = (pestana?: string): string => (pestana ? rutaConta(CONTA.rutas.impuestosPestana, { pestana }) : rutaConta(CONTA.rutas.impuestos))
/** I01b · El IVA de un periodo: el 303 del 3T de 2026 → /conta/impuestos/iva/2026/3T. */
/** P01 · La ruta vieja de «abrir un cliente»: redirige a su Trimestre (rutaTrimestre con la empresa). */
export const rutaClienteImpuestos = (empresa: string): string => rutaConta(CONTA.rutas.impuestosCliente, { empresa })
export const rutaIvaPeriodo = (ejercicio: number, periodo: string): string => rutaConta(CONTA.rutas.impuestoIva, { ejercicio: String(ejercicio), periodo })
/**
 * I01c · El trimestre: el 3T de 2026 → /conta/impuestos/trimestre/2026/3T. Con
 * la empresa, el de esa empresa (la vista de despacho): /conta/impuestos/empresa/<id>/trimestre/2026/3T.
 */
export const rutaTrimestre = (ejercicio: number, trimestre: string, empresa?: string): string => (empresa
  ? rutaConta(CONTA.rutas.impuestoTrimestreEmpresa, { empresa, ejercicio: String(ejercicio), trimestre })
  : rutaConta(CONTA.rutas.impuestoTrimestre, { ejercicio: String(ejercicio), trimestre }))
/** S02 · Los modelos del año: el 190 de 2026 → /conta/impuestos/anual/2026/190. */
export const rutaAnual = (ejercicio: number, modelo: string): string => rutaConta(CONTA.rutas.impuestoAnual, { ejercicio: String(ejercicio), modelo })
/** Subir los documentos de la liquidación de un proveedor, en un local y un mes ('YYYY-MM-01'). */
export const rutaLiquidacionNueva = (proveedor: string, local: string | null, mes: string): string => {
  const q = new URLSearchParams({ proveedor, mes })
  if (local) q.set('local', local)
  return `${rutaConta(CONTA.rutas.liquidacionNueva)}?${q.toString()}`
}
export const rutaComoTeFactura = (supplierId: string): string => rutaConta(CONTA.rutas.comoTeFactura, { supplierId })
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

