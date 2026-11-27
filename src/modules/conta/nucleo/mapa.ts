// src/modules/conta/nucleo/mapa.ts
//
// K02 · El mapa del núcleo, como DATO (encargo K02; inventario K01 y
// decisiones 4 a 7 de Julio, 17/11). De aquí salen los módulos de la
// izquierda, las pestañas de la cinta y sus botones en grupos, el nombre de la
// pestaña de trabajo y dónde está cada dirección. Núcleo puro: se prueba sin
// React, y una prueba (tests/unit/modules/conta/k02/mapa.test.ts) comprueba que
// TODA pantalla de CONTA.rutas tiene sitio (regla 7).
//
//   · A la izquierda, los módulos: Contabilidad, Facturación, Impuestos,
//     Personal y Despacho (la maqueta, con su orden).
//   · Contabilidad lleva la cinta de la maqueta: Definiciones, Asientos,
//     Importaciones, Listados, Utilidades, Impuestos. Los demás módulos, su
//     propia cinta con sus páginas de hoy como grupos (decisión 6).
//   · Inicio es la primera pestaña de trabajo, fija (decisión 4): no va en la
//     cinta.
//   · Ajustes, Novedades y Favoritos, en el menú de la persona; «Tu empresa» y
//     «Ejercicio», además, en Definiciones › Empresa (decisión 5).
//   · Un botón sin pantalla detrás no sale (decisión 7): Amortización,
//     Duplicadas y Borrado no están; «Apertura» lleva a donde está hoy.
//
// Un botón puede salir en más de un sitio (`atajo`): Recibidas está en
// Contabilidad › Asientos (donde la pone la maqueta) y en Facturación ›
// Compras. Su sitio de verdad —el que se marca al entrar por la dirección— es
// el que no es atajo; un atajo se marca solo si la persona está en ese módulo.

import { CONTA, INDICE_AJUSTES } from '@/config/navegacion'
import { PRODUCTOS, cumple, type Condicion, type Contexto, type Interruptor } from '@/modules/conta/esqueleto/productos'
import type { IconoNucleo } from './iconos'

export type IdModulo = 'contabilidad' | 'facturacion' | 'impuestos' | 'personal' | 'despacho'

export interface Boton {
  id: string
  etiqueta: string
  icono: IconoNucleo
  /** A dónde lleva, relativa al módulo (con su consulta); o qué hace. */
  ruta: string | null
  accion?: 'buscar'
  /** Las direcciones que son suyas (gana la más larga). */
  prefijos: string[]
  solo?: Condicion
  interruptor?: Interruptor
  /** La clave de su contador (esqueleto/contadoresPestanas.ts), si lo lleva. */
  contador?: string
  /** El nombre de la pestaña de trabajo cuando está abierta su pantalla. */
  pestana?: string
  /** Solo fuera de producción (la muestra del diseño). */
  pruebas?: boolean
  /** Sale aquí, pero su sitio de verdad es otro. */
  atajo?: boolean
  /** Con `?ver=`: solo es suyo si la dirección lo pide (Contactos). */
  ver?: string
  /** «Llega en …» (Laboral): lo que aún no existe y dice cuándo. */
  llega?: string
}

export interface Grupo { titulo: string; botones: Boton[] }

export interface PestanaCinta {
  id: string
  etiqueta: string
  grupos: Grupo[]
  interruptor?: Interruptor
}

export interface Modulo {
  id: IdModulo
  etiqueta: string
  icono: IconoNucleo
  pestanas: PestanaCinta[]
  interruptor?: Interruptor
  /** Sale si la empresa o la cuenta cumple ALGUNA (Despacho: asesoría o gestoría). */
  soloAlguna?: Condicion[]
}

const R = CONTA.rutas
const b = (id: string, etiqueta: string, icono: IconoNucleo, ruta: string, prefijos: string[] = [ruta.split('?')[0]], extra: Partial<Boton> = {}): Boton =>
  ({ id, etiqueta, icono, ruta, prefijos, ...extra })

// ── Los botones, una vez cada uno ───────────────────────────────────────

