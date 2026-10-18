// tests/unit/modules/conta/s01/esqueleto.test.ts
//
// S01 · El esqueleto sin pintar: de qué producto y de qué pestaña es cada
// dirección, qué sale según la empresa (hostelería, Diez) y la cuenta
// (interruptores), el catálogo de órdenes (cinta y Favoritos) y las
// preferencias de la base.
//
// Regla 31: la población es la real. Las direcciones son TODAS las de
// CONTA.rutas, con sus parámetros rellenos, y las áreas de Libros, todas las
// de AREAS_LIBROS. Si se añade una ruta y no se dice aquí de quién es, falla.

import { describe, expect, it } from 'vitest'
import { CONTA, rutaConta } from '@/config/navegacion'
import { AREAS_LIBROS } from '@/modules/conta/libros/navegacion'
import {
  INTERRUPTORES, PRODUCTOS, cuantasCaben, dondeEsta, pestanasVisibles, productosVisibles, relativa, type Contexto,
} from '@/modules/conta/esqueleto/productos'
import { CINTAS, ORDENES, alternarFavorito, cintaDe, conConsulta, esLaActual, favoritosDe, ordenPorId } from '@/modules/conta/esqueleto/ordenes'
import { DE_SERIE, aFila, claveDelNavegador, deFila, deNavegador } from '@/modules/conta/esqueleto/preferencias'
import { logoDe } from '@/modules/conta/cuenta/contratoCuenta'
import { mesCorto } from '@/modules/conta/lib/bancosVista'

const rellena = (r: string) => rutaConta(r, { apartado: 'x', tabla: 'x', entrada: 'impuestos', codigo: '40000002', partyId: 'p', supplierId: 's', entryId: 'e', area: 'mayor', accion: 'libro-mayor', liqId: 'l', invoiceId: 'i', loteId: 'k', pestana: 'reglas' })
const de = (path: string) => { const d = dondeEsta(path); return d ? (d.pestana ? `${d.producto.id}.${d.pestana.id}` : d.producto.id) : null }

const NADA: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }
const HOSTELERIA: Contexto = { ...NADA, hosteleria: true }
const CON_DIEZ: Contexto = { ...NADA, diez: true }

