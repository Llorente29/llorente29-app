// src/modules/conta/esqueleto/productos.ts
//
// Los apartados de la barra y sus páginas. De aquí salen la barra lateral (y
// su cajón en el móvil), las páginas que se despliegan bajo el apartado activo
// y qué apartado y qué página están activos para cada dirección. Núcleo puro:
// se prueba sin React.
//
// S02 · Patrón único (Julio, 22/10, tablero 0 «El mapa»):
//   Inicio · Contabilidad · Facturación · Compras y gastos · Bancos · Laboral ·
//   Impuestos · Contactos · (abajo) Favoritos · Ajustes
// Y, solo en una cuenta que es asesoría, «Clientes del despacho» arriba del
// todo: para el asesor es su Inicio (respuesta de Julio al paso 1 del S02).
// Las páginas de cada apartado ya no van en pestañas de la cabecera: el
// apartado activo se abre en la barra y enseña sus páginas debajo.
//
// Tres reglas (S01, se quedan):
//   1. Las pantallas NO cambian de dirección: cada página dice qué direcciones
//      son suyas (`prefijos`) y gana el prefijo más largo.
//   2. Nada vacío delante del cliente: un apartado o una página sin pantalla
//      (`ruta: null`) no sale. Facturación, Laboral e Impuestos llevan además
//      su interruptor por cuenta en `feature_flags`.
//   3. Hostelería, Diez y la asesoría son de la EMPRESA o de la CUENTA: lo que
//      solo tiene sentido con ellas solo sale si lo tienen.
// Y una del S02: los grupos de la barra (Finanzas · Personas · Operaciones)
// están previstos en cada apartado (`grupo`), pero NO se pintan hasta que
// entren más apartados (encargo S02, «Barra lateral»).

import { CONTA, INDICE_AJUSTES } from '@/config/navegacion'
import type { NombreIcono } from '@/modules/conta/diseno/iconos'

export type IdProducto = 'despacho' | 'inicio' | 'contabilidad' | 'facturacion' | 'compras' | 'bancos' | 'laboral' | 'impuestos' | 'contactos' | 'ajustes'

/** Lo que solo sale si la empresa (o la cuenta) lo tiene. */
export type Condicion = 'hosteleria' | 'diez' | 'asesoria'

export type Interruptor = 'conta_facturacion' | 'conta_laboral' | 'conta_impuestos'
export const INTERRUPTORES: readonly Interruptor[] = ['conta_facturacion', 'conta_laboral', 'conta_impuestos']

/** S02 · Los grupos de la barra, previstos y sin pintar (encargo S02). */
export type GrupoBarra = 'finanzas' | 'personas' | 'operaciones'
export const NOMBRE_GRUPO: Record<GrupoBarra, string> = { finanzas: 'Finanzas', personas: 'Personas', operaciones: 'Operaciones' }

/** Una página de un apartado (hasta el S02, una «pestaña» de la cabecera). */
export interface Pestana {
  id: string
  etiqueta: string
  icono: NombreIcono
  /** Dirección relativa al módulo; null = aún no tiene pantalla (no sale). */
  ruta: string | null
  /** Las direcciones que caen en esta página. */
  prefijos: string[]
  solo?: Condicion
  /**
   * La página es una vista de la misma pantalla (`?ver=`): Contactos. Se marca
   * cuando la dirección la pide; la que no lleva `ver` es la de serie.
   */
  ver?: string
  /** La página existe pero aún dice «aún no» (Ajustes): no sale en el producto vendido solo. */
  hueco?: boolean
  /** V01 · El bloque de la barra al que pertenece («Hostelería»): su título sale encima de la primera. */
  bloque?: string
  /** LS1 · Aún no existe: la barra lo dice («Llega en noviembre») y su página lo explica. */
  llega?: string
}

export interface Producto {
  id: IdProducto
  etiqueta: string
  icono: NombreIcono
  /** Dirección de entrada; null = sin pantalla (no sale). */
  ruta: string | null
  /** Direcciones del apartado que no son de ninguna página (la portada, el alta). */
  prefijos: string[]
  pestanas: Pestana[]
  interruptor?: Interruptor
  /** El apartado entero solo sale si la empresa o la cuenta lo tiene (el despacho). */
  solo?: Condicion
  /** Va abajo del todo en la barra (Ajustes). */
  abajo?: boolean
  /** S02 · Su grupo, cuando la barra se agrupe (hoy no se pinta). */
  grupo?: GrupoBarra
}