// N08: «Asientos», como en ERP10, abre la introducción de asientos (la ficha del asiento); se marca también en el diario y en cada asiento.
const ASIENTOS = b('asientos', 'Asientos', 'asientos', R.nuevoAsiento, [R.nuevoAsiento, R.libroDiario], { contador: 'contabilidad.asientos', pestana: 'Asiento' })
const EMITIDAS = b('emitidas', 'Emitidas', 'emitidas', R.facturasVenta, [R.facturasVenta], { pestana: 'Facturas emitidas' })
// K05 · En la cinta de Asientos, «Emitidas» es la ficha (ERP10, «Introducción de facturas expedidas»): la primera por revisar o una a mano.
// En Facturación sigue siendo la lista (EMITIDAS).
const EMITIDAS_ASIENTOS = b('emitidas', 'Emitidas', 'emitidas', R.emitidasPorRevisar, [R.facturasVenta], { pestana: 'Facturas emitidas' })
// «Ventas» a secas (lo de antes) lleva aquí, como en la barra de hoy.
// R05 (decisión 9): con hostelería o con «ventas por día» encendido, como Cierres del día en la barra de hoy.
const VENTAS_DIA = b('ventasDia', 'Ventas del día', 'ventasDia', R.cierres, [R.cierres, R.ventas], { solo: 'ventas_por_dia', pestana: 'Ventas del día' })
const RECIBIDAS = b('recibidas', 'Recibidas', 'recibidas', R.documentos, [R.documentos], { contador: 'compras.recibidas', pestana: 'Facturas recibidas' })
// X29 · Julio (23/11): «Conciliar» (la Gestión de extractos bancarios de ERP10), la primera; la Introducción de asientos
// por tesorería del X28 se llama «Asiento manual».
const CONCILIAR = b('conciliar', 'Conciliar', 'bancos', `${R.bancos}/conciliar`, [`${R.bancos}/conciliar`], { contador: 'bancos.movimientos', pestana: 'Conciliar' })
const BANCOS = b('bancos', 'Asiento manual', 'asientos', R.bancos, [R.bancos], { pestana: 'Asiento manual' })
// Decisión 8: sin número hasta que haya una marca de verdad de lo hecho solo.
const HECHO = b('hecho', 'Hecho por Sumied', 'hecho', `${R.bancos}/hecho`, [`${R.bancos}/hecho`], { pestana: 'Hecho por Sumied' })
const CIERRE = b('cierre', 'Cierre', 'cierre', `${R.libros}/cierre/cierre-ejercicio`, [`${R.libros}/cierre/cierre-ejercicio`], { pestana: 'Cierre y apertura' })
// Decisión 7: «Apertura» lleva a donde está hoy (Regularización, cierre y apertura).
const APERTURA = b('apertura', 'Apertura', 'apertura', `${R.libros}/cierre/cierre-ejercicio`, [], { pestana: 'Cierre y apertura' })

const TU_EMPRESA = b('empresa', 'Tu empresa', 'empresa', 'ajustes/empresa', [R.empresa, 'ajustes/empresa'], { pestana: 'Tu empresa' })
const EJERCICIO = b('ejercicio', 'Ejercicio', 'ejercicio', 'ajustes/ejercicio', ['ajustes/ejercicio'], { pestana: 'Ejercicio' })
const PLAN = b('plan', 'Plan contable', 'plan', R.plan, [R.plan], { pestana: 'Plan contable' })
const SITIO = b('sitio', 'Qué va a cada sitio', 'plan', R.planSitio, [R.planSitio], { pestana: 'Qué va a cada sitio' })
const TABLAS = b('tablas', 'Tablas generales', 'tablas', R.tablas, [R.tablas], { pestana: 'Tablas generales' })
const ANALITICA = b('analitica', 'Analítica', 'analitica', R.analitica, [R.analitica], { pestana: 'Analítica' })
const TERCEROS = b('terceros', 'Clientes y proveedores', 'terceros', R.terceros, [R.terceros], { contador: 'contactos.todos', pestana: 'Clientes y proveedores' })
const CLIENTES = b('clientes', 'Clientes', 'clientes', `${R.terceros}?ver=clientes`, [R.terceros], { ver: 'clientes', pestana: 'Clientes' })
const PROVEEDORES = b('proveedores', 'Proveedores', 'proveedores', `${R.terceros}?ver=proveedores`, [R.terceros], { ver: 'proveedores', pestana: 'Proveedores' })
const PLATAFORMAS = b('plataformas', 'Plataformas', 'plataformas', `${R.terceros}?ver=plataformas`, [R.terceros], { ver: 'plataformas', solo: 'hosteleria', pestana: 'Plataformas' })
const SOCIOS = b('socios', 'Socios de marca', 'clientes', `${R.terceros}?ver=socios`, [R.terceros], { ver: 'socios', solo: 'hosteleria', pestana: 'Socios de marca' })

