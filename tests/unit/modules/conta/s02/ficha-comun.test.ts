// tests/unit/modules/conta/s02/ficha-comun.test.ts
//
// Las dos piezas comunes de la ficha (encargo «Ficha de la recibida
// completa», puntos 2 y 7), sin pintar:
//   · «Cambios sin guardar»: comparar por valor, deshacer, la relectura que no
//     pisa lo tuyo, y lo que dicen la barra y el aviso al salir;
//   · el asiento «como un asiento de verdad»: el debe arriba, el haber debajo
//     y los totales.
// Regla 31: el asiento es el REAL de la COHELDI P26 4.980 (Foodint, recibida
// del 19/10, la que abrió Julio), no uno inventado; y la factura de la prueba
// de cambios es esa misma, con su vencimiento del 19/10 al 18/11 del tablero 3b.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AsientoQueSeCrea, TablaAsiento, type ColumnaAsiento } from '@/modules/conta/diseno/plantillas/Ficha'
import { columnasApuntes, lineasDeApuntes, textoIva, type LineaApunte } from '@/modules/conta/libro/apuntesAsiento'
import type { ApunteDiario } from '@/modules/conta/lib/diario'
import { BarraCambios, MarcaCambiado } from '@/modules/conta/diseno/plantillas/CambiosSinGuardar'
import {
  adoptar, contarCambios, cuentaCambios, formatoDeSerie, huella, igual, resumenCambios, textoSalir,
} from '@/modules/conta/diseno/plantillas/cambios'
import { centDeTexto, claveLineaAsiento, lineasEnOrden, ordenarAsiento, totalesAsiento, type LineaAsientoVista } from '@/modules/conta/diseno/plantillas/valores'

// La COHELDI P26 4.980 tal como la lee la ficha.
const COHELDI = {
  proveedor: 'COHELDI, S.L.',
  numero: 'P26 4.980',
  fecha: '19/10/2026',
  vence: '19/10/2026',
  formaPago: 'Transferencia',
  local: 'Foodint Alcalá',
  nota: null as string | null,
  iva: [{ base: 127.4, tipo: 4, cuota: 5.1 }, { base: 136.26, tipo: 10, cuota: 13.63 }],
}
type Ficha = typeof COHELDI
const ETIQUETAS: Partial<Record<keyof Ficha, string>> = {
  proveedor: 'Proveedor', numero: 'Nº de factura', fecha: 'Fecha de la factura', iva: 'Importes por tipo de IVA',
  local: 'Local', formaPago: 'Forma de pago', vence: 'Vence',
}