/** Lo que decide qué sale: de la empresa activa y de la cuenta. */
export interface Contexto {
  hosteleria: boolean
  diez: boolean
  interruptores: ReadonlySet<string>
  /** S01 · El logo de la empresa (URL firmada del bucket company-logos), o null. No decide qué sale. */
  logoEmpresa?: string | null
  /** S02 · El color que eligió la empresa (company.color, '#RRGGBB'), o null. No decide qué sale. */
  colorEmpresa?: string | null
  /**
   * S01 · Los ejes de analítica encendidos de la empresa (conta_eje_analitico):
   * null = no se han podido leer: todo sale, como antes.
   */
  analitica?: Analitica | null
  /** P01 · La CUENTA es una asesoría o ya lleva clientes con permiso. Sin leer, no lo es. */
  asesoria?: boolean
  /** S02 · El producto vendido solo (C06): sin las páginas que aún dicen «aún no». */
  solo?: boolean
}

/** Un eje de analítica encendido, con el nombre que le da la empresa. */
export interface EjeVista { nombre: string; plural: string }
/** Los dos ejes; null = apagado (ni se pide ni se enseña; lo guardado se queda). */
export interface Analitica { local: EjeVista | null; marca: EjeVista | null }

const R = CONTA.rutas

/** LS1 · Una página de Laboral: su dirección es `laboral/<pagina>`, el mismo nombre que en Folvy › Personal. */
function lab(id: string, etiqueta: string, icono: NombreIcono, pagina: string, bloque?: string): Pestana {
  const ruta = pagina ? `${R.laboral}/${pagina}` : R.laboral
  return { id, etiqueta, icono, ruta, prefijos: pagina ? [ruta] : [R.laboral], ...(bloque ? { bloque } : {}) }
}

/** LS1 · Lo que aún no existe: sale en el menú con «Llega en …» y lleva a una página que lo dice. */
function llega(id: string, etiqueta: string, icono: NombreIcono, cuando: string): Pestana {
  const ruta = `${R.laboral}/llega/${id}`
  return { id, etiqueta, icono, ruta, prefijos: [ruta], bloque: 'Llega pronto', llega: `Llega en ${cuando}` }
}

/**
 * S02 · Las páginas de Ajustes son las entradas de su índice (C02), menos las
 * que son de Contabilidad › Definiciones (el plan, las tablas y la numeración,
 * que vive en las tablas): una cosa, un solo sitio.
 */
const DE_DEFINICIONES = new Set(['plan', 'tablas', 'numeracion'])
const PAGINAS_AJUSTES: Pestana[] = INDICE_AJUSTES.flatMap((g) => g.entradas)
  .filter((e) => !DE_DEFINICIONES.has(e.id))
  .map((e): Pestana => ({
    id: e.id, etiqueta: e.etiqueta, icono: e.id === 'folvy' ? 'ia' : e.id === 'empresa' ? 'empresa' : e.id === 'personas' ? 'usuarios' : e.id === 'avisos' ? 'avisos' : e.id === 'impuestos' ? 'impuestos' : e.id === 'socios' ? 'socios' : e.id === 'ejercicio' ? 'fecha' : 'ajustes',
    ruta: e.ruta,
    // «Tu empresa» es también la portada de Ajustes (la dirección «ajustes» a secas).
    prefijos: e.id === 'empresa' ? [R.empresa, e.ruta] : [e.ruta],
    hueco: !!e.hueco,
  }))