const DOCUMENTOS = b('documentos', 'Documentos', 'documentos', R.puerta, [R.puerta], { pestana: 'Documentos' })
const ESPERAS = b('esperas', 'Qué esperas cada mes', 'esperas', R.queEsperas, [R.queEsperas], { pestana: 'Qué esperas cada mes' })
const EXTRACTO = b('extracto', 'Traer el extracto', 'extracto', `${R.bancos}/subir`, [`${R.bancos}/subir`], { pestana: 'Traer el extracto' })
// N09a · ERP10, como su «Importación desde fichero»: traer de ERP10 (N07) y la salida a ERP10 (X04). Las
// dos direcciones son de estos botones, no del Diario ni del Cierre: al entrar por la dirección se marca
// su botón. La salida, solo con la salida encendida en la empresa (la misma condición que en Libros).
const TRAER_ERP10 = b('traerErp10', 'Traer de ERP10', 'traerErp10', R.traerErp10, [R.traerErp10], { pestana: 'Traer de ERP10' })
const SALIDA_ERP10 = b('salidaErp10', 'Salida a ERP10', 'salidaErp10', `${R.libros}/cierre/salida-erp10`, [`${R.libros}/cierre/salida-erp10`], { solo: 'erp10', pestana: 'Salida a ERP10' })
const DIEZ = b('diez', 'Pendientes de Diez', 'diez', R.pendientesDiez, [R.pendientesDiez], { solo: 'diez', pestana: 'Pendientes de Diez' })

const lib = (area: string, accion: string) => `${R.libros}/${area}/${accion}`
// Q06 · Los nombres de la cinta de Listados, los de la maqueta nucleo_7 y ERP10: Diario, Mayor, Sumas y saldos,
// Libro de emitidas, Libro de recibidas, Retenciones, Balance y Pérdidas y ganancias. El diario, en su pestaña de
// trabajo, sigue llamándose «Diario resumido» (Julio, 20/11: el botón dice «Diario» y la pestaña lo que es).
const RESUMIDO = b('resumido', 'Diario', 'diario', R.diarioResumido, [R.diarioResumido, lib('diario', 'diario-resumido')], { pestana: 'Diario resumido' })
// El índice de Libros (libros a secas) y la cuenta del plan (plan/:codigo) son del Mayor.
const MAYOR = b('mayor', 'Mayor', 'mayor', lib('mayor', 'libro-mayor'), [R.libros, `${R.libros}/mayor`, lib('mayor', 'libro-mayor'), 'plan'], { pestana: 'Mayor' })
const SUMAS = b('sumas', 'Sumas y saldos', 'sumas', lib('mayor', 'sumas-saldos'), undefined, { pestana: 'Sumas y saldos' })
const ACUMULADOS = b('acumulados', 'Acumulados', 'acumulados', lib('mayor', 'acumulados'), undefined, { pestana: 'Acumulados' })
const BALANCE = b('balance', 'Balance', 'estados', lib('balances', 'balance'), [`${R.libros}/balances`, lib('balances', 'balance')], { pestana: 'Balance de situación' })
const PYG = b('pyg', 'Pérdidas y ganancias', 'estados', lib('balances', 'pyg'), undefined, { pestana: 'Pérdidas y ganancias' })
const ECPN = b('ecpn', 'Patrimonio neto', 'estados', lib('balances', 'ecpn'), undefined, { pestana: 'Cambios en el patrimonio neto' })
// Q06 · El libro de IVA en dos botones, como la maqueta (y ERP10: E-Facturas expedidas, R-Facturas recibidas).
// Lo demás del registro (intracomunitarias, bienes de inversión, suplidos), del de emitidas, como antes del de IVA.
const IVA = b('iva', 'Libro de emitidas', 'emitidas', lib('registro', 'expedidas'), [`${R.libros}/registro`], { pestana: 'Libro de emitidas' })
const IVA_RECIBIDAS = b('ivaRecibidas', 'Libro de recibidas', 'recibidas', lib('registro', 'recibidas'), undefined, { pestana: 'Libro de recibidas' })
const RETENCIONES = b('retenciones', 'Retenciones', 'retenciones', lib('registro', 'retenciones'), undefined, { pestana: 'Retenciones' })
const AEAT = b('aeat', 'Formato AEAT', 'aeat', lib('registro', 'formato-aeat'), undefined, { pestana: 'Formato AEAT' })
const ANUALES = b('anuales', 'Cuentas anuales', 'anuales', lib('anuales', 'cuentas-anuales'), [`${R.libros}/anuales`], { pestana: 'Cuentas anuales' })

