// S01c · Las facturas entran solas: lo que no es base. El caso de Olimpo, con
// nombres inventados (repositorio público): un proveedor «albarán y factura
// después», sus dos albaranes de 170,10 y 363,67, y los dos pagos del banco
// con «FACT: 26A/10965» y «FACT: 26A/10966» en el concepto, como los de verdad.
import { describe, expect, it } from 'vitest'
import { decidir, facturasEnConcepto, type Contexto, type FacturaPendiente, type Movimiento } from '@/modules/conta/lib/conciliacion'
import { esperaEnPalabras } from '@/modules/conta/lib/compras'
import { cuandoEnPalabras, lineaEnPalabras, queSeHizo, resumenLineas } from '@/modules/conta/lib/correoFacturas'
import type { LlegadaCorreo } from '@/modules/conta/services/comprasService'

function ctx(p: Partial<Contexto> = {}): Contexto {
  return {
    cuentas: [{ id: 'cta', nombre: 'Cuenta', cuenta: '57200001' }],
    sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
    nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [], nombres: {},
    cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: '57000000',
    ...p,
  }
}
const mov = (importeCent: number, concepto: string): Movimiento =>
  ({ id: `m${importeCent}`, cuentaId: 'cta', fecha: '2026-10-26', conceptoComun: null, referencias: [], antesDelCorte: false, importeCent, concepto })
const PROV = 'GOURMET PRUEBA, S.L'
// La factura que se creó con el albarán (la de mentira): 26/13028, 363,67.
const DEL_ALBARAN: FacturaPendiente = { id: 'f-alb', numero: '26/13028', fecha: '2026-10-19', totalCent: 36_367, pagadoCent: 0, proveedor: PROV,
  alias: ['GOURMET PRUEBA S L'], terceroId: 't-g', cuentaTercero: '40000004', aprobada: true }
const ALBARANES = [
  { proveedor: PROV, numero: '26/13024', fecha: '2026-10-19', totalCent: 17_010 },
  { proveedor: PROV, numero: '26/13028', fecha: '2026-10-19', totalCent: 36_367 },
]
const PROVEEDORES = [{ terceroId: 't-g', proveedor: PROV, alias: ['GOURMET PRUEBA S L'], cuentaTercero: '40000004', cuentaAnticipo: '40700004' }]

describe('el número de factura del concepto del banco', () => {
  it('lo que va detrás de FACT, FRA o FACTURA; un número suelto no', () => {
    expect(facturasEnConcepto('TRANSFERENCIAS // TRANSFERENCIA REALIZADA // FACT: 26A/10965 · GOURMET PRUEBA S L')).toEqual(['26A/10965'])
    expect(facturasEnConcepto('RECIBO SUMINISTROS FRA 477')).toEqual(['477'])
    expect(facturasEnConcepto('PAGO FACTURA Nº 2026/0012.')).toEqual(['2026/0012'])
    expect(facturasEnConcepto('TRANSFERENCIA 26A/10965')).toEqual([])
  })
})

describe('Bancos: la factura que falta', () => {
  it('170,10 con «FACT: 26A/10965» y la factura sin entrar: falta, con el albarán que la espera, y no se casa con nada', () => {
    const d = decidir(mov(-17_010, 'TRANSFERENCIAS // TRANSFERENCIA REALIZADA // FACT: 26A/10965 · GOURMET PRUEBA S L'),
      ctx({ facturas: [DEL_ALBARAN], proveedores: PROVEEDORES, albaranesEsperando: ALBARANES }))
    expect(d.que).toBe('Falta la factura 26A/10965 de GOURMET PRUEBA, S.L · 170,10 €')
    expect(d.confianza).toBe('duda')
    expect(d.destino).toBeNull()
    expect(d.porque).toContain('La espera el albarán 26/13024 del 19/10.')
  })
  it('363,67 con «FACT: 26A/10966»: nunca con la factura 26/13028 del mismo importe y otro número', () => {
    const d = decidir(mov(-36_367, 'TRANSFERENCIAS // TRANSFERENCIA REALIZADA // FACT: 26A/10966 · GOURMET PRUEBA S L'),
      ctx({ facturas: [DEL_ALBARAN], proveedores: PROVEEDORES, albaranesEsperando: ALBARANES }))
    expect(d.que).toBe('Falta la factura 26A/10966 de GOURMET PRUEBA, S.L · 363,67 €')
    expect(d.destino).toBeNull()
    expect(d.preseleccionar).toBeFalsy()
  })
  it('cuando entra la factura 1/26A/10966, el pago casa con ella solo', () => {
    const buena: FacturaPendiente = { ...DEL_ALBARAN, id: 'f-buena', numero: '1/26A/10966', fecha: '2026-10-20' }
    const d = decidir(mov(-36_367, 'TRANSFERENCIAS // TRANSFERENCIA REALIZADA // FACT: 26A/10966 · GOURMET PRUEBA S L'), ctx({ facturas: [buena], proveedores: PROVEEDORES }))
    expect(d.confianza).toBe('seguro')
    expect(d.destino).toMatchObject({ tipo: 'factura_recibida', facturas: [{ id: 'f-buena', importe: 363.67 }] })
  })
})