describe('cambios sin guardar: se compara por valor', () => {
  it('sin tocar nada no hay cambios, aunque las líneas de IVA sean otro objeto con lo mismo (y las claves en otro orden)', () => {
    const relectura = { ...COHELDI, iva: [{ tipo: 4, cuota: 5.1, base: 127.4 }, { cuota: 13.63, base: 136.26, tipo: 10 }] }
    expect(igual(COHELDI.iva, relectura.iva)).toBe(true)
    expect(contarCambios(COHELDI, relectura, ETIQUETAS)).toEqual([])
  })
  it('vacío es vacío: null, undefined y «» no son un cambio; un 0 sí es un valor', () => {
    expect(igual(null, '')).toBe(true)
    expect(igual(undefined, null)).toBe(true)
    expect(igual(0, null)).toBe(false)
    expect(contarCambios(COHELDI, { ...COHELDI, nota: '' }, ETIQUETAS)).toEqual([])
  })
  it('cambiar el vencimiento: un cambio, con su rótulo, cómo estaba y cómo está (el tablero 3b)', () => {
    const c = contarCambios(COHELDI, { ...COHELDI, vence: '18/11/2026' }, ETIQUETAS)
    expect(c).toEqual([{ campo: 'vence', etiqueta: 'Vence', antes: '19/10/2026', ahora: '18/11/2026' }])
    expect(cuentaCambios(c.length)).toBe('1 cambio sin guardar')
    expect(resumenCambios(c)).toBe('Vence: 19/10/2026 → 18/11/2026')
    expect(textoSalir(c, 'COHELDI P26 4.980')).toBe('Has cambiado Vence en COHELDI P26 4.980. Si sales ahora, ese cambio se pierde.')
  })
  it('una cuota de IVA cambiada es un cambio de las líneas; con su formato, se lee', () => {
    const iva = [COHELDI.iva[0], { ...COHELDI.iva[1], cuota: 13.62 }]
    const fmt = (campo: string, v: unknown) => campo === 'iva'
      ? (v as Ficha['iva']).map((l) => `${l.tipo} % ${l.cuota.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`).join(' + ')
      : formatoDeSerie(campo, v)
    const c = contarCambios(COHELDI, { ...COHELDI, iva }, ETIQUETAS, fmt)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ campo: 'iva', antes: '4 % 5,10 + 10 % 13,63', ahora: '4 % 5,10 + 10 % 13,62' })
  })
  it('varios cambios salen en el orden del formulario (el de las etiquetas), y la barra con más de dos dice solo cuáles', () => {
    const c = contarCambios(COHELDI, { ...COHELDI, vence: '18/11/2026', numero: 'P26 4980', local: 'Foodint Carabanchel' }, ETIQUETAS)
    expect(c.map((x) => x.etiqueta)).toEqual(['Nº de factura', 'Local', 'Vence'])
    expect(cuentaCambios(3)).toBe('3 cambios sin guardar')
    expect(resumenCambios(c)).toBe('Nº de factura, Local y Vence')
    expect(textoSalir(c, 'COHELDI P26 4.980')).toBe('Has cambiado Nº de factura, Local y Vence en COHELDI P26 4.980. Si sales ahora, esos 3 cambios se pierden.')
  })
  it('deshacer un campo es volver a su valor guardado: deja de contar', () => {
    const editado = { ...COHELDI, vence: '18/11/2026', local: 'Foodint Carabanchel' }
    const deshecho = { ...editado, vence: COHELDI.vence }
    expect(contarCambios(COHELDI, deshecho, ETIQUETAS).map((x) => x.campo)).toEqual(['local'])
  })
  it('la huella no depende del orden de las claves y distingue tipos', () => {
    expect(huella({ a: 1, b: [1, '2'] })).toBe(huella({ b: [1, '2'], a: 1 }))
    expect(huella('1')).not.toBe(huella(1))
  })
})

describe('cambios sin guardar: una relectura no pisa lo tuyo', () => {
  it('sin cambios, lo releído se adopta entero', () => {
    const nuevo = { ...COHELDI, formaPago: 'Domiciliación' }
    const r = adoptar(COHELDI, COHELDI, nuevo)
    expect(r.base).toBe(nuevo)
    expect(r.valor).toEqual(nuevo)
    expect(contarCambios(r.base, r.valor, ETIQUETAS)).toEqual([])
  })
  it('con cambios: lo que tocaste se queda; lo que no, toma lo nuevo; y «Antes» dice lo guardado ahora', () => {
    const tuyo = { ...COHELDI, vence: '18/11/2026' }
    const nuevo = { ...COHELDI, formaPago: 'Domiciliación', vence: '20/10/2026' }
    const r = adoptar(COHELDI, tuyo, nuevo)
    expect(r.valor.vence).toBe('18/11/2026')
    expect(r.valor.formaPago).toBe('Domiciliación')
    expect(contarCambios(r.base, r.valor, ETIQUETAS)).toEqual([{ campo: 'vence', etiqueta: 'Vence', antes: '20/10/2026', ahora: '18/11/2026' }])
  })
  it('si lo releído coincide con lo que escribiste, ya no es un cambio', () => {
    const tuyo = { ...COHELDI, vence: '18/11/2026' }
    const r = adoptar(COHELDI, tuyo, { ...COHELDI, vence: '18/11/2026' })
    expect(contarCambios(r.base, r.valor, ETIQUETAS)).toEqual([])
  })
})