const BUSCAR: Boton = { id: 'buscar', etiqueta: 'Búsqueda', icono: 'buscar', ruta: null, accion: 'buscar', prefijos: [] }
const EJERCICIOS = b('ejercicios', 'Ejercicios', 'ejercicio', lib('cierre', 'ejercicios'), [`${R.libros}/cierre`], { pestana: 'Ejercicios' })
// El cierre del mes del banco (bancos/cierre) lleva al de la contabilidad, como hoy.
const CERRAR_MES = b('cerrarMes', 'Cerrar el mes', 'cierre', lib('cierre', 'cerrar-mes'), [lib('cierre', 'cerrar-mes'), `${R.bancos}/cierre`], { pestana: 'Cerrar el mes' })
const CUENTAS_BANCO = b('cuentasBanco', 'Cuentas y extractos', 'bancos', `${R.bancos}/cuentas`, undefined, { pestana: 'Cuentas y extractos' })
const PRESTAMOS = b('prestamos', 'Préstamos', 'bancos', `${R.bancos}/prestamos`, undefined, { pestana: 'Préstamos y aplazamientos' })
const REGLAS = b('reglas', 'Reglas del banco', 'utilidades', `${R.bancos}/reglas`, undefined, { pestana: 'Reglas del banco' })
// E05 · La pestaña Tesorería de la maqueta nueva (respuesta E05 · 1): lo que hoy tiene Bancos y no
// cabe en la pantalla nueva abre la pantalla de hoy, cada uno en su pestaña. «Conciliados» es la
// lista de movimientos de hoy en «Ya casados» (bancos/movimientos: Bancos a secas es la nueva);
// «Conexión del banco» está hoy en Cuentas y extractos.
const CONCILIADOS = b('conciliados', 'Conciliados', 'hecho', `${R.bancos}/movimientos?ver=casados`, [`${R.bancos}/movimientos`], { pestana: 'Conciliados' })
const CONEXION: Boton = { ...CUENTAS_BANCO, id: 'conexion', etiqueta: 'Conexión del banco', atajo: true }
const DISENO = b('diseno', 'Muestra del diseño', 'diseno', R.sistemaDiseno, [R.sistemaDiseno], { pruebas: true, pestana: 'Muestra del diseño' })

