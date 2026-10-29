// tests/unit/modules/conta/s01/esqueleto.test.ts
//
// S01 · El esqueleto sin pintar: de qué apartado y de qué página es cada
// dirección, qué sale según la empresa (hostelería, Diez) y la cuenta
// (interruptores), el catálogo de órdenes (las acciones de cada página y
// Favoritos) y las preferencias de la base. S02: el mapa del patrón único
// (tablero 0) y sin cinta: las acciones van con la regla del patrón
// (tests/unit/modules/conta/s02/marco.test.ts).
//
// Regla 31: la población es la real. Las direcciones son TODAS las de
// CONTA.rutas, con sus parámetros rellenos, y las áreas de Libros, todas las
// de AREAS_LIBROS. Si se añade una ruta y no se dice aquí de quién es, falla.

import { describe, expect, it } from 'vitest'
import { CONTA, rutaConta, rutaRecibidaEnAsientos, rutaRevisarFactura } from '@/config/navegacion'
import { AREAS_LIBROS } from '@/modules/conta/libros/navegacion'
import {
  INTERRUPTORES, PRODUCTOS, dondeEsta, pestanasVisibles, productosVisibles, relativa, type Contexto,
} from '@/modules/conta/esqueleto/productos'
import { CINTAS, ORDENES, alternarFavorito, cintaDe, conConsulta, esLaActual, favoritosDe, ordenPorId } from '@/modules/conta/esqueleto/ordenes'
import { DE_SERIE, aFila, claveDelNavegador, deFila, deNavegador } from '@/modules/conta/esqueleto/preferencias'
import { logoDe } from '@/modules/conta/cuenta/contratoCuenta'
import { MARCA } from '@/marca/marca'
import { mesCorto } from '@/modules/conta/lib/bancosVista'

const rellena = (r: string) => rutaConta(r, { apartado: 'x', tabla: 'x', entrada: 'impuestos', codigo: '40000002', partyId: 'p', supplierId: 's', entryId: 'e', area: 'mayor', accion: 'libro-mayor', liqId: 'l', clave: 'k', invoiceId: 'i', loteId: 'k', pestana: 'reglas', empresa: 'c', pagina: 'centros', que: 'contrato' })
const de = (path: string) => { const d = dondeEsta(path); return d ? (d.pestana ? `${d.producto.id}.${d.pestana.id}` : d.producto.id) : null }

const NADA: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }
const HOSTELERIA: Contexto = { ...NADA, hosteleria: true }
const CON_DIEZ: Contexto = { ...NADA, diez: true }