export const PRODUCTOS: Producto[] = [
  // S02 · Solo en una cuenta que es asesoría: la cartera de sus clientes, arriba del todo.
  {
    id: 'despacho', etiqueta: 'Clientes del despacho', icono: 'despacho', ruta: `${R.impuestos}/clientes`,
    prefijos: [`${R.impuestos}/clientes`], solo: 'asesoria', pestanas: [],
  },
  {
    // V02 · Inicio › Documentos (tablero 19): la puerta, la única página del apartado (la portada es Inicio a secas).
    id: 'inicio', etiqueta: 'Inicio', icono: 'inicio', ruta: R.inicio, prefijos: [R.inicio],
    pestanas: [{ id: 'documentos', etiqueta: 'Documentos', icono: 'documento', ruta: R.puerta, prefijos: [R.puerta] }],
  },
  {
    id: 'contabilidad', etiqueta: 'Contabilidad', icono: 'contabilidad', ruta: R.libroDiario, prefijos: [], grupo: 'finanzas',
    pestanas: [
      { id: 'asientos', etiqueta: 'Asientos', icono: 'asientos', ruta: R.libroDiario, prefijos: [R.libroDiario] },
      {
        id: 'listados', etiqueta: 'Libros y listados', icono: 'listados', ruta: `${R.libros}/mayor/libro-mayor`,
        prefijos: [R.libros, R.diarioResumido, `${R.libros}/mayor`, `${R.libros}/registro`, `${R.libros}/balances`, 'plan'],
      },
      { id: 'definiciones', etiqueta: 'Definiciones', icono: 'definiciones', ruta: R.plan, prefijos: [R.plan, R.tablas, R.analitica] },
      // S02 · PR 2: el cierre del mes del banco vive aquí, junto al de la contabilidad (bancos/cierre lleva aquí).
      { id: 'cierre', etiqueta: 'Cierre y Registro', icono: 'cierre', ruta: `${R.libros}/cierre/ejercicios`, prefijos: [`${R.libros}/cierre`, `${R.libros}/anuales`, `${R.bancos}/cierre`] },
      { id: 'importar', etiqueta: 'Importar', icono: 'importar', ruta: R.pendientesDiez, prefijos: [R.pendientesDiez], solo: 'diez' },
    ],
  },
  {
    // V01 (Julio, 24/10) · Ventas sustituye a Facturación: Facturas (luego
    // Presupuestos y Cobros) y, solo si vende en hostelería, Cierres del día y
    // Liquidaciones (entregas 2 y 3). Solo sale lo que funciona. El id sigue
    // siendo 'facturacion' (el interruptor, los favoritos y las preferencias
    // guardadas lo usan).
    // S01 · PR 2 (menú limpio): Series sale del menú hasta que tenga pantalla;
    // vuelve con el S05 del plan.
    id: 'facturacion', etiqueta: 'Ventas', icono: 'facturacion', ruta: R.facturasVenta, prefijos: [], grupo: 'finanzas',
    pestanas: [
      { id: 'emitidas', etiqueta: 'Facturas', icono: 'facturas', ruta: R.facturasVenta, prefijos: [R.facturasVenta, R.facturasEmitidas] },
      // PC01 · E3 · Cobros (tableros cobros-1 y cobros-2): lo que te deben, las remesas de recibos y los devueltos.
      { id: 'cobros', etiqueta: 'Cobros', icono: 'cobros', ruta: R.cobros, prefijos: [R.cobros] },
      // V02 · Pantallas (tableros 28 y 29): Liquidaciones es de todos (lo que te
      // pagan quienes cobran por ti: plataformas, el datáfono, Amazon, Stripe…),
      // encima del bloque «Hostelería». La ficha de la del socio de marca (y la de
      // subir sus documentos) sigue en compras/liquidacion/….
      {
        id: 'liquidacionesVentas', etiqueta: 'Liquidaciones', icono: 'liquidaciones', ruta: R.liquidacionesVentas,
        prefijos: [R.liquidacionesVentas, `${R.compras}/liquidacion`],
      },
      // V01 · Entrega 2: el bloque «Hostelería», solo con «Vendo en hostelería».
      // «Ventas» a secas (lo de antes) lleva aquí.
      { id: 'cierres', etiqueta: 'Cierres del día', icono: 'cierre', ruta: R.cierres, prefijos: [R.cierres, R.ventas], solo: 'hosteleria', bloque: 'Hostelería' },
    ],
  },
  {
    // S02 · Facturas recibidas · Pagos · Repartidores. S01 · PR 2 (menú limpio):
    // Tickets sale del menú hasta que tenga pantalla; vuelve con el S07 del plan.
    // «Por revisar» (las recepciones de Cocina que esperan factura, compras/) cuelga de
    // Facturas recibidas: es de donde salen esas facturas.
    id: 'compras', etiqueta: 'Compras y gastos', icono: 'compras', ruta: R.documentos, prefijos: [], grupo: 'finanzas',
    pestanas: [
      { id: 'recibidas', etiqueta: 'Facturas recibidas', icono: 'recibida', ruta: R.documentos, prefijos: [R.documentos, R.compras] },
      // PC01 · E2 · Pagos (tableros 15 y 16): la lista, sus remesas y la ficha de una.
      { id: 'pagos', etiqueta: 'Pagos', icono: 'pagos', ruta: R.pagos, prefijos: [R.pagos] },
      // S02 · PR 3: las quincenas de Catcher (y la ficha de una). V01 · Entrega 3: las
      // de plataforma y las mensuales de los socios de marca, en Ventas › Liquidaciones.
      // PC01 · E2 (Julio, 26/10): se llama «Repartidores» (la quincena de los riders), para
      // no confundirse con Ventas › Liquidaciones; la dirección de antes redirige.
      {
        id: 'liquidaciones', etiqueta: 'Repartidores', icono: 'liquidaciones', ruta: R.repartidores,
        prefijos: [R.repartidores, R.liquidaciones, `${R.documentos}/catcher`], solo: 'hosteleria',
      },
    ],
  },
  {
    id: 'bancos', etiqueta: 'Bancos', icono: 'bancos', ruta: R.bancos, prefijos: [], grupo: 'finanzas',
    pestanas: [
      { id: 'movimientos', etiqueta: 'Movimientos', icono: 'movimientos', ruta: R.bancos, prefijos: [R.bancos] },
      { id: 'prestamos', etiqueta: 'Préstamos y aplazamientos', icono: 'cuentasBanco', ruta: `${R.bancos}/prestamos`, prefijos: [`${R.bancos}/prestamos`] },
      { id: 'cuentas', etiqueta: 'Cuentas y extractos', icono: 'cuentasBanco', ruta: `${R.bancos}/cuentas`, prefijos: [`${R.bancos}/cuentas`] },
      { id: 'reglas', etiqueta: 'Reglas', icono: 'reglas', ruta: `${R.bancos}/reglas`, prefijos: [`${R.bancos}/reglas`] },
    ],
  },
  {
    // LS1 (28/10/2026) · Laboral: todo lo de Folvy › Personal que vale para
    // cualquier empresa, con «centro» en vez de «local» y sin hostelería; y lo
    // que aún no existe, a la vista con «Llega en …» (Julio, 28/10).
    id: 'laboral', etiqueta: 'Laboral', icono: 'laboral', ruta: R.laboral, prefijos: [], interruptor: 'conta_laboral', grupo: 'personas',
    pestanas: [
      lab('equipo', 'Equipo', 'usuarios', ''),
      lab('ahora', 'Ahora mismo', 'vigilancia', 'ahora-mismo'),
      lab('revisar', 'Para revisar', 'revisar', 'para-revisar'),
      lab('control', 'Control horario', 'fecha', 'control-horario', 'Tiempo'),
      lab('registro', 'Registro de jornada', 'listados', 'registro-jornada', 'Tiempo'),
      lab('bolsa', 'Bolsa de horas', 'tesoreria', 'bolsa-horas', 'Tiempo'),
      lab('recordatorios', 'Recordatorios de fichaje', 'avisos', 'recordatorios-fichaje', 'Tiempo'),
      lab('kiosko', 'Fichar en una tablet', 'digitalizar', 'kiosko', 'Tiempo'),
      lab('cuadrante', 'Cuadrante', 'fecha', 'calendario', 'Turnos'),
      lab('turnosTipo', 'Turnos tipo', 'plantillas', 'plantilla-turnos', 'Turnos'),
      lab('disponibilidad', 'Disponibilidad', 'ok', 'disponibilidad', 'Turnos'),
      lab('abiertos', 'Turnos abiertos', 'nuevo', 'turnos-abiertos', 'Turnos'),
      lab('cambios', 'Cambios de turno', 'recurrentes', 'cambios', 'Turnos'),
      lab('plantilla', 'Horas y contrato', 'graficas', 'plantilla', 'Turnos'),
      lab('ausencias', 'Vacaciones y ausencias', 'fecha', 'solicitudes', 'Personas'),
      lab('formacion', 'Formación', 'certificados', 'formacion', 'Personas'),
      lab('nominas', 'Nóminas de la gestoría', 'facturas', 'nominas', 'Personas'),
      lab('centros', 'Centros de trabajo', 'empresa', 'centros', 'Personas'),
      lab('portal', 'Portal del empleado', 'clientes', 'portal', 'Personas'),
      lab('importar', 'Importar historial', 'importar', 'importar-historial', 'Personas'),
      llega('contrato', 'Contrato y convenio', 'documento', 'noviembre'),
      llega('nominasSumied', 'Nóminas calculadas por Sumied', 'facturas', 'enero'),
      llega('seguros', 'Seguros sociales', 'certificados', 'febrero'),
      llega('sepe', 'SEPE', 'presentados', 'febrero'),
    ],
  },
  // I01b · Impuestos, con su interruptor por cuenta. El IVA de un periodo (impuestos/iva/…)
  // cuelga del Calendario. Sus páginas pasan a Calendario · Declaraciones · Certificados en el PR 3 del S02.
  {
    id: 'impuestos', etiqueta: 'Impuestos', icono: 'impuestos', ruta: R.impuestos, prefijos: [], interruptor: 'conta_impuestos', grupo: 'finanzas',
    pestanas: [
      { id: 'calendario', etiqueta: 'Calendario', icono: 'fecha', ruta: R.impuestos, prefijos: [R.impuestos] },
      { id: 'trimestre', etiqueta: 'Trimestre', icono: 'trimestre', ruta: `${R.impuestos}/trimestre`, prefijos: [`${R.impuestos}/trimestre`, `${R.impuestos}/empresa`] },
      { id: 'presentados', etiqueta: 'Presentados', icono: 'presentados', ruta: `${R.impuestos}/presentados`, prefijos: [`${R.impuestos}/presentados`] },
      { id: 'sociedades', etiqueta: 'Impuesto de sociedades', icono: 'empresa', ruta: `${R.impuestos}/sociedades`, prefijos: [`${R.impuestos}/sociedades`] },
      { id: 'certificados', etiqueta: 'Certificados', icono: 'certificados', ruta: `${R.impuestos}/certificados`, prefijos: [`${R.impuestos}/certificados`] },
    ],
  },
  {
    id: 'contactos', etiqueta: 'Contactos', icono: 'contactos', ruta: R.terceros, prefijos: [], grupo: 'operaciones',
    pestanas: [
      // Plataformas y Socios de marca, solo con hostelería (en otra empresa siguen en «Todos»:
      // ninguna fila se esconde, regla 7).
      { id: 'todos', etiqueta: 'Todos', icono: 'contactos', ruta: R.terceros, prefijos: [R.terceros] },
      { id: 'clientes', etiqueta: 'Clientes', icono: 'clientes', ruta: `${R.terceros}?ver=clientes`, prefijos: [R.terceros], ver: 'clientes' },
      { id: 'proveedores', etiqueta: 'Proveedores', icono: 'proveedores', ruta: `${R.terceros}?ver=proveedores`, prefijos: [R.terceros], ver: 'proveedores' },
      { id: 'plataformas', etiqueta: 'Plataformas', icono: 'plataformas', ruta: `${R.terceros}?ver=plataformas`, prefijos: [R.terceros], ver: 'plataformas', solo: 'hosteleria' },
      { id: 'socios', etiqueta: 'Socios de marca', icono: 'socios', ruta: `${R.terceros}?ver=socios`, prefijos: [R.terceros], ver: 'socios', solo: 'hosteleria' },
    ],
  },
  // S02 · Ajustes es un apartado con sus páginas (las de su índice), abajo, con Favoritos.
  { id: 'ajustes', etiqueta: 'Ajustes', icono: 'ajustes', ruta: R.empresa, prefijos: [R.alta], abajo: true, pestanas: PAGINAS_AJUSTES },
]

