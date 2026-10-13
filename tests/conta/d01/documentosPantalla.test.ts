// D01 · Tarea 6 · Lo que decide N22 (src/modules/conta/documentos/documentos.ts):
// la frase de la banda, los filtros (regla 7: «Todas» trae todas), el botón y el
// punto de cada fila, y la barra sin lo que no funciona. Las filas tienen la
// forma que devuelve conta_documentos_recibidos (0280), y la banda se mide
// contra la frase de la maqueta (docs/conta/maquetas/d01/N22Documentos.png).
import { describe, expect, it } from 'vitest'
import {
  banda, barra, boton, entendido, filtrar, limites, meses, nombreCanal, porDonde, punto, textos, verDe,
  type DatosDocumentos, type FilaDocumento,
} from '../../../src/modules/conta/documentos/documentos'
import { esCuentaConMarca, marcaDeLaPestana } from '../../../src/modules/conta/documentos/producto'

const fila = (o: Partial<FilaDocumento>): FilaDocumento => ({
  id: 'f', tipo: 'factura', estado: 'para_mirar', proveedor: { id: 'p', nombre: 'Proveedor Prueba' },
  numero: 'F-1', fecha: '2026-10-11', total: 10, canal: 'correo', confianza: 'probable', porque: null,
  entendido: null, recepcion: null, asiento: null, llego: '2026-10-11T08:14:00Z', ...o,
})

const datos = (o: Partial<DatosDocumentos> = {}, c: Partial<DatosDocumentos['cifras']> = {}): DatosDocumentos => ({
  desde: '2026-10-01', hasta: '2026-10-31', correo: { activo: false, direccion: null }, recibe_mercancia: false,
  filas: [], esperadas: [], ...o,
  cifras: { llegadas: 0, llegadas_por_canal: {}, apuntadas_solas: 0, apuntadas: 0, para_mirar: 0, por_aclarar: 0, esperadas_no_llegadas: 0, ...c },
})

describe('la banda de la IA', () => {
  it('dice la frase de la maqueta con sus cifras', () => {
    const d = datos({}, { llegadas: 38, apuntadas_solas: 31, para_mirar: 5, por_aclarar: 2 })
    expect(banda(d).titulo).toBe('Han llegado 38 facturas esta semana. 31 las he apuntado yo; te quedan 5 por mirar y 2 por aclarar.')
  })
  it('sin nada apuntado solo, empieza en mayúscula; una sola, en singular', () => {
    expect(banda(datos({}, { llegadas: 1, para_mirar: 1 })).titulo).toBe('Han llegado 1 factura esta semana. Te queda 1 por mirar.')
    expect(banda(datos({}, { llegadas: 1, apuntadas_solas: 1 })).titulo).toBe('Han llegado 1 factura esta semana. 1 la he apuntado yo; no te queda ninguna por mirar.')
  })
  it('sin llegadas ni pendientes no se inventa nada', () => {
    expect(banda(datos()).titulo).toBe('Esta semana no ha llegado ninguna factura. No te queda ninguna por mirar.')
    expect(banda(datos()).pedir).toBe(false)
  })
  it('dice qué falta (lo ya pedido no) y entonces ofrece pedirlas', () => {
    const d = datos({ esperadas: [
      { supplier_id: 'a', supplier_name: 'Inmobiliaria Prueba', label: 'Alquiler', periodo: '2026-10-01', ultima: '2026-09-02', pedida: null },
      { supplier_id: 'b', supplier_name: 'Luz Prueba', label: 'Luz', periodo: '2026-09-01', ultima: '2026-08-05', pedida: null },
      { supplier_id: 'c', supplier_name: 'Agua Prueba', label: null, periodo: '2026-09-01', ultima: null, pedida: '2026-10-10' },
    ] }, { esperadas_no_llegadas: 3 })
    const b = banda(d)
    expect(b.porque).toBe('Faltan las facturas de alquiler de octubre y luz de septiembre: el mes pasado ya habían llegado.')
    expect(b.pedir).toBe(true)
  })
})

describe('los filtros (regla 7)', () => {
  const filas = [
    fila({ id: '1', estado: 'para_mirar' }), fila({ id: '2', estado: 'por_aclarar' }),
    fila({ id: '3', estado: 'apuntada' }), fila({ id: '4', estado: 'repetida' }),
  ]
  it('«Todas» trae todas, también la repetida', () => {
    expect(filtrar(filas, 'todas').map((f) => f.id)).toEqual(['1', '2', '3', '4'])
  })
  it('cada filtro trae su estado y entre los cuatro no se pierde ninguna que no sea repetida', () => {
    expect(filtrar(filas, 'para-mirar').map((f) => f.id)).toEqual(['1'])
    expect(filtrar(filas, 'por-aclarar').map((f) => f.id)).toEqual(['2'])
    expect(filtrar(filas, 'apuntadas').map((f) => f.id)).toEqual(['3'])
  })
  it('un filtro desconocido en la dirección vuelve a «Para mirar»', () => {
    expect(verDe('cualquiera')).toBe('para-mirar')
    expect(verDe('todas')).toBe('todas')
    expect(verDe(null)).toBe('para-mirar')
  })
})