const CALENDARIO = b('calendario', 'Calendario', 'calendario', R.impuestos, [R.impuestos], { contador: 'impuestos.calendario', pestana: 'Impuestos' })
const TRIMESTRE = b('trimestre', 'Trimestre', 'trimestre', `${R.impuestos}/trimestre`, [`${R.impuestos}/trimestre`, `${R.impuestos}/empresa`, `${R.impuestos}/iva`], { pestana: 'Trimestre' })
const PRESENTADOS = b('presentados', 'Presentados', 'presentados', `${R.impuestos}/presentados`, [`${R.impuestos}/presentados`, `${R.impuestos}/anual`], { contador: 'impuestos.presentados', pestana: 'Presentados' })
const SOCIEDADES = b('sociedades', 'Impuesto de sociedades', 'empresa', `${R.impuestos}/sociedades`, undefined, { pestana: 'Impuesto de sociedades' })
const CERTIFICADOS = b('certificados', 'Certificados', 'certificados', `${R.impuestos}/certificados`, undefined, { contador: 'impuestos.certificados', pestana: 'Certificados' })

const COBROS = b('cobros', 'Cobros', 'cobros', R.cobros, [R.cobros], { pestana: 'Cobros' })
const LIQUIDACIONES = b('liquidaciones', 'Liquidaciones', 'liquidaciones', R.liquidacionesVentas, [R.liquidacionesVentas, `${R.compras}/liquidacion`], { pestana: 'Liquidaciones' })
const MIRAR = b('mirar', 'Qué tienes que mirar', 'mirar', R.compras, [R.compras], { pestana: 'Compras' })
const PAGOS = b('pagos', 'Pagos', 'pagos', R.pagos, [R.pagos], { pestana: 'Pagos' })
const REPARTIDORES = b('repartidores', 'Repartidores', 'liquidaciones', R.repartidores, [R.repartidores, `${R.documentos}/catcher`], { solo: 'hosteleria', pestana: 'Repartidores' })

const DESPACHO = b('despacho', 'Clientes del despacho', 'despacho', `${R.impuestos}/clientes`, [`${R.impuestos}/clientes`], { solo: 'asesoria', pestana: 'Clientes del despacho' })
// X35 · El Inicio de «Clientes y cuotas»: el mes de un vistazo.
const INICIO_GESTORIA = b('inicioGestoria', 'El mes de un vistazo', 'clientes', R.inicioGestoria, [R.inicioGestoria], { solo: 'gestoria', pestana: 'Inicio' })
const CUOTAS = b('cuotas', 'Clientes y cuotas', 'clientes', R.clientesCuotas, [R.clientesCuotas], { solo: 'gestoria', pestana: 'Clientes y cuotas' })
const TARIFAS = b('tarifas', 'Tarifa y paquetes', 'liquidaciones', R.tarifasGestoria, [R.tarifasGestoria], { solo: 'gestoria', pestana: 'Tarifa y paquetes' })
// Q10 (25/11) · «Facturas del mes»: lo cobrado por GoCardless frente a la facturación de Cegid (antes, sin enlace aquí).
const FACTURAS_MES = b('facturasMes', 'Facturas del mes', 'facturacion', R.facturasCuotas, [R.facturasCuotas], { solo: 'gestoria', pestana: 'Facturas del mes' })

// R21 (27/11) · «Facturar el mes»: el asistente de cinco pasos.
const FACTURAR_MES = b('facturarMes', 'Facturar el mes', 'facturacion', R.facturarMes, [R.facturarMes], { solo: 'gestoria', pestana: 'Facturar el mes' })

const atajo = (x: Boton): Boton => ({ ...x, atajo: true })

/**
 * Personal: las páginas de Laboral de hoy (esqueleto/productos.ts, una sola
 * lista), en grupos por su bloque («Tiempo», «Turnos»…; las de arriba, «Equipo»).
 */
const LABORAL = PRODUCTOS.find((p) => p.id === 'laboral')?.pestanas ?? []
const ICONO_BLOQUE: Record<string, IconoNucleo> = { Equipo: 'personas', Tiempo: 'tiempo', Turnos: 'calendario', Personas: 'personas', 'Llega pronto': 'calendario' }
function gruposDeLaboral(): Grupo[] {
  const grupos: Grupo[] = []
  for (const t of LABORAL) {
    const titulo = t.bloque ?? 'Equipo'
    let g = grupos.find((x) => x.titulo === titulo)
    if (!g) { g = { titulo, botones: [] }; grupos.push(g) }
    // Equipo (laboral a secas) es también la ficha de una persona (laboral/persona/:id).
    const prefijos = t.ruta === R.laboral ? [R.laboral] : t.prefijos
    g.botones.push({ id: `laboral.${t.id}`, etiqueta: t.etiqueta, icono: ICONO_BLOQUE[titulo] ?? 'personas', ruta: t.ruta, prefijos, pestana: t.etiqueta, ...(t.llega ? { llega: t.llega } : {}) })
  }
  return grupos
}