describe('cada dirección del módulo, en su producto y su pestaña', () => {
  // A mano, para cada ruta de CONTA.rutas (el inventario del paso 1, §1).
  const ESPERADO: Record<keyof typeof CONTA.rutas, string | null> = {
    inicio: 'inicio',
    // V02 · Inicio › Documentos: la puerta.
    puerta: 'inicio.documentos',
    // V02d · Qué esperas cada mes: una página de Documentos.
    queEsperas: 'inicio.documentos',
    // S02: las páginas de Ajustes son las de su índice (ajustes/impuestos es «Tus impuestos»).
    empresa: 'ajustes.empresa', empresaApartado: 'ajustes.empresa', ajustesEntrada: 'ajustes.impuestos', alta: 'ajustes',
    muestraPiezas: 'ajustes.empresa', sistemaDiseno: 'ajustes.empresa',
    tablas: 'contabilidad.definiciones', tabla: 'contabilidad.definiciones', analitica: 'contabilidad.definiciones',
    plan: 'contabilidad.definiciones', planSitio: 'contabilidad.definiciones', planCuenta: 'contabilidad.definiciones',
    mayor: 'contabilidad.listados',
    libroDiario: 'contabilidad.asientos', nuevoAsiento: 'contabilidad.asientos', asiento: 'contabilidad.asientos',
    libros: 'contabilidad.listados', diarioResumido: 'contabilidad.listados', librosArea: 'contabilidad.listados', librosAccion: 'contabilidad.listados',
    pendientesDiez: 'contabilidad.importar',
    terceros: 'contactos.todos', tercero: 'contactos.todos', terceroApartado: 'contactos.todos',
    comoTeFactura: 'contactos.todos', fichaProveedor: 'contactos.todos', fichaProveedorApartado: 'contactos.todos',
    // S02: las recepciones del local cuelgan de Facturas recibidas.
    compras: 'compras.recibidas', documentos: 'compras.recibidas', revisarFactura: 'compras.recibidas', recibidasEnAsientos: 'contabilidad.asientos', recibidaEnAsientos: 'contabilidad.asientos',
    // S02 · PR 2: las dos de arriba solo llevan a Compras (module.tsx); la recibida a mano y la emitida, en su sitio.
    recibidaAMano: 'compras.recibidas', facturasEmitidas: 'facturacion.emitidas', nuevaEmitida: 'facturacion.emitidas',
    // S02 · PR 3: la lista de liquidaciones, la ficha de una (y la de subir sus documentos) y la quincena de Catcher.
    // V01 · Entrega 3: la mensual del socio (y la de subir sus documentos) se marcan en Ventas › Liquidaciones.
    liquidaciones: 'compras.liquidaciones', liquidacionNueva: 'facturacion.liquidacionesVentas', liquidacion: 'facturacion.liquidacionesVentas', loteCatcher: 'compras.liquidaciones',
    bancos: 'bancos.movimientos', bancosPestana: 'bancos.reglas',
    impuestos: 'impuestos.calendario', impuestosPestana: 'impuestos.calendario', impuestoIva: 'impuestos.calendario',
    // LS1 · Laboral: Equipo, una pantalla por su nombre y lo que «Llega en …».
    laboral: 'laboral.equipo', laboralPagina: 'laboral.centros', laboralLlega: 'laboral.contrato',
    // I01c (19/10): el trimestre, también el de una empresa por la ruta.
    impuestoTrimestre: 'impuestos.trimestre', impuestoTrimestreEmpresa: 'impuestos.trimestre',
    // S02 · Los modelos del año (390, 190, 180, 347, 349): se llega desde el calendario.
    impuestoAnual: 'impuestos.calendario',
    // P01 · El trimestre de un cliente. S02: la cartera del asesor es su apartado, «Clientes del despacho».
    impuestosCliente: 'despacho',
    // La página de aceptar una invitación a la asesoría no es de ningún producto (va sin marco).
    aceptarAsesoria: null,
    // Ventas sobra (la sustituye Facturación): su dirección no es de ningún producto.
    // V01 · Entrega 2: «Ventas» a secas lleva a Cierres del día.
    ventas: 'facturacion.cierres',
    // V01 · Ventas › Facturas: la lista, una nueva y la ficha.
    facturasVenta: 'facturacion.emitidas', nuevaFacturaVenta: 'facturacion.emitidas', facturaVenta: 'facturacion.emitidas',
    cierres: 'facturacion.cierres', cierre: 'facturacion.cierres',
    // V01 · Entrega 3 · Ventas › Liquidaciones y la ficha de una fila de plataforma.
    liquidacionesVentas: 'facturacion.liquidacionesVentas', liquidacionPlataforma: 'facturacion.liquidacionesVentas',
    // PC01 · Entrega 2: Compras › Pagos (la lista, las remesas y la ficha de una) y «Repartidores», el nombre nuevo de Liquidaciones.
    repartidores: 'compras.liquidaciones', pagos: 'compras.pagos', remesasPagos: 'compras.pagos', remesaPagos: 'compras.pagos',
    // PC01 · Entrega 3: Ventas › Cobros (la lista, con sus remesas, y la ficha de una remesa de recibos).
    cobros: 'facturacion.cobros', remesaCobros: 'facturacion.cobros',
  }
  it('las de CONTA.rutas, todas, con lo suyo', () => {
    const rutas = Object.entries(CONTA.rutas) as [keyof typeof CONTA.rutas, string][]
    expect(rutas.length).toBe(Object.keys(ESPERADO).length)
    expect(rutas.filter(([k, r]) => de(rellena(r)) !== ESPERADO[k]).map(([k, r]) => `${k} (${r}) → ${de(rellena(r))}`)).toEqual([])
  })
  it('las seis áreas de Libros: Cierre y Cuentas anuales van a «Cierre y Registro»; las demás, a «Libros y listados»', () => {
    const por = Object.fromEntries(AREAS_LIBROS.map((a) => [a.id, de(`/conta/libros/${a.id}/${a.grupos[0].acciones[0].id}`)]))
    expect(por).toEqual({
      diario: 'contabilidad.asientos', mayor: 'contabilidad.listados', registro: 'contabilidad.listados',
      balances: 'contabilidad.listados', anuales: 'contabilidad.cierre', cierre: 'contabilidad.cierre',
    })
    // El diario a secas es Asientos; su resumido y lo de Diez, no.
    expect(de('/conta/libros/diario/resumido')).toBe('contabilidad.listados')
    expect(de('/conta/libros/diario/pendientes-diez')).toBe('contabilidad.importar')
  })
  it('lo de fuera del módulo y la portada no son de nadie; se casa por trozo entero', () => {
    expect(de('/conta')).toBeNull()
    expect(de('/kitchen/proveedores')).toBeNull()
    expect(de('/conta/ajustesx')).toBeNull()
  })
  it('relativa quita el módulo, la barra final, la búsqueda y el ancla', () => {
    expect(relativa('/conta/libros/diario/?ver=revisar#x')).toBe('libros/diario')
    expect(relativa('/conta')).toBe('')
  })
})