// El asiento REAL de la COHELDI P26 4.980, desordenado a propósito: el haber
// delante, como puede llegar de quien lo arma.
const ASIENTO_COHELDI: LineaAsientoVista[] = [
  { codigo: '40000007', nombre: 'COHELDI, S.L.', debe: null, haber: '282,39' },
  { codigo: '60000000', nombre: 'Compras de mercaderías', debe: '263,66', haber: null },
  { codigo: '47200004', nombre: 'IVA soportado 4 %', debe: '5,10', haber: null },
  { codigo: '47200010', nombre: 'IVA soportado 10 %', debe: '13,63', haber: null },
]

describe('el asiento, como un asiento de verdad (la COHELDI P26 4.980)', () => {
  it('primero las líneas del debe, en su orden, y luego las del haber', () => {
    expect(ordenarAsiento(ASIENTO_COHELDI).map((l) => l.codigo)).toEqual(['60000000', '47200004', '47200010', '40000007'])
  })
  it('los totales: 282,39 al debe y 282,39 al haber; cuadra', () => {
    const t = totalesAsiento(ASIENTO_COHELDI)
    expect(t).toMatchObject({ debeCent: 28239, haberCent: 28239, cuadra: true, diferenciaCent: 0, debe: '282,39', haber: '282,39' })
  })
  it('con una cuota tocada a mano sin cuadrar: no cuadra, y dice la diferencia', () => {
    const tocado = ASIENTO_COHELDI.map((l) => (l.codigo === '47200010' ? { ...l, debe: '13,62', aMano: true } : l))
    const t = totalesAsiento(tocado)
    expect(t.cuadra).toBe(false)
    expect(t.diferenciaCent).toBe(-1)
    expect(t.diferencia).toMatch(/^0,01\s€$/)
    expect(ordenarAsiento(tocado).find((l) => l.aMano)?.codigo).toBe('47200010')
  })
  it('los importes se leen escritos como se escriben («1.234,56», con o sin «€»); vacío es 0; sin líneas, no cuadra', () => {
    expect(centDeTexto('1.234,56')).toBe(123456)
    expect(centDeTexto('263,66 €')).toBe(26366)
    expect(centDeTexto(null)).toBe(0)
    expect(totalesAsiento([]).cuadra).toBe(false)
  })
})