const cumple = (c: Condicion | undefined, ctx: Contexto) => !c || (c === 'hosteleria' ? ctx.hosteleria : c === 'diez' ? ctx.diez : ctx.asesoria === true)

/** Las páginas que salen: con pantalla y, si piden algo de la empresa, que lo tenga. */
/**
 * S01 · PR 2 (menú limpio): las pestañas SIN pantalla (`ruta: null`) de los
 * apartados que se pueden pintar (los que tienen pantalla). Tiene que estar
 * vacía: lo que no tiene pantalla no está en el menú (sale cuando la tenga).
 * Un apartado entero sin pantalla (Laboral, de L) no se pinta: sus pestañas no
 * cuentan.
 */
export function pestanasSinPantalla(lista: readonly Producto[] = PRODUCTOS): string[] {
  return lista.filter((p) => p.ruta !== null).flatMap((p) => p.pestanas.filter((t) => t.ruta === null).map((t) => `${p.etiqueta} › ${t.etiqueta}`))
}

export function pestanasVisibles(p: Producto, ctx: Contexto): Pestana[] {
  return p.pestanas.filter((t) => t.ruta !== null && cumple(t.solo, ctx) && !(t.hueco && ctx.solo))
}

/** ¿Sale el apartado? Con pantalla, si lleva interruptor encendido, y si pide algo de la cuenta, que lo tenga. */
export function productoVisible(p: Producto, ctx: Contexto): boolean {
  if (p.ruta === null) return false
  if (p.interruptor && !ctx.interruptores.has(p.interruptor)) return false
  return cumple(p.solo, ctx)
}