describe('cada dirección del módulo, en su producto y su pestaña', () => {
  // A mano, para cada ruta de CONTA.rutas (el inventario del paso 1, §1).
  const ESPERADO: Record<keyof typeof CONTA.rutas, string | null> = {
    inicio: 'inicio',
    empresa: 'ajustes.empresa', empresaApartado: 'ajustes.empresa', ajustesEntrada: 'ajustes.empresa', alta: 'ajustes',
    muestraPiezas: 'ajustes.empresa', sistemaDiseno: 'ajustes.empresa',
    tablas: 'contabilidad.definiciones', tabla: 'contabilidad.definiciones', analitica: 'contabilidad.definiciones',
    plan: 'contabilidad.definiciones', planSitio: 'contabilidad.definiciones', planCuenta: 'contabilidad.definiciones',
    mayor: 'contabilidad.listados',
    libroDiario: 'contabilidad.asientos', nuevoAsiento: 'contabilidad.asientos', asiento: 'contabilidad.asientos',
    libros: 'contabilidad.listados', diarioResumido: 'contabilidad.listados', librosArea: 'contabilidad.listados', librosAccion: 'contabilidad.listados',
    pendientesDiez: 'contabilidad.importar',
    terceros: 'contactos.todos', tercero: 'contactos.todos', terceroApartado: 'contactos.todos',
    comoTeFactura: 'contactos.todos', fichaProveedor: 'contactos.todos', fichaProveedorApartado: 'contactos.todos',
    compras: 'compras.por-revisar', documentos: 'compras.recibidas', revisarFactura: 'compras.recibidas', recibidasEnAsientos: 'contabilidad.asientos', recibidaEnAsientos: 'contabilidad.asientos',
    liquidacionNueva: 'compras.liquidaciones', liquidacion: 'compras.liquidaciones', loteCatcher: 'compras.liquidaciones',
    bancos: 'bancos.movimientos', bancosPestana: 'bancos.reglas',
    impuestos: 'impuestos.calendario', impuestosPestana: 'impuestos.calendario', impuestoIva: 'impuestos.calendario',
    // La página de aceptar una invitación a la asesoría no es de ningún producto (va sin marco).
    aceptarAsesoria: null,
    // Ventas sobra (la sustituye Facturación): su dirección no es de ningún producto.
    ventas: null,
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
  it('el orden de la barra: Inicio · Contabilidad · Facturación · Compras y gastos · Bancos · Laboral · Impuestos · Contactos · (abajo) Ajustes', () => {
    expect(PRODUCTOS.map((p) => p.etiqueta)).toEqual(['Inicio', 'Contabilidad', 'Facturación', 'Compras y gastos', 'Bancos', 'Laboral', 'Impuestos', 'Contactos', 'Ajustes'])
    expect(PRODUCTOS.filter((p) => p.abajo).map((p) => p.id)).toEqual(['ajustes'])
  })
  it('Facturación y Laboral no salen: sin pantalla, ni con el interruptor encendido; Impuestos (I01b), solo con el suyo', () => {
    const todo: Contexto = { ...NADA, interruptores: new Set(INTERRUPTORES) }
    expect(productosVisibles(NADA).map((p) => p.id)).toEqual(['inicio', 'contabilidad', 'compras', 'bancos', 'contactos', 'ajustes'])
    expect(productosVisibles(todo).map((p) => p.id)).toEqual(['inicio', 'contabilidad', 'compras', 'bancos', 'impuestos', 'contactos', 'ajustes'])
    expect(productosVisibles({ ...NADA, interruptores: new Set(['conta_impuestos']) }).map((p) => p.id)).toContain('impuestos')
  })
  it('Impuestos: Calendario, Presentados, Impuesto de sociedades y Certificados y accesos; el IVA de un periodo, del Calendario', () => {
    const i = PRODUCTOS.find((p) => p.id === 'impuestos')!
    expect(i.pestanas.map((t) => t.etiqueta)).toEqual(['Calendario', 'Presentados', 'Impuesto de sociedades', 'Certificados y accesos'])
    expect(de('/conta/impuestos/iva/2026/3T')).toBe('impuestos.calendario')
    expect(de('/conta/impuestos/sociedades')).toBe('impuestos.sociedades')
    expect(pestanasVisibles(i, NADA).map((t) => t.id)).toEqual(['calendario', 'presentados', 'sociedades', 'certificados'])
  })
  it('con pantalla, el interruptor decide (la prueba puede fallar)', () => {
    const conPantalla = PRODUCTOS.map((p) => (p.id === 'facturacion' ? { ...p, ruta: 'facturacion' } : p))
    expect(productosVisibles(NADA, conPantalla).map((p) => p.id)).not.toContain('facturacion')
    expect(productosVisibles({ ...NADA, interruptores: new Set(['conta_facturacion']) }, conPantalla).map((p) => p.id)).toContain('facturacion')
  })
  it('las pestañas de Contabilidad, y «Importar» solo con Diez', () => {
    const c = PRODUCTOS.find((p) => p.id === 'contabilidad')!
    expect(pestanasVisibles(c, NADA).map((t) => t.etiqueta)).toEqual(['Asientos', 'Libros y listados', 'Definiciones', 'Cierre y Registro'])
    expect(pestanasVisibles(c, CON_DIEZ).map((t) => t.etiqueta)).toEqual(['Asientos', 'Libros y listados', 'Definiciones', 'Cierre y Registro', 'Importar'])
  })
  it('Compras y gastos: Por revisar y Facturas recibidas; Liquidaciones solo con hostelería; Recurrentes y Pagos, cuando tengan pantalla', () => {
    const c = PRODUCTOS.find((p) => p.id === 'compras')!
    expect(c.pestanas.map((t) => t.etiqueta)).toEqual(['Por revisar', 'Facturas recibidas', 'Recurrentes', 'Pagos', 'Liquidaciones'])
    expect(pestanasVisibles(c, NADA).map((t) => t.id)).toEqual(['por-revisar', 'recibidas'])
    expect(pestanasVisibles(c, HOSTELERIA).map((t) => t.id)).toEqual(['por-revisar', 'recibidas', 'liquidaciones'])
  })
  it('Bancos y Ajustes: las pestañas aprobadas; Bancos, en el móvil, por niveles (su portada)', () => {
    const b = PRODUCTOS.find((p) => p.id === 'bancos')!
    expect(b.pestanas.map((t) => t.etiqueta)).toEqual(['Movimientos', 'Reglas', 'Cuentas y extractos', 'Cierre del mes'])
    expect(b.portadaMovil).toBe(true)
    expect(PRODUCTOS.filter((p) => p.portadaMovil).map((p) => p.id)).toEqual(['bancos'])
    const a = PRODUCTOS.find((p) => p.id === 'ajustes')!
    expect(a.pestanas.map((t) => t.etiqueta)).toEqual(['Empresa', 'Usuarios', 'Registro de la IA'])
    expect(pestanasVisibles(a, NADA).map((t) => t.etiqueta)).toEqual(['Empresa', 'Registro de la IA'])
  })
})

describe('«Más ▾»: cuántas pestañas caben', () => {
  it('si caben todas, todas y sin «Más»', () => { expect(cuantasCaben([60, 80, 70], 300, 80, 4)).toBe(3) })
  it('si no, las que caben dejando sitio a «Más»', () => {
    expect(cuantasCaben([70, 120, 190, 90, 210, 70], 520, 80, 4)).toBe(3)   // 80 + 70 + 120 + 190 + 3 huecos = 472
    expect(cuantasCaben([200], 100, 80, 4)).toBe(0)
  })
})

describe('el catálogo de órdenes', () => {
  it('ids únicos, y toda orden de una cinta existe', () => {
    expect(new Set(ORDENES.map((o) => o.id)).size).toBe(ORDENES.length)
    for (const grupos of Object.values(CINTAS)) for (const g of grupos) for (const id of g.ordenes) expect(ordenPorId(id), id).not.toBeNull()
  })
  it('cada orden lleva a una dirección de SU producto, salvo «Digitalizar»', () => {
    const fuera = ORDENES.filter((o) => 'ruta' in o.a).filter((o) => dondeEsta(rutaConta(('ruta' in o.a ? o.a.ruta : '').split('?')[0]))?.producto.id !== o.producto)
    // Paso 3: «Recibida» abre la factura desde Contabilidad › Asientos (maqueta 3).
    // «Digitalizar» es subir un papel, y eso vive en Compras y gastos › Facturas recibidas.
    expect(fuera.map((o) => o.id)).toEqual(['asiento.digitalizar'])
    expect(dondeEsta(rutaConta(CONTA.rutas.recibidaEnAsientos, { invoiceId: 'x' }))?.pestana?.id).toBe('asientos')
    expect(ORDENES.filter((o) => o.id.startsWith('ir.')).filter((o) => fuera.includes(o))).toEqual([])
  })
  it('la cinta de Asientos, la de la maqueta 1: NUEVO · REVISAR · UTILIDADES', () => {
    const c = cintaDe('contabilidad', 'asientos', NADA)
    expect(c.map((g) => [g.titulo, g.ordenes.map((o) => o.etiqueta)])).toEqual([
      ['Nuevo', ['Expedida', 'Recibida', 'Recibida a mano', 'Tesorería', 'General', 'Predefinidos']],
      ['Revisar', ['Para revisar', 'Libro diario']],
      ['Utilidades', ['Búsqueda', 'Digitalizar']],
    ])
    expect(cintaDe('contabilidad', null, NADA)).toEqual([])
  })
  it('paso 3: las acciones de Libros, en la cinta de su pestaña; Importar (Diez), solo con Diez', () => {
    expect(cintaDe('contabilidad', 'listados', NADA).map((g) => [g.titulo, g.ordenes.length])).toEqual([['Diario', 1], ['Mayor', 3], ['Estados', 3], ['IVA', 7]])
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
  it('paso 3: la barra de Bancos es la cinta de sus cuatro pestañas; «Tus bancos» lo llena la pantalla', () => {
    for (const t of ['movimientos', 'reglas', 'cuentas', 'cierre']) {
      expect(cintaDe('bancos', t, NADA).map((g) => [g.titulo, g.dePantalla ?? null, g.ordenes.map((o) => o.etiqueta)]), t).toEqual([
        ['Tus bancos', 'bancos', []],
        ['Traer movimientos', null, ['Subir extracto']],
        ['Automático', null, ['Reglas', 'Casados solos']],
        ['Revisar', null, ['Lo que he hecho']],
      ])
    }
    // Cada orden lleva a una dirección de Bancos que el esqueleto pone en su pestaña.
    for (const id of ['bancos.subir', 'bancos.reglas', 'bancos.casados', 'bancos.hecho']) {
      const o = ordenPorId(id)!
      expect(de(rutaConta(('ruta' in o.a ? o.a.ruta : '').split('?')[0])), id).toBe(`bancos.${o.pestana}`)
    }
  })
  it('paso 3: Compras y gastos · «Subir factura» en Por revisar; la barra de la N22 en Facturas recibidas, puesta por la pantalla', () => {
    expect(cintaDe('compras', 'por-revisar', NADA).map((g) => [g.titulo, g.ordenes.map((o) => o.etiqueta)])).toEqual([['Nuevo', ['Subir factura']]])
    const subir = ordenPorId('compras.subir')!
    expect('ruta' in subir.a && subir.a.ruta).toBe('compras?subir=')
    expect(de(rutaConta('compras'))).toBe('compras.por-revisar')
    expect(cintaDe('compras', 'recibidas', NADA).map((g) => [g.titulo, g.dePantalla])).toEqual([['Traer', 'traer'], ['Esperadas', 'esperadas'], ['Leídas', 'leidas']])
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
      ['ir.compras.liquidaciones', 'Compras y gastos › Liquidaciones', false],
      ['asiento.expedida', 'Expedida', true],
      ['algo.viejo', null, false],
    ])
    expect(favoritosDe(['ir.compras.liquidaciones'], HOSTELERIA)[0].disponible).toBe(true)
  })
})

describe('las preferencias (conta_user_pref)', () => {
  it('de serie: nivel medio, sin favoritos, cinta a la vista, compacta, barra con nombres', () => {
    expect(deFila(null)).toEqual(DE_SERIE)
    expect(DE_SERIE).toEqual({ nivel: 'medio', favoritos: [], cintaOculta: false, densidad: 'compacta', barraDesplegada: true, documentoOculto: false })
  })
  it('lo que no se entiende vale lo de serie; los favoritos, sin repetidos ni basura', () => {
    expect(deFila({ nivel: 'guru', favoritos: ['a', 'a', 3, '', 'b'], cinta_oculta: 'si', densidad: 'enorme' })).toEqual({ ...DE_SERIE, favoritos: ['a', 'b'] })
    expect(deFila({ nivel: 'experto', favoritos: ['x'], cinta_oculta: true, densidad: 'comoda', barra_desplegada: false, documento_oculto: true }))
      .toEqual({ nivel: 'experto', favoritos: ['x'], cintaOculta: true, densidad: 'comoda', barraDesplegada: false, documentoOculto: true })
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