export const MODULOS: Modulo[] = [
  {
    id: 'contabilidad', etiqueta: 'Contabilidad', icono: 'contabilidad',
    pestanas: [
      {
        id: 'definiciones', etiqueta: 'Definiciones', grupos: [
          { titulo: 'Empresa', botones: [TU_EMPRESA, EJERCICIO] },
          { titulo: 'Plan', botones: [PLAN, SITIO, TABLAS, ANALITICA] },
          { titulo: 'Terceros', botones: [TERCEROS, CLIENTES, PROVEEDORES, PLATAFORMAS, SOCIOS] },
        ],
      },
      {
        id: 'asientos', etiqueta: 'Asientos', grupos: [
          { titulo: 'Asientos', botones: [ASIENTOS, EMITIDAS_ASIENTOS, VENTAS_DIA, RECIBIDAS, HECHO] },
          { titulo: 'Cierre', botones: [CIERRE, APERTURA] },
        ],
      },
      {
        // E05 · Tesorería (la maqueta nueva de Bancos): Bancos vive aquí; lo demás son atajos a su sitio de siempre.
        id: 'tesoreria', etiqueta: 'Tesorería', grupos: [
          { titulo: 'Bancos', botones: [CONCILIAR, BANCOS, atajo(EXTRACTO), CONCILIADOS, atajo(REGLAS), CONEXION] },
        ],
      },
      {
        id: 'importaciones', etiqueta: 'Importaciones', grupos: [
          { titulo: 'Documentos', botones: [DOCUMENTOS, ESPERAS] },
          { titulo: 'Bancos', botones: [EXTRACTO] },
          { titulo: 'Diez', botones: [DIEZ] },
          { titulo: 'ERP10', botones: [TRAER_ERP10, SALIDA_ERP10] },
          // R08 · La quincena de Catcher, que se subía entrando por la dirección: su botón, aquí también.
          { titulo: 'Repartidores', botones: [atajo(REPARTIDORES)] },
        ],
      },
      {
        id: 'listados', etiqueta: 'Listados', grupos: [
          // Q06 · Los grupos de ERP10 (Diario, Generales, Libros registro, Estados contables) en el orden de la
          // maqueta nucleo_7. Acumulados, Formato AEAT, Patrimonio neto y Cuentas anuales tienen pantalla
          // detrás: siguen, al final de su grupo (regla 7).
          { titulo: 'Diario', botones: [RESUMIDO] },
          { titulo: 'Generales', botones: [MAYOR, SUMAS, ACUMULADOS] },
          { titulo: 'Libros registro', botones: [IVA, IVA_RECIBIDAS, RETENCIONES, AEAT] },
          { titulo: 'Estados contables', botones: [BALANCE, PYG, ECPN, ANUALES] },
        ],
      },
      {
        id: 'utilidades', etiqueta: 'Utilidades', grupos: [
          { titulo: 'Buscar', botones: [BUSCAR] },
          { titulo: 'Cierre', botones: [EJERCICIOS, CERRAR_MES] },
          { titulo: 'Bancos', botones: [CUENTAS_BANCO, PRESTAMOS, REGLAS] },
          { titulo: 'Diseño', botones: [DISENO] },
        ],
      },
      {
        id: 'impuestos', etiqueta: 'Impuestos', interruptor: 'conta_impuestos', grupos: [
          { titulo: 'Impuestos', botones: [CALENDARIO, TRIMESTRE, PRESENTADOS, SOCIEDADES, CERTIFICADOS].map(atajo) },
        ],
      },
    ],
  },
  {
    id: 'facturacion', etiqueta: 'Facturación', icono: 'facturacion',
    pestanas: [
      { id: 'ventas', etiqueta: 'Ventas', grupos: [{ titulo: 'Ventas', botones: [atajo(EMITIDAS), COBROS, LIQUIDACIONES, atajo(VENTAS_DIA)] }] },
      { id: 'compras', etiqueta: 'Compras', grupos: [{ titulo: 'Compras', botones: [atajo(RECIBIDAS), MIRAR, PAGOS, REPARTIDORES] }] },
    ],
  },
  {
    id: 'impuestos', etiqueta: 'Impuestos', icono: 'impuestos', interruptor: 'conta_impuestos',
    pestanas: [
      { id: 'impuestos', etiqueta: 'Impuestos', grupos: [{ titulo: 'Impuestos', botones: [CALENDARIO, TRIMESTRE, PRESENTADOS, SOCIEDADES, CERTIFICADOS] }] },
    ],
  },
  {
    id: 'personal', etiqueta: 'Personal', icono: 'personal', interruptor: 'conta_laboral',
    // Una pestaña por bloque de Laboral (Equipo, Tiempo, Turnos, Personas, Llega pronto): en una sola, sus 24 páginas no caben.
    pestanas: gruposDeLaboral().map((g) => ({ id: `laboral-${g.titulo.toLowerCase().replace(/\s+/g, '-')}`, etiqueta: g.titulo, grupos: [g] })),
  },
  {
    id: 'despacho', etiqueta: 'Despacho', icono: 'despacho', soloAlguna: ['asesoria', 'gestoria'],
    pestanas: [{ id: 'clientes', etiqueta: 'Clientes', grupos: [{ titulo: 'Asesoría', botones: [DESPACHO] }, { titulo: 'Gestoría', botones: [INICIO_GESTORIA, CUOTAS, FACTURAR_MES, FACTURAS_MES, TARIFAS] }] }],
  },
]