describe('«Qué está esperando factura», en palabras', () => {
  const a = { supplier_name: 'Mensual Prueba', camino: 'pendiente_factura', forma: 'per_delivery', llegada: 'inicio_mes_siguiente' as const }
  it('el de primeros de mes espera hasta el día 10, y no está retrasado', () => {
    expect(esperaEnPalabras({ ...a, dias: 31, espera_hasta: '2026-11-10', retrasado: false })).toEqual({
      estado: 'Esperando · 31 días · normal hasta el 10 de nov.',
      porque: 'Mensual Prueba manda todas sus facturas juntas a primeros del mes siguiente.',
    })
  })
  it('el retrasado lo dice, con lo que era normal', () => {
    const e = esperaEnPalabras({ ...a, llegada: null, forma: 'delivery_note_then_invoice', dias: 17, espera_hasta: '2026-11-03', retrasado: true })
    expect(e.estado).toBe('Retrasado · 17 días (lo normal era hasta el 3 de nov.)')
    expect(e.porque).toBe('Mensual Prueba manda la factura después del albarán.')
  })
})

describe('el correo de facturas, en palabras', () => {
  const l = (p: Partial<LlegadaCorreo>): LlegadaCorreo => ({ fecha: '2026-10-29T09:12:00Z', de: 'a@b.example', asunto: 'Factura', resultado: 'recibido', llegada: 'factura', motivo: null, factura: null, dicho: null, ...p })
  it('cuándo: hoy, ayer u otro día, a la hora de Madrid', () => {
    const ahora = new Date('2026-10-29T15:00:00Z')
    expect(cuandoEnPalabras('2026-10-29T09:12:00Z', ahora)).toBe('hoy a las 10:12')
    expect(cuandoEnPalabras('2026-10-28T17:03:00Z', ahora)).toBe('ayer a las 18:03')
    expect(cuandoEnPalabras('2026-10-24T08:30:00Z', ahora)).toBe('el 24 de octubre a las 10:30')
  })
  it('qué se hizo: casada (y si difiere), esperando su albarán, no es una factura, repetida y la confirmación de Gmail', () => {
    const f = { id: 'f', codigo: 'FAC-1', numero: '1/26A/10965', total: 170.1, proveedor: PROV, casada: true }
    const casada = queSeHizo(l({ factura: f, dicho: 'Casa con el albarán 26/13024 del 19/10. Difiere en 52,00 €: el albarán tiene líneas sin leer.' }))
    expect(casada.titulo).toBe(`Factura leída y casada: 1/26A/10965 de ${PROV}`)
    expect(casada.tono).toBe('mira')
    expect(queSeHizo(l({ factura: { ...f, casada: false } })).titulo).toBe(`Factura esperando su albarán: 1/26A/10965 de ${PROV}`)
    expect(queSeHizo(l({ llegada: 'no_es_factura', motivo: 'No parece una factura.' })).titulo).toBe('No es una factura')
    expect(queSeHizo(l({ llegada: 'repetida', factura: { ...f, casada: false } })).titulo).toBe(`Repetida: 1/26A/10965 de ${PROV}`)
    expect(queSeHizo(l({ resultado: 'confirmacion', llegada: null })).titulo).toBe('Gmail pide confirmar el reenvío')
  })
})

describe('la factura contra el albarán, línea a línea', () => {
  // El caso de Olimpo: el albarán 26/13024 se leyó con una línea y la factura trae dos.
  const c = { lineas_factura: 2, cuadran: 1, difieren: 0, solo_factura: 1, solo_albaran: 0, lineas: [
    { resultado: 'cuadra' as const, texto_factura: 'GÉNERO', texto_albaran: 'Género', albaran: '26/13024', cant_factura: 1, cant_albaran: 1, importe_factura: 97.44, importe_albaran: 97.44 },
    { resultado: 'solo_factura' as const, texto_factura: 'Aceite de prueba 5 L', cant_factura: 2, importe_factura: 52 },
  ] }
  it('cada línea dice si cuadra y, si no, qué difiere o en qué lado está', () => {
    expect(lineaEnPalabras(c.lineas[0])).toEqual({ que: 'GÉNERO', dice: 'Cuadra · 1 · 97,44 €', mira: false })
    expect(lineaEnPalabras(c.lineas[1])).toEqual({ que: 'Aceite de prueba 5 L', dice: 'En la factura y no en el albarán · 2 · 52,00 €', mira: true })
    expect(lineaEnPalabras({ resultado: 'cantidad', texto_factura: 'Queso', cant_factura: 2, cant_albaran: 1.5 }).dice).toBe('Difiere en cantidad: la factura dice 2 y el albarán 1,5')
    expect(lineaEnPalabras({ resultado: 'importe', texto_factura: 'Queso', importe_factura: 10, importe_albaran: 9.5 }).dice).toBe('Difiere en importe: la factura dice 10,00 € y el albarán 9,50 €')
    expect(lineaEnPalabras({ resultado: 'solo_albaran', texto_albaran: 'Pan', albaran: '26/13024', cant_albaran: 3, importe_albaran: 4.5 }).dice).toBe('En el albarán 26/13024 y no en la factura · 3 · 4,50 €')
  })
  it('el resumen cuenta lo que hay, sin esconder nada', () => {
    expect(resumenLineas(c)).toBe('1 cuadra · 1 solo en la factura')
    expect(resumenLineas({ ...c, cuadran: 4, solo_factura: 0, lineas_factura: 4 })).toBe('Las 4 líneas cuadran con el albarán.')
    expect(resumenLineas({ ...c, lineas_factura: 0, cuadran: 0, solo_factura: 0, solo_albaran: 3 })).toBe('La factura no trae sus líneas: no se pueden comparar con las del albarán.')
  })
})
