// D01 · Tarea 6 · Lo que decide N22 (src/modules/conta/documentos/documentos.ts):
// la frase de la banda, los filtros (regla 7: «Todas» trae todas), el botón y el
// punto de cada fila, y la barra sin lo que no funciona. Las filas tienen la
// forma que devuelve conta_documentos_recibidos (0280), y la banda se mide
// contra la frase de la maqueta (docs/conta/maquetas/d01/N22Documentos.png).
import { describe, expect, it } from 'vitest'
import {
  banda, barra, boton, columnasDelApunte, comoLlego, entendido, filtrar, limites, lineaDiez, meses, nombreDelMes, porDonde, productoDeDocumentos, punto, textos,
  tonoDeLaFactura, vencimientoAEnsenar, verDe,
  type DatosDocumentos, type FilaDocumento,
} from '../../../src/modules/conta/documentos/documentos'
import { esCuentaSoloContabilidad } from '../../../src/modules/conta/cuenta/contratoCuenta'
import { hastaDondeHayTinta } from '../../../src/modules/conta/documentos/tinta'

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
    expect(banda(d).titulo).toBe('Han llegado 38 facturas en octubre. 31 las he apuntado yo; te quedan 5 por mirar y 2 por aclarar.')
  })
  it('sin nada apuntado solo, empieza en mayúscula; una sola, en singular', () => {
    expect(banda(datos({}, { llegadas: 1, para_mirar: 1 })).titulo).toBe('Ha llegado 1 factura en octubre. Te queda 1 por mirar.')
    expect(banda(datos({}, { llegadas: 1, apuntadas_solas: 1 })).titulo).toBe('Ha llegado 1 factura en octubre. 1 la he apuntado yo; no te queda ninguna por mirar.')
  })
  it('sin llegadas ni pendientes no se inventa nada', () => {
    expect(banda(datos()).titulo).toBe('En octubre no ha llegado ninguna factura. No te queda ninguna por mirar.')
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
    // S01g (regla 8): una llegada de «Por aclarar» ya no se abre solo para verla: «Leerla» (o «Subir el PDF» si le falta).
    expect(boton(fila({ tipo: 'llegada', estado: 'por_aclarar', proveedor: { id: null, nombre: null } })).texto).toBe('Leerla')
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
  it('vendido solo lo dice la C06: la cuenta solo de contabilidad (product_brand) no lleva nombre de producto', () => {
    // El puente de antes (documentos/producto.ts) se ha quitado al entrar la C06 en main:
    // lo decide useProductoSolo() = MARCA.soloContabilidad || useCuentaConta().soloContabilidad.
    expect(esCuentaSoloContabilidad({ product_brand: 'contabilidad' })).toBe(true)
    expect(esCuentaSoloContabilidad({ product_brand: null })).toBe(false)
    expect(esCuentaSoloContabilidad(null)).toBe(false)
    expect(productoDeDocumentos(esCuentaSoloContabilidad({ product_brand: 'contabilidad' }), 'Folvy')).toEqual({ solo: true, nombre: null })
    expect(productoDeDocumentos(esCuentaSoloContabilidad({ product_brand: null }), 'Folvy')).toEqual({ solo: false, nombre: 'Folvy' })
    expect(textos(productoDeDocumentos(true, 'Folvy').nombre)).toEqual(textos(null))
  })
})