// ── El menú de la persona (decisión 5) ─────────────────────────────────

export interface EntradaPersona { id: string; etiqueta: string; ruta: string; prefijos: string[]; hueco?: boolean; solo?: Condicion }

/** Ajustes (las entradas de su índice, menos las que son de Definiciones) y Novedades. */
// K03 (respuesta K02 · 2, arreglo 2): Ajustes trae las MISMAS entradas que el apartado Ajustes de
// hoy (esqueleto/productos.ts, PAGINAS_AJUSTES): todas las del índice menos las que viven en
// Contabilidad › Definiciones desde el S02 (el plan, las tablas y la numeración). «Tu empresa» y
// «Ejercicio» están aquí Y en Definiciones › Empresa (decisión 5: además, no en vez de).
// «Certificados y accesos» es un hueco («llega…»): como hoy, no sale en el producto vendido solo.
// «Ventas por día» (R06), solo con su interruptor, como en el índice de hoy (la condición «tpv»).
const DE_DEFINICIONES = new Set(['plan', 'tablas', 'numeracion'])
export const MENU_PERSONA: EntradaPersona[] = [
  ...INDICE_AJUSTES.flatMap((g) => g.entradas)
    .filter((e) => !DE_DEFINICIONES.has(e.id))
    .map((e): EntradaPersona => ({ id: `ajustes.${e.id}`, etiqueta: e.etiqueta, ruta: e.ruta, prefijos: [e.ruta], hueco: !!e.hueco, ...(e.soloDemo ? { solo: 'demo' as const } : {}), ...(e.soloVentasPorDia ? { solo: 'tpv' as const } : {}) })),
  { id: 'novedades', etiqueta: 'Novedades', ruta: R.novedades, prefijos: [R.novedades] },
]

// ── Qué sale ─────────────────────────────────────────────────────────────

export interface Opciones { produccion?: boolean }

export function moduloVisible(m: Modulo, ctx: Contexto): boolean {
  if (m.interruptor && !ctx.interruptores.has(m.interruptor)) return false
  return !m.soloAlguna || m.soloAlguna.some((c) => cumple(c, ctx))
}