describe('qué sale: el esqueleto de Julio, sin nada vacío', () => {
  it('el orden de la barra (tablero 0): (Clientes del despacho) · Inicio · Contabilidad · Ventas (V01: antes Facturación) · Compras y gastos · Bancos · Laboral · Impuestos · Contactos · (abajo) Ajustes', () => {
    expect(PRODUCTOS.map((p) => p.etiqueta)).toEqual(['Clientes del despacho', 'Inicio', 'Contabilidad', 'Ventas', 'Compras y gastos', 'Bancos', 'Laboral', 'Impuestos', 'Contactos', 'Ajustes'])
    expect(PRODUCTOS.filter((p) => p.abajo).map((p) => p.id)).toEqual(['ajustes'])
  })
  it('S02 · «Clientes del despacho», arriba del todo, solo en una cuenta que es asesoría', () => {
    expect(productosVisibles(NADA).map((p) => p.id)).not.toContain('despacho')
    expect(productosVisibles({ ...NADA, asesoria: true }).map((p) => p.id)[0]).toBe('despacho')
    expect(de('/conta/impuestos/clientes')).toBe('despacho')
    expect(de('/conta/impuestos/clientes/abc')).toBe('despacho')
  })
  it('S02 · los grupos de la barra están previstos y no se pintan', () => {
    expect(PRODUCTOS.filter((p) => p.grupo).map((p) => [p.id, p.grupo])).toEqual([
      ['contabilidad', 'finanzas'], ['facturacion', 'finanzas'], ['compras', 'finanzas'], ['bancos', 'finanzas'],
      ['laboral', 'personas'], ['impuestos', 'finanzas'], ['contactos', 'operaciones'],
    ])
  })
  it('S02 · las páginas del mapa: Ventas (Facturas · Cobros · Liquidaciones · Cierres del día; Series, fuera hasta el S05) y Laboral (LS1)', () => {
    // V01 · Entrega 2: y, en su bloque «Hostelería», Cierres del día (solo con hostelería).
    // V02 · Pantallas (tableros 28 y 29): Liquidaciones es de todos (lo que te pagan quienes
    // cobran por ti), encima del bloque «Hostelería»; sin hostelería, sin plataformas.
    expect(PRODUCTOS.find((p) => p.id === 'facturacion')!.pestanas.map((t) => t.etiqueta)).toEqual(['Facturas', 'Cobros', 'Liquidaciones', 'Cierres del día'])
    expect(PRODUCTOS.find((p) => p.id === 'facturacion')!.pestanas.find((t) => t.id === 'cierres')).toMatchObject({ solo: 'hosteleria', bloque: 'Hostelería' })
    const liq = PRODUCTOS.find((p) => p.id === 'facturacion')!.pestanas.find((t) => t.id === 'liquidacionesVentas')!
    expect([liq.solo, liq.bloque]).toEqual([undefined, undefined])
    // LS1 (28/10): lo de Folvy › Personal que vale para cualquier empresa, y lo que llega después.
    expect(PRODUCTOS.find((p) => p.id === 'laboral')!.pestanas.map((t) => t.etiqueta)).toEqual([
      'Equipo', 'Ahora mismo', 'Para revisar',
      'Control horario', 'Registro de jornada', 'Bolsa de horas', 'Recordatorios de fichaje', 'Fichar en una tablet',
      'Cuadrante', 'Turnos tipo', 'Disponibilidad', 'Turnos abiertos', 'Cambios de turno', 'Horas y contrato',
      'Vacaciones y ausencias', 'Formación', 'Nóminas de la gestoría', 'Centros de trabajo', 'Portal del empleado',
      'Contrato y convenio', 'Nóminas calculadas por Sumied', 'Seguros sociales', 'SEPE',
    ])
  })
  // S02 · PR 2 (decisión 5 de Julio): la emitida pasa a Facturación › Facturas
  // emitidas y Facturación sale en la barra con ella, sin interruptor.
  it('Ventas (antes Facturación) sale (con Facturas, sin interruptor); Laboral (LS1) e Impuestos (I01b), solo con el suyo', () => {
    const todo: Contexto = { ...NADA, interruptores: new Set(INTERRUPTORES) }
    expect(productosVisibles(NADA).map((p) => p.id)).toEqual(['inicio', 'contabilidad', 'facturacion', 'compras', 'bancos', 'contactos', 'ajustes'])
    expect(productosVisibles(todo).map((p) => p.id)).toEqual(['inicio', 'contabilidad', 'facturacion', 'compras', 'bancos', 'laboral', 'impuestos', 'contactos', 'ajustes'])
    expect(productosVisibles({ ...NADA, interruptores: new Set(['conta_laboral']) }).map((p) => p.id)).toContain('laboral')
    expect(pestanasVisibles(PRODUCTOS.find((p) => p.id === 'facturacion')!, NADA).map((t) => t.id)).toEqual(['emitidas', 'cobros', 'liquidacionesVentas'])
    expect(productosVisibles({ ...NADA, interruptores: new Set(['conta_impuestos']) }).map((p) => p.id)).toContain('impuestos')
  })
  // I01b (18/10, capturas): «Certificados y accesos» no cabía en el hueco de «Más ▾» a 1440 px y
  // pisaba «Buscar»; la pestaña se llama «Certificados» y los mensajes dicen «Impuestos › Certificados».
  // I01c (19/10): «Trimestre» detrás del Calendario (maqueta_303_v2).
  it('Impuestos: Calendario, Trimestre, Presentados, Impuesto de sociedades y Certificados; el IVA de un periodo, del Calendario', () => {
    const i = PRODUCTOS.find((p) => p.id === 'impuestos')!
    expect(i.pestanas.map((t) => t.etiqueta)).toEqual(['Calendario', 'Trimestre', 'Presentados', 'Impuesto de sociedades', 'Certificados'])
    expect(de('/conta/impuestos/trimestre')).toBe('impuestos.trimestre')
    expect(de('/conta/impuestos/trimestre/2026/3T')).toBe('impuestos.trimestre')
    expect(de('/conta/impuestos/empresa/0b0b/trimestre/2026/3T')).toBe('impuestos.trimestre')
    expect(de('/conta/impuestos/iva/2026/3T')).toBe('impuestos.calendario')
    expect(de('/conta/impuestos/sociedades')).toBe('impuestos.sociedades')
    expect(pestanasVisibles(i, NADA).map((t) => t.id)).toEqual(['calendario', 'trimestre', 'presentados', 'sociedades', 'certificados'])
  })
  it('con pantalla, el interruptor decide (la prueba puede fallar)', () => {
    // S02 · PR 2: Facturación ya no lleva interruptor; se prueba con Laboral, dándole pantalla.
    const conPantalla = PRODUCTOS.map((p) => (p.id === 'laboral' ? { ...p, ruta: 'laboral' } : p))
    expect(productosVisibles(NADA, conPantalla).map((p) => p.id)).not.toContain('laboral')
    expect(productosVisibles({ ...NADA, interruptores: new Set(['conta_laboral']) }, conPantalla).map((p) => p.id)).toContain('laboral')
  })
  it('las pestañas de Contabilidad, y «Importar» solo con Diez', () => {
    const c = PRODUCTOS.find((p) => p.id === 'contabilidad')!
    expect(pestanasVisibles(c, NADA).map((t) => t.etiqueta)).toEqual(['Asientos', 'Libros y listados', 'Definiciones', 'Cierre y Registro'])
    expect(pestanasVisibles(c, CON_DIEZ).map((t) => t.etiqueta)).toEqual(['Asientos', 'Libros y listados', 'Definiciones', 'Cierre y Registro', 'Importar'])
  })
  it('PC01 · Compras y gastos: Facturas recibidas · Pagos · Repartidores; Repartidores solo con hostelería; Tickets, fuera hasta el S07', () => {
    const c = PRODUCTOS.find((p) => p.id === 'compras')!
    expect(c.pestanas.map((t) => t.etiqueta)).toEqual(['Facturas recibidas', 'Pagos', 'Repartidores'])
    expect(pestanasVisibles(c, NADA).map((t) => t.id)).toEqual(['recibidas', 'pagos'])
    expect(pestanasVisibles(c, HOSTELERIA).map((t) => t.id)).toEqual(['recibidas', 'pagos', 'liquidaciones'])
    expect(c.ruta).toBe(CONTA.rutas.documentos)
  })
  it('S02 · Bancos: Movimientos · Cuentas y extractos · Reglas (el cierre del mes, en Contabilidad › Cierre y Registro desde el PR 2)', () => {
    const b = PRODUCTOS.find((p) => p.id === 'bancos')!
    expect(b.pestanas.map((t) => t.etiqueta)).toEqual(['Movimientos', 'Cuentas y extractos', 'Reglas'])
    expect(de('/conta/bancos/cierre')).toBe('contabilidad.cierre')
  })
  it('S02 · Ajustes es un apartado con sus páginas (las de su índice), sin las de Definiciones; en el producto solo, sin las que dicen «aún no»', () => {
    const a = PRODUCTOS.find((p) => p.id === 'ajustes')!
    // V03 E2 (26/10): entra Facturación › Verifactu (tablero 25), con pantalla: sale también en el producto solo.
    // PC01 E4 (27/10): entra Facturación › Cobros (los recordatorios), con pantalla.
    expect(a.pestanas.map((t) => t.etiqueta)).toEqual(['Tu empresa', 'Tus impuestos', 'Socios y cargos', 'Ejercicio', 'Certificados y accesos', 'Verifactu', 'Cobros', 'Personas y asesor', 'Avisos', `Lo que ha hecho ${MARCA.nombre}`])
    expect(pestanasVisibles(a, { ...NADA, solo: true }).map((t) => t.id)).toEqual(['empresa', 'impuestos', 'socios', 'ejercicio', 'verifactu', 'cobros', 'folvy'])
    expect(de('/conta/ajustes')).toBe('ajustes.empresa')
    expect(de('/conta/ajustes/plan')).toBe('contabilidad.definiciones')
    expect(de('/conta/ajustes/tablas/numeracion')).toBe('contabilidad.definiciones')
  })
})

