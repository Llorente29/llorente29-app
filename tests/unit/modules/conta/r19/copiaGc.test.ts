// R19 · paso 0 · La copia de GoCardless: lo que se enseña de ella y las hojas de su Excel (g04/copiaGc.ts).
// Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { copiaDeFila, hojasDeCopia, lineaDeCopia, nombreDelExcel } from '@/modules/conta/gestoria/g04/copiaGc'

const fila = {
  id: 'c1', tomada_at: '2026-11-25T14:02:00Z', por: 'persona', quien_name: 'Persona de prueba', clientes: 2, mandatos: 2, suscripciones: 3, cobros: 1, huella: 'abc',
  cuenta: { regla: 'suscripciones active con su próximo cobro en el mes', mes: '2026-12', suscripciones: 2, clientes: 2, euros: 133.1, dias: { '2026-12-04': 2 } },
}
const filas = [
  { tipo: 'cliente', gcId: 'CU1', datos: { gc_id: 'CU1', nombre: 'Cliente Uno, S.L.', correo: 'uno@example.com', nif: 'B00000011', mandatos_vivos: 1, suscripciones_activas: 2 } },
  { tipo: 'cliente', gcId: 'CU2', datos: { gc_id: 'CU2', nombre: 'Cliente Dos', correo: null, nif: null, mandatos_vivos: 1, suscripciones_activas: 1 } },
  { tipo: 'mandato', gcId: 'MD1', datos: { gc_id: 'MD1', gc_cliente_id: 'CU1', estado: 'active', referencia: 'REF-1', esquema: 'sepa_core', cuenta_final: '00', banco: 'Banco de prueba' } },
  { tipo: 'suscripcion', gcId: 'SB1', datos: { gc_id: 'SB1', gc_cliente_id: 'CU1', nombre: 'GESTORIA MENSUAL', importe: '60.50', estado: 'active', proximo_cobro_fecha: '2026-12-04', proximo_cobro_importe: '60.50' } },
  { tipo: 'suscripcion', gcId: 'SB2', datos: { gc_id: 'SB2', gc_cliente_id: 'CU2', nombre: 'GESTION LABORAL', importe: 72.6, estado: 'active', proximo_cobro_fecha: '2026-12-04', proximo_cobro_importe: 72.6 } },
  { tipo: 'suscripcion', gcId: 'SB3', datos: { gc_id: 'SB3', gc_cliente_id: 'CU1', nombre: 'VIEJA', importe: 10, estado: 'cancelled' } },
  { tipo: 'cobro', gcId: 'PM1', datos: { gc_id: 'PM1', mandato_gc_id: 'MD1', estado: 'paid_out', fecha: '2026-11-04', importe: 60.5, motivo: 'x', motivo_es: 'Cobrado' } },
]

describe('R19 · la copia de GoCardless', () => {
  it('lee la copia con lo que cuenta la base', () => {
    const c = copiaDeFila(fila)
    expect(c.cuenta).toEqual({ regla: fila.cuenta.regla, mes: '2026-12', suscripciones: 2, clientes: 2, euros: 133.1, dias: { '2026-12-04': 2 } })
    expect(c.suscripciones).toBe(3)
  })
  it('la línea dice de cuándo es y lo que GoCardless cobrará, en palabras', () => {
    expect(lineaDeCopia(copiaDeFila(fila))).toBe('Copia del 25/11/2026 15:02 · en diciembre GoCardless cobrará 133,10 € a 2 clientes (2 suscripciones)')
    expect(lineaDeCopia(null)).toBe('Aún no hay ninguna copia de GoCardless: se guarda en la próxima lectura (cada noche o con «Leer ahora»).')
    expect(lineaDeCopia(copiaDeFila({ ...fila, cuenta: { ...fila.cuenta, mes: null, suscripciones: 0 } }))).toBe('Copia del 25/11/2026 15:02 · no hay ningún cobro por delante')
  })
  it('las hojas: el resumen primero y después todo lo copiado, sin perder ninguna fila', () => {
    const h = hojasDeCopia('Empresa de prueba', copiaDeFila(fila), filas)
    expect(h.map((x) => x.nombre)).toEqual(['Resumen', 'Clientes', 'Mandatos', 'Suscripciones', 'Cobros'])
    expect(h.map((x) => x.filas.length)).toEqual([1, 2, 1, 3, 1])
    expect(h[0].filas[0]).toMatchObject({ 'Copia del': '25/11/2026 15:02', Por: '«Leer ahora»', 'Euros que cobra': 133.1, 'Mes que cuenta': '2026-12' })
    // Los importes, como números (Excel los suma); la suscripción cancelada también está: la copia es entera.
    expect(h[3].filas.map((f) => f.Importe)).toEqual([60.5, 72.6, 10])
    expect(h[3].filas[2].Estado).toBe('cancelled')
    expect(h[4].filas[0].Motivo).toBe('Cobrado')
    for (const x of h) for (const f of x.filas) expect(Object.keys(f)).toEqual(x.columnas)
  })
  it('el nombre del fichero lleva la empresa y la hora de la copia', () => {
    expect(nombreDelExcel('Empresa de Prueba, S.L.', copiaDeFila(fila))).toBe('sumied-copia-gocardless-empresa-de-prueba-s-l-2026-11-25-1502.xlsx')
  })
})