describe('pintado: la tabla del asiento, la barra y la marca', () => {
  const nada = () => undefined
  const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  it('el asiento: Cuenta · Nombre · Debe · Haber; el debe arriba; los totales en el pie con «Cuadra»; «Editar el asiento a mano»', () => {
    const html = renderToStaticMarkup(createElement(AsientoQueSeCrea, { lineas: ASIENTO_COHELDI, alEditar: nada }))
    const cabeza = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'))
    expect(texto(cabeza)).toBe('Cuenta Nombre Debe Haber')
    const cuerpo = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'))
    expect([...cuerpo.matchAll(/s-asiento-codigo">(\d+)</g)].map((m) => m[1])).toEqual(['60000000', '47200004', '47200010', '40000007'])
    const pie = html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'))
    expect(texto(pie)).toBe('Cuadra Totales 282,39 282,39')
    expect(html).toContain('Editar el asiento a mano')
    expect(html).not.toContain('No cuadra')
  })
  it('sin `alEditar` no hay «Editar el asiento a mano» (un botón que no hace nada no sale, regla 8)', () => {
    expect(renderToStaticMarkup(createElement(AsientoQueSeCrea, { lineas: ASIENTO_COHELDI }))).not.toContain('Editar el asiento a mano')
  })
  it('una línea tocada a mano lleva su marca, y el pie dice la diferencia', () => {
    const tocado = ASIENTO_COHELDI.map((l) => (l.codigo === '47200010' ? { ...l, debe: '13,62', aMano: true } : l))
    const html = renderToStaticMarkup(createElement(AsientoQueSeCrea, { lineas: tocado }))
    expect(html).toContain('Cambiado a mano')
    expect(texto(html)).toMatch(/No cuadra: diferencia 0,01\s€/)
  })
  it('la barra: «1 cambio sin guardar · Vence: 19/10/2026 → 18/11/2026», «Descartar» y «Guardar cambios» con Ctrl S', () => {
    const cambios = contarCambios(COHELDI, { ...COHELDI, vence: '18/11/2026' }, ETIQUETAS)
    const t = texto(renderToStaticMarkup(createElement(BarraCambios, { cambios, onDescartar: nada, onGuardar: nada })))
    expect(t).toContain('1 cambio sin guardar · Vence: 19/10/2026 → 18/11/2026')
    expect(t).toContain('Descartar')
    expect(t).toContain('Guardar cambios Ctrl S')
  })
  it('sin cambios, la barra no sale; con lo que pasó al guardar, lo dice (regla 8)', () => {
    expect(renderToStaticMarkup(createElement(BarraCambios, { cambios: [], onDescartar: nada, onGuardar: nada }))).toBe('')
    const html = renderToStaticMarkup(createElement(BarraCambios, { cambios: [], onDescartar: nada, onGuardar: nada, mensaje: { tono: 'ok', texto: 'Guardado: vence el 18/11/2026.' } }))
    expect(html).toContain('role="status"')
    expect(texto(html)).toBe('Guardado: vence el 18/11/2026.')
  })
  it('la marca: «Cambiado» y «Antes: 19/10/2026 · Deshacer»', () => {
    const [cambio] = contarCambios(COHELDI, { ...COHELDI, vence: '18/11/2026' }, ETIQUETAS)
    expect(texto(renderToStaticMarkup(createElement(MarcaCambiado, { cambio, onDeshacer: nada })))).toBe('Cambiado Antes: 19/10/2026 · Deshacer')
    expect(renderToStaticMarkup(createElement(MarcaCambiado, { cambio: null, onDeshacer: nada }))).toBe('')
  })
})

// ── La tabla común del asiento con sus opciones (Asientos › asiento abierto) ──
// El mismo asiento real de la COHELDI, ahora con la posición de cada apunte
// (el haber delante, como puede venir guardado) y lo que lleva cada línea.

type LineaCoheldi = LineaAsientoVista & { iva: string | null; local: string }
const COHELDI_CON_POSICION: LineaCoheldi[] = ASIENTO_COHELDI.map((l, i) => ({
  ...l, id: i + 1, local: COHELDI.local,
  iva: l.codigo === '47200004' ? '4 % sobre 127,40 €' : l.codigo === '47200010' ? '10 % sobre 136,26 €' : null,
}))
const COLUMNAS: ColumnaAsiento<LineaCoheldi>[] = [
  { id: 'local', titulo: 'Local', celda: (l) => l.local },
  { id: 'iva', titulo: 'IVA', celda: (l) => l.iva },
]

describe('la tabla común del asiento: orden y clave', () => {
  it('de serie, el debe arriba; con «posicion», tal como vino guardado (el haber de la 1 delante)', () => {
    expect(lineasEnOrden(COHELDI_CON_POSICION).map((l) => l.id)).toEqual([2, 3, 4, 1])
    expect(lineasEnOrden(COHELDI_CON_POSICION, 'posicion').map((l) => l.id)).toEqual([1, 2, 3, 4])
  })
  it('la clave de la fila es su id; sin él, su sitio', () => {
    expect(claveLineaAsiento(COHELDI_CON_POSICION[0], 0)).toBe('1')
    expect(claveLineaAsiento(ASIENTO_COHELDI[0], 0)).toBe('#0')
  })
})

describe('pintado: la tabla común del asiento con sus opciones', () => {
  const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const trozo = (html: string, tag: string) => html.slice(html.indexOf(`<${tag}>`), html.indexOf(`</${tag}>`))
  const pinta = (n: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, n))
  const codigos = (html: string) => [...trozo(html, 'tbody').matchAll(/s-asiento-codigo">(?:<a[^>]*>)?(\d+)</g)].map((m) => m[1])
  const accion = (l: LineaCoheldi) => createElement('button', { type: 'button' }, `Cambiar cuenta ${l.codigo}`)

  it('sin opciones, igual que siempre: Cuenta · Nombre · Debe · Haber (los usos de hoy no cambian)', () => {
    const html = pinta(createElement(TablaAsiento, { lineas: ASIENTO_COHELDI }))
    expect(texto(trozo(html, 'thead'))).toBe('Cuenta Nombre Debe Haber')
    expect(codigos(html)).toEqual(['60000000', '47200004', '47200010', '40000007'])
    expect(texto(trozo(html, 'tfoot'))).toBe('Cuadra Totales 282,39 282,39')
    expect(html).not.toContain('<a ')
  })
  it('con columnas y acciones: van entre Nombre y Debe, y la acción al final; el pie deja sus huecos y sigue cuadrando', () => {
    const html = pinta(createElement(TablaAsiento<LineaCoheldi>, { lineas: COHELDI_CON_POSICION, columnas: COLUMNAS, acciones: accion, tituloAcciones: 'Cambiar la cuenta' }))
    expect(texto(trozo(html, 'thead'))).toBe('Cuenta Nombre Local IVA Debe Haber Cambiar la cuenta')
    const filas = trozo(html, 'tbody').split('</tr>').filter((f) => f.includes('<td'))
    expect(texto(filas[1])).toBe('47200004 IVA soportado 4 % Foodint Alcalá 4 % sobre 127,40 € 5,10 Cambiar cuenta 47200004')
    expect(texto(filas[3])).toBe('40000007 COHELDI, S.L. Foodint Alcalá 282,39 Cambiar cuenta 40000007')
    expect(trozo(html, 'tfoot').match(/<td/g)).toHaveLength(7)
    expect(texto(trozo(html, 'tfoot'))).toBe('Cuadra Totales 282,39 282,39')
  })
  it('compacta (móvil): la tabla sigue en cuatro columnas; lo de más y la acción bajan debajo del nombre, con su título (lo vacío no sale)', () => {
    const html = pinta(createElement(TablaAsiento<LineaCoheldi>, { lineas: COHELDI_CON_POSICION, columnas: COLUMNAS, acciones: accion, compacta: true }))
    expect(texto(trozo(html, 'thead'))).toBe('Cuenta Nombre Debe Haber')
    const filas = trozo(html, 'tbody').split('</tr>').filter((f) => f.includes('<td'))
    expect(filas[0].match(/<td/g)).toHaveLength(4)
    expect(texto(filas[1])).toBe('47200004 IVA soportado 4 % Local Foodint Alcalá IVA 4 % sobre 127,40 € Cambiar cuenta 47200004 5,10')
    expect(texto(filas[3])).not.toContain('IVA')
  })
  it('el número de cuenta lleva a su mayor; lo de apoyo va debajo del nombre; «debajo» abre una fila a todo el ancho solo en su línea', () => {
    const html = pinta(createElement(TablaAsiento<LineaCoheldi>, {
      lineas: COHELDI_CON_POSICION, columnas: COLUMNAS, acciones: accion,
      enlaceCuenta: (l) => `/conta/libros/mayor/${l.codigo}`,
      apoyo: (l) => (l.codigo === '40000007' ? 'P26 4.980' : null),
      debajo: (l) => (l.id === 3 ? createElement('div', null, 'Busca por nombre o código') : null),
    }))
    expect(html).toContain('href="/conta/libros/mayor/60000000"')
    expect(codigos(html)).toEqual(['60000000', '47200004', '47200010', '40000007'])
    expect(html.match(/s-asiento-apoyo/g)).toHaveLength(1)
    const debajo = html.match(/<tr class="s-asiento-debajo" data-linea="3"><td colSpan="7">/)
    expect(debajo, 'la fila del buscador, debajo de la 47200010 y a lo ancho de las 7 columnas').not.toBeNull()
    expect(html.indexOf('s-asiento-debajo')).toBeGreaterThan(html.indexOf('data-linea="3"'))
    expect(html.match(/s-asiento-debajo/g)).toHaveLength(1)
  })
  it('AsientoQueSeCrea pasa las mismas opciones a su tabla', () => {
    const html = pinta(createElement(AsientoQueSeCrea<LineaCoheldi>, { lineas: COHELDI_CON_POSICION, columnas: COLUMNAS, orden: 'posicion' }))
    expect(texto(trozo(html, 'thead'))).toBe('Cuenta Nombre Local IVA Debe Haber')
    expect(codigos(html)).toEqual(['40000007', '60000000', '47200004', '47200010'])
  })
})

describe('los apuntes del libro en la tabla común (asiento abierto y libro desplegado)', () => {
  // Los apuntes de la COHELDI tal como los lee diarioService: IVA del libro de recibidas, en Foodint Alcalá.
  const apunte = (p: number, cuenta: string, nombre: string, debe: number, haber: number, iva: ApunteDiario['iva'] = null): ApunteDiario => ({
    posicion: p, cuentaId: `c${p}`, cuenta, nombreCuenta: nombre, tituloOficial: null, debe, haber, concepto: null,
    localId: 'alcala', local: COHELDI.local, comun: false, marcaId: null, marca: null, cedida: false, documento: null, iva, retencion: null, negativoEnDiez: null,
  })
  const APUNTES: ApunteDiario[] = [
    apunte(1, '40000007', 'COHELDI, S.L.', 0, 282.39),
    apunte(2, '60000000', 'Compras de mercaderías', 263.66, 0),
    apunte(3, '47200004', 'IVA soportado 4 %', 5.1, 0, { tipoId: 't4', base: 127.4, libro: 'received', tipo: 4 }),
    apunte(4, '47200010', 'IVA soportado 10 %', 13.63, 0, { tipoId: 't10', base: 136.26, libro: 'received', tipo: 10 }),
  ]
  it('cada apunte, con su posición de id y su importe en su lado', () => {
    const l = lineasDeApuntes(APUNTES)
    expect(l.map((x) => [x.id, x.codigo, x.debe, x.haber])).toEqual([[1, '40000007', null, '282,39'], [2, '60000000', '263,66', null], [3, '47200004', '5,10', null], [4, '47200010', '13,63', null]])
    expect(totalesAsiento(l).cuadra).toBe(true)
  })
  it('el IVA dice tipo, base y libro', () => {
    expect(textoIva(APUNTES[2].iva!)).toMatch(/^4 % sobre 127,40\s€ · libro de recibidas$/)
  })
  it('las columnas: Local con su eje encendido; sin marca en ninguna línea, sin columna Marca; IVA porque alguna lo lleva; sin retención', () => {
    expect(columnasApuntes(APUNTES, { local: true, marca: true }).map((c) => c.titulo)).toEqual(['Local', 'IVA'])
    expect(columnasApuntes(APUNTES, { local: false, marca: true }).map((c) => c.titulo)).toEqual(['IVA'])
    const cedida = APUNTES.map((x) => (x.posicion === 1 ? { ...x, marcaId: 'm', marca: 'Brasa Prestada', cedida: true } : x))
    const marca = columnasApuntes(cedida, { local: true, marca: true }).find((c) => c.id === 'marca')!
    const lineas: LineaApunte[] = lineasDeApuntes(cedida)
    expect(renderToStaticMarkup(createElement('div', null, marca.celda(lineas[0])))).toContain('Brasa Prestada · cedida')
    expect(renderToStaticMarkup(createElement('div', null, marca.celda(lineas[1])))).toBe('<div></div>')
  })
})