export function productosVisibles(ctx: Contexto, lista: Producto[] = PRODUCTOS): Producto[] {
  return lista.filter((p) => productoVisible(p, ctx))
}

/** «/conta/libros/diario?x» → «libros/diario». */
export function relativa(pathname: string): string {
  const sin = pathname.split(/[?#]/)[0].replace(/^\/+/, '')
  const base = `${CONTA.modulo}`
  if (sin === base) return ''
  return sin.startsWith(`${base}/`) ? sin.slice(base.length + 1).replace(/\/+$/, '') : sin.replace(/\/+$/, '')
}

const casa = (rel: string, prefijo: string) => rel === prefijo || rel.startsWith(`${prefijo}/`)

/** Todos los prefijos de un apartado: los suyos y los de sus páginas. */
const prefijosDe = (p: Producto) => [...p.prefijos, ...p.pestanas.flatMap((t) => t.prefijos)]

/**
 * El apartado y la página de una dirección: los del prefijo más largo, mirando
 * TODAS las páginas (también las que no salen: una dirección de una página
 * oculta sigue siendo de su apartado, y la barra no marca ninguna).
 */
export function dondeEsta(pathname: string, lista: Producto[] = PRODUCTOS, search = ''): { producto: Producto; pestana: Pestana | null } | null {
  const rel = relativa(pathname)
  // Una página con `ver` solo vale si la dirección lo pide, y entonces gana a la de serie
  // del mismo prefijo (en la ficha, sin `ver`, se marca la de serie).
  const ver = new URLSearchParams(search).get('ver')
  let mejor: { producto: Producto; pestana: Pestana | null; largo: number } | null = null
  for (const producto of lista) {
    for (const x of producto.prefijos) if (casa(rel, x) && (!mejor || x.length > mejor.largo)) mejor = { producto, pestana: null, largo: x.length }
    for (const pestana of producto.pestanas) for (const x of pestana.prefijos) {
      if (!casa(rel, x)) continue
      if (pestana.ver && (pestana.ver !== ver || rel !== x)) continue
      const largo = x.length + (pestana.ver ? 0.5 : 0)
      if (!mejor || largo > mejor.largo) mejor = { producto, pestana, largo }
    }
  }
  return mejor ? { producto: mejor.producto, pestana: mejor.pestana } : null
}

export const productoDe = (pathname: string): Producto | null => dondeEsta(pathname)?.producto ?? null

/** Todas las direcciones que son de algún apartado (las prueba la unitaria contra CONTA.rutas). */
export const TODOS_LOS_PREFIJOS = PRODUCTOS.flatMap(prefijosDe)