describe('cada fila', () => {
  it('las cuentas, siempre nombre · código, y con la recepción con la que casa', () => {
    const f = fila({ entendido: { cuenta: '60000000', nombre: 'Comida y bebida', origen: 'de su ficha' }, recepcion: { fecha: '2026-10-10', local: 'Norte' } })
    expect(entendido(f).titulo).toBe('Comida y bebida · 60000000 · casa con la recepción del 10/10')
  })
  it('sin emisor: «No reconozco el emisor» y su botón es el principal, «Decirlo yo»', () => {
    const f = fila({ proveedor: { id: null, nombre: null }, confianza: 'duda' })
    expect(entendido(f).titulo).toBe('No reconozco el emisor')
    expect(boton(f)).toEqual({ texto: 'Decirlo yo', principal: true })
    expect(punto(f)).toBe('gris')
  })
  it('un solo botón por fila, según su estado', () => {
    expect(boton(fila({ estado: 'para_mirar' })).texto).toBe('Mirar')
    expect(boton(fila({ estado: 'por_aclarar' })).texto).toBe('Aclarar')
    expect(boton(fila({ estado: 'apuntada' })).texto).toBe('Ver')
    expect(boton(fila({ tipo: 'llegada', estado: 'por_aclarar', proveedor: { id: null, nombre: null } })).texto).toBe('Ver')
  })
  it('el punto: verde apuntada, ámbar para mirar, gris lo que no se sabe', () => {
    expect(punto(fila({ estado: 'apuntada' }))).toBe('verde')
    expect(punto(fila({ estado: 'para_mirar', confianza: 'probable' }))).toBe('ambar')
    expect(punto(fila({ estado: 'repetida' }))).toBe('gris')
  })
  it('un documento que aún no es factura se nombra por su fichero', () => {
    expect(entendido(fila({ tipo: 'llegada', archivo: 'factura.pdf' })).titulo).toBe('«factura.pdf»')
  })
})

describe('la barra: lo que no funciona no se enseña', () => {
  it('sin correo encendido no hay «Por correo»; sin recibir mercancía, no hay «De Cocina»', () => {
    const ids = barra(datos(), { solo: false, producto: 'Folvy' })[0].entradas.map((e) => e.id)
    expect(ids).toEqual(['subir'])
  })
  it('con el correo encendido sale, sin enseñar la dirección entera', () => {
    const b = barra(datos({ correo: { activo: true, direccion: 'facturas.x1@entrada.prueba.test' } }), { solo: false, producto: 'Folvy' })
    expect(b[0].entradas[1]).toMatchObject({ id: 'correo', dato: 'facturas.x1@…' })
  })
  it('en una cuenta solo de contabilidad no sale Cocina aunque la empresa lo diga, ni la palabra Folvy', () => {
    const b = barra(datos({ recibe_mercancia: true }), { solo: true, producto: null })
    expect(b.flatMap((g) => g.entradas).map((e) => e.id)).not.toContain('cocina')
    expect(JSON.stringify(b)).not.toMatch(/Folvy|Cocina/)
  })
  it('con Cocina y sin ser solo de contabilidad, «De Cocina» sale', () => {
    const b = barra(datos({ recibe_mercancia: true }), { solo: false, producto: 'Folvy' })
    expect(b[0].entradas.map((e) => e.id)).toEqual(['subir', 'cocina'])
  })
})

describe('el producto', () => {
  it('con nombre, como la maqueta; vendido solo, en primera persona y sin nombre', () => {
    expect(textos('Folvy').hecho).toBe('Lo que ha hecho Folvy')
    expect(JSON.stringify(textos(null))).not.toMatch(/Folvy/)
    expect(textos(null).entendido).toBe('Lo que he entendido')
  })
  it('la marca de la pestaña: ?marca= fuera de producción, recordada, y nunca en folvy.app', () => {
    expect(marcaDeLaPestana('staging.example.test', '?marca=contabilidad', null)).toBe('contabilidad')
    expect(marcaDeLaPestana('staging.example.test', '', 'contabilidad')).toBe('contabilidad')
    expect(marcaDeLaPestana('staging.example.test', '?marca=folvy', 'contabilidad')).toBeNull()
    expect(marcaDeLaPestana('app.folvy.app', '?marca=contabilidad', 'contabilidad')).toBeNull()
    expect(esCuentaConMarca({ product_brand: 'contabilidad' })).toBe(true)
    expect(esCuentaConMarca({ product_brand: null })).toBe(false)
    expect(esCuentaConMarca(null)).toBe(false)
  })
})

describe('por dónde llegaron y los meses', () => {
  it('en el orden de la maqueta', () => {
    expect(porDonde({ subida: 5, correo: 24, cocina: 9 })).toBe('correo 24 · Cocina 9 · subidas 5')
    expect(porDonde({})).toBe('ninguna esta semana')
  })
  it('vendido solo, ni en las cifras ni en las filas sale la palabra Cocina', () => {
    expect(porDonde({ correo: 2, cocina: 3 }, true)).toBe('correo 2 · recepciones 3')
    expect(nombreCanal('cocina', true)).toBe('su recepción')
    expect(nombreCanal('cocina')).toBe('Cocina')
    expect(nombreCanal('correo', true)).toBe('Correo')
  })
  it('doce meses hacia atrás, cruzando el año', () => {
    const m = meses('2026-02-10')
    expect(m).toHaveLength(12)
    expect(m[0]).toEqual({ valor: '2026-02', nombre: 'Febrero 2026' })
    expect(m[2].valor).toBe('2025-12')
  })
  it('los límites de un mes, con febrero bisiesto', () => {
    expect(limites('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
    expect(limites('2026-10')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
  })
})