describe('el catálogo de órdenes', () => {
  it('ids únicos, y toda orden de una página existe', () => {
    expect(new Set(ORDENES.map((o) => o.id)).size).toBe(ORDENES.length)
    for (const grupos of Object.values(CINTAS)) for (const g of grupos) for (const id of g.ordenes) expect(ordenPorId(id), id).not.toBeNull()
  })
  it('cada orden lleva a una dirección de SU producto, sin excepciones', () => {
    const fuera = ORDENES.filter((o) => 'ruta' in o.a).filter((o) => dondeEsta(rutaConta(('ruta' in o.a ? o.a.ruta : '').split('?')[0]))?.producto.id !== o.producto)
    // S02 · PR 2: «Digitalizar», «Recibida» y «Recibida a mano» son de Compras y
    // gastos, y la emitida de Facturación: ya no hay ninguna que lleve fuera.
    expect(fuera.map((o) => o.id)).toEqual([])
    // Y la dirección de antes de la recibida en Asientos lleva a su ficha, en Compras.
    expect(rutaRecibidaEnAsientos('x')).toBe(rutaRevisarFactura('x'))
    expect(dondeEsta(rutaRecibidaEnAsientos('x'))?.pestana?.id).toBe('recibidas')
    expect(ORDENES.filter((o) => o.id.startsWith('ir.')).filter((o) => fuera.includes(o))).toEqual([])
  })
  it('las acciones de Asientos: Nuevo · Revisar (a dónde ir: «Ver») · Utilidades', () => {
    const c = cintaDe('contabilidad', 'asientos', NADA)
    expect(c.map((g) => [g.titulo, !!g.ver, g.ordenes.map((o) => o.etiqueta)])).toEqual([
      // S02 · PR 2: la emitida (Facturación) y las recibidas (Compras y gastos), fuera.
      ['Nuevo', false, ['Tesorería', 'General', 'Predefinidos']],
      ['Revisar', true, ['Para revisar', 'Libro diario']],
      ['Utilidades', false, ['Búsqueda']],
    ])
    expect(cintaDe('contabilidad', null, NADA)).toEqual([])
  })
  it('paso 3: las acciones de Libros, en la cinta de su pestaña; Importar (Diez), solo con Diez', () => {
    expect(cintaDe('contabilidad', 'listados', NADA).map((g) => [g.titulo, g.ordenes.length])).toEqual([['Diario', 1], ['Mayor', 3], ['Estados', 3], ['IVA', 6], ['Retenciones', 1]])
    expect(cintaDe('contabilidad', 'cierre', NADA).map((g) => [g.titulo, g.ordenes.map((o) => o.etiqueta)])).toEqual([
      ['Cierre', ['Ejercicios', 'Cerrar el mes', 'Regularización, cierre y apertura']],
      ['Cuentas anuales', ['Cuentas anuales del ejercicio', 'Qué cuentas alimentan cada línea']],
    ])
    expect(cintaDe('contabilidad', 'importar', NADA)).toEqual([])
    expect(cintaDe('contabilidad', 'importar', CON_DIEZ).map((g) => g.ordenes.map((o) => o.etiqueta))).toEqual([['Pendientes de adjuntar en Diez']])
  })
  it('regla 31, contra AREAS_LIBROS: cada acción con pantalla está en UNA cinta, y su orden lleva a su dirección de Libros', () => {
    const enCintas = Object.values(CINTAS).flatMap((gs) => gs.flatMap((g) => g.ordenes))
    const conPantalla = AREAS_LIBROS.flatMap((a) => a.grupos.flatMap((g) => g.acciones)).filter((x) => !x.c05b && !['libro-diario', 'balances-pdf', 'balances-excel'].includes(x.id))
    expect(conPantalla.length).toBe(20)   // diario 2 · mayor 3 · IVA 7 · estados 3 · cuentas anuales 2 · cierre 3
    for (const x of conPantalla) expect(enCintas.filter((id) => id === `libros.${x.id}`), x.id).toHaveLength(1)
    for (const x of conPantalla) {
      const o = ordenPorId(`libros.${x.id}`)!
      expect(de(rutaConta(('ruta' in o.a ? o.a.ruta : ''))), x.id).toBe(`contabilidad.${o.pestana}`)
    }
  })
  it('S02 · PR 2: Bancos pinta su encabezado (bancos/acciones.ts): el catálogo no le pone fila; sus órdenes siguen para el buscador y Favoritos', () => {
    for (const t of ['movimientos', 'reglas', 'cuentas', 'cierre']) expect(cintaDe('bancos', t, NADA), t).toEqual([])
    // Cada orden lleva a una dirección de Bancos que el esqueleto pone en su pestaña.
    for (const id of ['bancos.subir', 'bancos.reglas', 'bancos.casados', 'bancos.hecho']) {
      const o = ordenPorId(id)!
      expect(de(rutaConta(('ruta' in o.a ? o.a.ruta : '').split('?')[0])), id).toBe(`bancos.${o.pestana}`)
    }
  })
  it('S02 · Compras y gastos: UN «Subir factura», el de Facturas recibidas (regla 1 del patrón), que pone sus acciones en su encabezado', () => {
    const subir = ordenPorId('compras.subir')!
    expect(subir.etiqueta).toBe('Subir factura')
    expect('ruta' in subir.a && subir.a.ruta).toBe('documentos?subir=1')
    expect(subir.principal).toBe(true)
    expect(de(rutaConta('compras'))).toBe('compras.recibidas')
    expect(cintaDe('compras', 'recibidas', NADA)).toEqual([])
    // Liquidaciones no lleva cinta, y en una empresa sin hostelería ni sale la pestaña.
    expect(cintaDe('compras', 'liquidaciones', HOSTELERIA)).toEqual([])
  })
  it('paso 3: Contactos · los papeles son pestañas (?ver=); Plataformas y Socios, solo con hostelería; la ficha, en «Todos»', () => {
    const c = PRODUCTOS.find((p) => p.id === 'contactos')!
    expect(pestanasVisibles(c, NADA).map((t) => t.etiqueta)).toEqual(['Todos', 'Clientes', 'Proveedores'])
    expect(pestanasVisibles(c, HOSTELERIA).map((t) => t.etiqueta)).toEqual(['Todos', 'Clientes', 'Proveedores', 'Plataformas', 'Socios de marca'])
    const en = (path: string, search = '') => dondeEsta(path, undefined, search)?.pestana?.id
    expect(en('/conta/clientes-y-proveedores')).toBe('todos')
    expect(en('/conta/clientes-y-proveedores', '?ver=clientes')).toBe('clientes')
    expect(en('/conta/clientes-y-proveedores', '?ver=socios')).toBe('socios')
    expect(en('/conta/clientes-y-proveedores', '?ver=archivados')).toBe('todos')
    // Una ficha no es una vista de la lista, aunque la dirección traiga ?ver.
    expect(en('/conta/clientes-y-proveedores/abc', '?ver=clientes')).toBe('todos')
    // Lo de otros productos con ?ver no cambia (Bancos «Casados solos», el diario «Para revisar»).
    expect(en('/conta/bancos', '?ver=casados')).toBe('movimientos')
    expect(en('/conta/libros/diario', '?ver=revisar')).toBe('asientos')
    expect(cintaDe('contactos', 'clientes', NADA).map((g) => g.ordenes.map((o) => o.etiqueta))).toEqual([['Nuevo cliente', 'Nuevo proveedor']])
  })
  it('lo elegido viaja por la cinta (ejercicio, mes, banco) y la consulta de la orden manda', () => {
    expect(conConsulta('/conta/bancos/subir', '?banco=b1&mes=2026-10&ver=casados')).toBe('/conta/bancos/subir?mes=2026-10&banco=b1')
    expect(conConsulta('/conta/libros/diario?ver=revisar', '?ejercicio=2026')).toBe('/conta/libros/diario?ver=revisar&ejercicio=2026')
    expect(conConsulta('/conta/bancos?ver=casados', '?ver=otra')).toBe('/conta/bancos?ver=casados')
    expect(conConsulta('/conta/bancos', '')).toBe('/conta/bancos')
  })
  it('una orden por pestaña con pantalla, para fijarla', () => {
    expect(ordenPorId('ir.contabilidad.asientos')?.etiqueta).toBe('Contabilidad › Asientos')
    expect(ordenPorId('ir.inicio')?.etiqueta).toBe('Inicio')
    expect(ordenPorId('ir.compras.recurrentes')).toBeNull()
  })
  it('«Para revisar» es la actual con ?ver=revisar; «Libro diario», sin vista', () => {
    const revisar = ordenPorId('asiento.para-revisar')!, diario = ordenPorId('asiento.libro-diario')!
    expect(esLaActual(revisar, '/conta/libros/diario', '?ver=revisar&ejercicio=2026')).toBe(true)
    expect(esLaActual(diario, '/conta/libros/diario', '?ver=revisar')).toBe(false)
    expect(esLaActual(diario, '/conta/libros/diario', '?ejercicio=2026')).toBe(true)
    expect(esLaActual(ordenPorId('asiento.busqueda')!, '/conta/libros/diario', '')).toBe(false)
  })
})