describe('por dónde llegaron y los meses', () => {
  it('en el orden de la maqueta', () => {
    expect(porDonde({ subida: 5, correo: 24, cocina: 9 })).toBe('correo 24 · Cocina 9 · subidas 5')
    expect(porDonde({})).toBe('ninguna')
  })
  it('vendido solo, ni en las cifras ni en las filas sale la palabra Cocina', () => {
    expect(porDonde({ correo: 2, cocina: 3 }, true)).toBe('correo 2 · recepciones 3')
    expect(comoLlego('cocina', null, true)).toBe('de su recepción')
    expect(comoLlego('cocina', null)).toBe('de su recepción en Cocina')
    expect(porDonde({ compras: 3 }, true)).toBe('leídas 3')
    expect(comoLlego('compras', null, true)).not.toMatch(/Compras|Cocina/)
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

// D01 R5 · Lo que vio Julio en las capturas de la e2e 233, caso a caso.
describe('R5 · N22', () => {
  it('7 · por dónde llegó, en minúscula y lo que pasó de verdad (nunca «llegó por a mano» ni «llegó por Subida»)', () => {
    expect(comoLlego('correo', null)).toBe('llegó por correo')
    expect(comoLlego('a_mano', null)).toBe('escrita a mano')
    expect(comoLlego('subida', 'image/jpeg')).toBe('foto subida')
    expect(comoLlego('subida', 'application/pdf')).toBe('PDF subido')
    expect(comoLlego('subida', null)).toBe('subida')
    expect(comoLlego('compras', null)).toBe('leída en Compras')
    for (const c of ['correo', 'a_mano', 'subida', 'compras', 'cocina', 'portal']) {
      const t = comoLlego(c, null)
      expect(t, c).toBe(t.charAt(0).toLowerCase() + t.slice(1))
      expect(t, c).not.toMatch(/por a |por Subida|por Correo/)
    }
  })
  it('8 · la banda y la primera cifra hablan del mes elegido, no de «esta semana»', () => {
    const d = datos({ desde: '2026-09-01', hasta: '2026-09-30' }, { llegadas: 7, para_mirar: 5, por_aclarar: 2 })
    expect(banda(d).titulo).toBe('Han llegado 7 facturas en septiembre. Te quedan 5 por mirar y 2 por aclarar.')
    expect(banda(d).titulo).not.toMatch(/semana/)
    expect(nombreDelMes('2026-10-01')).toBe('octubre')
  })
  it('5 · la banda, ámbar si queda algo por mirar; verde cuando todo está apuntado', () => {
    expect(banda(datos({}, { llegadas: 7, para_mirar: 5 })).tono).toBe('ambar')
    expect(banda(datos({}, { llegadas: 3, apuntadas: 3, apuntadas_solas: 3 })).tono).toBe('verde')
  })
  it('6 · cada fila con su porqué y qué hacer: las tres que solo decían «Sin cuenta de gasto todavía»', () => {
    // SB y PL: sin cuenta, sin lectura, escritas a mano o subidas, primeras de su proveedor.
    const sb = fila({ canal: 'a_mano', confianza: null, porque: null, entendido: null, previas: 0, aprendido: { cuenta: null, facturas: 0, confianza: null, porque: 'No hay facturas anteriores…' } })
    expect(entendido(sb)).toEqual({ titulo: 'Sin cuenta de gasto todavía', porque: 'Es la primera factura de este proveedor: elige dónde se apunta y lo recuerdo.' })
    const otra = fila({ porque: null, entendido: null, previas: 2 })
    expect(entendido(otra).porque).toBe('Hay 2 facturas suyas anteriores, pero ninguna está apuntada: elige dónde se apunta y lo recuerdo.')
    expect(entendido(fila({ porque: null, entendido: null, previas: 1 })).porque).toBe('Hay una factura suya anterior, pero no está apuntada: elige dónde se apunta y lo recuerdo.')
    // LD: con su cuenta de la ficha, escrita a mano, sin lectura: por qué se mira.
    const ld = fila({ canal: 'a_mano', porque: null, entendido: { cuenta: '62100000', nombre: 'Arrendamientos y cánones', origen: 'de su ficha' } })
    expect(entendido(ld).porque).toBe('Va a su cuenta de siempre, la de su ficha. La escribieron a mano y no la he leído: comprueba los importes con la factura.')
    // La LD de staging (e2e 245): su cuenta sale del asiento ya propuesto, no de la ficha.
    const ldAsiento = fila({ canal: 'a_mano', porque: null, entendido: { cuenta: '62100000', nombre: 'Arrendamientos y cánones', origen: 'del asiento' } })
    expect(entendido(ldAsiento).porque).toBe('Va a la cuenta de su asiento, ya propuesto. La escribieron a mano y no la he leído: comprueba los importes con la factura.')
    // SE: con lectura y sin cuenta: lo leído y qué hacer.
    const se = fila({ porque: 'Trae todo lo que pide la norma y el total cuadra.', entendido: null, previas: 0 })
    expect(entendido(se).porque).toBe('Trae todo lo que pide la norma y el total cuadra. Es la primera factura de este proveedor: elige dónde se apunta y lo recuerdo.')
    // Lo aprendido, sin confirmar, con su porqué.
    const ap = fila({ porque: null, previas: 3, entendido: { cuenta: '62800000', nombre: 'Suministros', origen: 'aprendido de Diez', sin_confirmar: true },
      aprendido: { cuenta: '62800000', facturas: 3, confianza: 'seguro', porque: 'Las 3 facturas anteriores de este proveedor fueron a Suministros · 62800000.' } })
    expect(entendido(ap)).toEqual({ titulo: 'Suministros · 62800000 · sin confirmar', porque: 'Las 3 facturas anteriores de este proveedor fueron a Suministros · 62800000. Confírmalo y lo recuerdo.' })
    // Ninguna factura sin apuntar se queda sin porqué.
    for (const f of [sb, otra, ld, se, ap, fila({ porque: null, entendido: null })]) expect(entendido(f).porque, JSON.stringify(f)).toBeTruthy()
  })
})

describe('R5 · N23', () => {
  it('1 · el vencimiento de la factura manda; si su ficha da otro día, en ámbar', () => {
    // El papel de la semilla: 11/10/2026, vence el 10/11/2026; su ficha, a 30 días: el mismo día.
    expect(vencimientoAEnsenar('2026-11-10', '2026-10-11', { dias: 30, fijos: [] })).toEqual({ valor: '10/11/2026', apoyo: 'lo dice la factura, igual que su ficha (30 días)', aviso: false })
    expect(vencimientoAEnsenar('2026-11-10', '2026-10-11', { dias: 60, fijos: [] })).toEqual({ valor: '10/11/2026', apoyo: 'lo dice la factura; su ficha (60 días) daría el 10/12/2026', aviso: true })
    expect(vencimientoAEnsenar('2026-11-10', '2026-10-11', { dias: null, fijos: [] })).toEqual({ valor: '10/11/2026', apoyo: 'lo dice la factura', aviso: false })
    // Sin vencimiento en la factura: el de su ficha; sin ninguno, se dice.
    expect(vencimientoAEnsenar(null, '2026-10-11', { dias: 30, fijos: [5, 20] })).toEqual({ valor: '20/11/2026', apoyo: 'la factura no lo trae: el de su ficha (30 días, los días 5 y 20)', aviso: false })
    expect(vencimientoAEnsenar(null, '2026-10-11', null)).toEqual({ valor: 'sin vencimiento', apoyo: 'ni la factura ni su ficha lo dicen', aviso: true })
  })
  it('2 · no promete «a Diez con su PDF»: Diez no guarda documentos', () => {
    // S01e: sin «Cegid» (jerga del programa): lo que pasa, en palabras.
    expect(lineaDiez()).toBe('Se apunta en Folvy · a Diez irá sin el PDF, porque Diez aún no guarda documentos')
    expect(lineaDiez(true)).not.toMatch(/Folvy/)
    expect(lineaDiez()).not.toMatch(/con su PDF/)
  })
  it('3 · «Cómo se apunta» en dos columnas: Gasto e IVA al debe, A pagar al haber', () => {
    const c = columnasDelApunte([{ cuenta: '60000000', debe: 1283.15, haber: 0 }, { cuenta: '47200010', debe: 128.32, haber: 0 }, { cuenta: '40000006', debe: 0, haber: 1411.47 }])
    expect(c.gasto.map((x) => x.cuenta)).toEqual(['60000000', '47200010'])
    expect(c.pagar).toEqual([{ cuenta: '40000006', importe: 1411.47 }])
  })
  it('4 · el papel se recorta a lo escrito: la última fila con tinta, más un margen', () => {
    const ancho = 10, alto = 100
    const px = new Uint8ClampedArray(ancho * alto * 4).fill(255)
    for (let y = 0; y < 40; y += 10) for (let x = 0; x < ancho; x++) { const i = (y * ancho + x) * 4; px[i] = px[i + 1] = px[i + 2] = 20 }
    expect(hastaDondeHayTinta(px, ancho, alto, { margen: 0 })).toBe(31)
    expect(hastaDondeHayTinta(px, ancho, alto)).toBe(33)
    expect(hastaDondeHayTinta(new Uint8ClampedArray(ancho * alto * 4).fill(255), ancho, alto)).toBe(0)
  })
  it('5 · el tono de la banda: verde solo con su asiento validado', () => {
    expect(tonoDeLaFactura(null)).toBe('ambar')
    expect(tonoDeLaFactura({ estado: 'propuesto' })).toBe('ambar')
    expect(tonoDeLaFactura({ estado: 'validado' })).toBe('verde')
  })
})

// D01 R6 · Las facturas que ya entran por la recepción.
describe('R6 · la recepción cuyo papel es una factura', () => {
  const rec = (o: Partial<FilaDocumento>): FilaDocumento => fila({ tipo: 'recepcion', canal: 'cocina', confianza: null, ...o })
  it('de antes del corte: «en Diez», enlazada con su asiento si casa; solo en «Todas»; nunca un botón de apuntar', () => {
    const casa = rec({ estado: 'en_diez', diez: { id: 'e', serie: 2, numero: 9001, fecha: '2024-12-12' }, porque: 'Es de antes del corte y ya está en Diez (asiento 2/9001, mismo proveedor, número y total): no se vuelve a apuntar.' })
    expect(entendido(casa).titulo).toBe('Ya en Diez · asiento 2/9001')
    expect(punto(casa)).toBe('verde')
    expect(boton(casa)).toEqual({ texto: 'Ver la factura', principal: false })
    const noCasa = rec({ estado: 'en_diez', diez: null, porque: 'Es de antes del corte…' })
    expect(entendido(noCasa).titulo).toBe('De antes del corte · la llevó Diez')
    expect(punto(noCasa)).toBe('gris')
    expect(filtrar([casa, noCasa], 'todas')).toHaveLength(2)
    for (const v of ['para-mirar', 'por-aclarar', 'apuntadas'] as const) expect(filtrar([casa, noCasa], v)).toHaveLength(0)
  })
  it('desde el corte sin factura: «por aclarar», con su porqué y «de su recepción en Cocina»', () => {
    const f = rec({ estado: 'por_aclarar', porque: 'La recepción la leyó, pero no trae importes por línea con su IVA: no he podido hacer la factura. Súbela o díctamela.' })
    expect(filtrar([f], 'por-aclarar')).toHaveLength(1)
    expect(entendido(f).porque).toMatch(/no trae importes por línea/)
    expect(comoLlego(f.canal, null)).toBe('de su recepción en Cocina')
  })
})