export function botonVisible(x: Boton, ctx: Contexto, o: Opciones = {}): boolean {
  if (x.pruebas && o.produccion) return false
  if (x.interruptor && !ctx.interruptores.has(x.interruptor)) return false
  return cumple(x.solo, ctx)
}

/** Las pestañas de la cinta de un módulo que salen, con sus grupos y botones ya filtrados; lo vacío, fuera. */
export function cintaVisible(m: Modulo, ctx: Contexto, o: Opciones = {}): PestanaCinta[] {
  return m.pestanas
    .filter((p) => !p.interruptor || ctx.interruptores.has(p.interruptor))
    .map((p) => ({ ...p, grupos: p.grupos.map((g) => ({ ...g, botones: g.botones.filter((x) => botonVisible(x, ctx, o)) })).filter((g) => g.botones.length > 0) }))
    .filter((p) => p.grupos.length > 0)
}

export const modulosVisibles = (ctx: Contexto): Modulo[] => MODULOS.filter((m) => moduloVisible(m, ctx))

export const menuPersonaVisible = (ctx: Contexto): EntradaPersona[] => MENU_PERSONA.filter((e) => cumple(e.solo, ctx) && !(e.hueco && ctx.solo))

// ── Dónde está una dirección ────────────────────────────────────────────

export type Sitio =
  | { tipo: 'inicio' }
  | { tipo: 'cinta'; modulo: Modulo; pestana: PestanaCinta; boton: Boton }
  | { tipo: 'persona'; entrada: EntradaPersona }

const casa = (rel: string, prefijo: string) => rel === prefijo || rel.startsWith(`${prefijo}/`)

/**
 * El sitio de una dirección relativa al módulo («documentos/recibidas/x»): el
 * del prefijo más largo, mirando TODOS los botones (también los que no salen:
 * una dirección es de su sitio aunque esta empresa no lo vea). Sin `modulo`,
 * los atajos no cuentan; con él, un atajo de ese módulo gana a su sitio de
 * verdad si es igual de largo (la persona se queda donde estaba).
 */
export function sitioDe(rel: string, search = '', modulo: IdModulo | null = null): Sitio | null {
  const limpia = rel.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '')
  if (limpia === '' || casa(limpia, R.inicio) && !casa(limpia, R.puerta)) return { tipo: 'inicio' }
  const ver = new URLSearchParams(search).get('ver')
  let mejor: { sitio: Sitio; largo: number } | null = null
  for (const m of MODULOS) {
    for (const p of m.pestanas) {
      for (const g of p.grupos) {
        for (const x of g.botones) {
          if (x.atajo && m.id !== modulo) continue
          for (const pre of x.prefijos) {
            if (!casa(limpia, pre)) continue
            if (x.ver && (x.ver !== ver || limpia !== pre)) continue
            const largo = pre.length + (x.ver ? 0.5 : 0) + (x.atajo ? 0.25 : 0)
            if (!mejor || largo > mejor.largo) mejor = { sitio: { tipo: 'cinta', modulo: m, pestana: p, boton: x }, largo }
          }
        }
      }
    }
  }
  for (const e of MENU_PERSONA) {
    for (const pre of e.prefijos) {
      if (casa(limpia, pre) && (!mejor || pre.length > mejor.largo)) mejor = { sitio: { tipo: 'persona', entrada: e }, largo: pre.length }
    }
  }
  return mejor?.sitio ?? null
}

/** El nombre de la pestaña de trabajo de una dirección. */
export function nombreDePestana(s: Sitio | null): string {
  if (!s) return 'Sumied'
  if (s.tipo === 'inicio') return 'Inicio'
  if (s.tipo === 'persona') return s.entrada.etiqueta
  return s.boton.pestana ?? s.boton.etiqueta
}

/** Todos los botones del mapa, una vez cada uno (sin atajos). */
export const TODOS_LOS_BOTONES: Boton[] = MODULOS.flatMap((m) => m.pestanas.flatMap((p) => p.grupos.flatMap((g) => g.botones.filter((x) => !x.atajo))))