describe('Favoritos', () => {
  it('fijar y quitar, sin repetidos y sin perder el orden', () => {
    expect(alternarFavorito(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(alternarFavorito(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })
  it('regla 7: lo que en esta empresa no se puede abrir sale, y lo dice; lo que ya no existe, también', () => {
    const f = favoritosDe(['ir.compras.liquidaciones', 'asiento.expedida', 'algo.viejo'], NADA)
    expect(f.map((x) => [x.id, x.orden?.etiqueta ?? null, x.disponible])).toEqual([
      ['ir.compras.liquidaciones', 'Compras y gastos › Repartidores', false],
      ['asiento.expedida', 'Nueva factura', true],
      ['algo.viejo', null, false],
    ])
    expect(favoritosDe(['ir.compras.liquidaciones'], HOSTELERIA)[0].disponible).toBe(true)
  })
})

describe('las preferencias (conta_user_pref)', () => {
  it('de serie: nivel medio, sin favoritos, cómoda (filas de 56 px, S02), barra con nombres', () => {
    expect(deFila(null)).toEqual(DE_SERIE)
    expect(DE_SERIE).toEqual({ nivel: 'medio', favoritos: [], cintaOculta: false, densidad: 'comoda', barraDesplegada: true, documentoOculto: false })
  })
  it('lo que no se entiende vale lo de serie; los favoritos, sin repetidos ni basura', () => {
    expect(deFila({ nivel: 'guru', favoritos: ['a', 'a', 3, '', 'b'], cinta_oculta: 'si', densidad: 'enorme' })).toEqual({ ...DE_SERIE, favoritos: ['a', 'b'] })
    expect(deFila({ nivel: 'experto', favoritos: ['x'], cinta_oculta: true, densidad: 'compacta', barra_desplegada: false, documento_oculto: true }))
      .toEqual({ nivel: 'experto', favoritos: ['x'], cintaOculta: true, densidad: 'compacta', barraDesplegada: false, documentoOculto: true })
  })
  it('a la base va solo lo que cambia, con sus nombres de columna', () => {
    expect(aFila({ nivel: 'experto' })).toEqual({ nivel: 'experto' })
    expect(aFila({ cintaOculta: true, favoritos: ['a'] })).toEqual({ cinta_oculta: true, favoritos: ['a'] })
  })
  it('lo que el M01 dejó en el navegador se trae la primera vez; lo roto, no', () => {
    const almacen = (v: string | null) => ({ getItem: (k: string) => (k === claveDelNavegador('u1') ? v : null) })
    expect(deNavegador('u1', almacen('{"densidad":"comoda","barraDesplegada":false,"documentoOculto":true}'))).toEqual({ densidad: 'comoda', barraDesplegada: false, documentoOculto: true })
    expect(deNavegador('u1', almacen('{"densidad":"enorme"'))).toEqual({})
    expect(deNavegador('u2', almacen('{"densidad":"comoda"}'))).toEqual({})
    expect(deNavegador('u1', null)).toEqual({})
  })
})

describe('el logo del cliente en la cabecera', () => {
  it('el de la cuenta, solo si es la activa', () => {
    expect(logoDe({ id: 'a', logo_url: 'https://x/l.png' }, 'a')).toBe('https://x/l.png')
    expect(logoDe({ id: 'a', logo_url: 'https://x/l.png' }, 'b')).toBeNull()
    expect(logoDe({ id: 'a', logo_url: '  ' }, 'a')).toBeNull()
    expect(logoDe(null, 'a')).toBeNull()
  })
})

describe('el mes corto de la cabecera (N30: «2026 · Oct»)', () => {
  it('tres letras y el año, para que quepan las pestañas', () => {
    expect(mesCorto('2026-10')).toBe('Oct 2026')
    expect(mesCorto('2026-09')).toBe('Sep 2026')
    expect(mesCorto('2027-01')).toBe('Ene 2027')
  })
})

describe('el logo de la empresa: lo que no vale se dice antes de subir', () => {
  it('PNG, JPG o WebP de hasta 1 MB', async () => {
    const { motivoLogoNoValido } = await import('@/modules/conta/services/esqueletoService')
    expect(motivoLogoNoValido({ type: 'image/png', size: 1024 * 1024 })).toBeNull()
    expect(motivoLogoNoValido({ type: 'image/webp', size: 10 })).toBeNull()
    expect(motivoLogoNoValido({ type: 'image/jpeg', size: 10 })).toBeNull()
    expect(motivoLogoNoValido({ type: 'image/svg+xml', size: 10 })).toBe('El logo tiene que ser PNG, JPG o WebP.')
    expect(motivoLogoNoValido({ type: 'text/plain', size: 4 })).toBe('El logo tiene que ser PNG, JPG o WebP.')
    expect(motivoLogoNoValido({ type: 'image/png', size: 1024 * 1024 * 2.5 })).toBe('El logo pesa 2,5 MB y caben hasta 1 MB.')
  })
})

describe('Definiciones › Analítica (0130): sin fila, apagado', () => {
  it('cada eje sale solo si está encendido, con el nombre que le da la empresa', async () => {
    const { analiticaDe } = await import('@/modules/conta/services/esqueletoService')
    expect(analiticaDe([])).toEqual({ local: null, marca: null })
    expect(analiticaDe([
      { eje: 'local', activo: true, nombre: 'Local', nombrePlural: 'Locales', updatedAt: null },
      { eje: 'marca', activo: false, nombre: 'Marca', nombrePlural: 'Marcas', updatedAt: null },
    ])).toEqual({ local: { nombre: 'Local', plural: 'Locales' }, marca: null })
    expect(analiticaDe([{ eje: 'marca', activo: true, nombre: 'Proyecto', nombrePlural: null, updatedAt: null }]))
      .toEqual({ local: null, marca: { nombre: 'Proyecto', plural: 'Proyectos' } })
  })
  it('la cinta de Definiciones: el plan, las nueve tablas y la analítica, y cada una lleva a su pestaña', () => {
    const c = cintaDe('contabilidad', 'definiciones', NADA)
    expect(c.map((g) => [g.titulo, g.ordenes.length])).toEqual([['Plan', 2], ['Tablas', 9], ['Analítica', 1]])
    for (const o of c.flatMap((g) => g.ordenes)) expect(de(rutaConta(('ruta' in o.a ? o.a.ruta : ''))), o.id).toBe('contabilidad.definiciones')
  })
})
