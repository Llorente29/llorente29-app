// tests/unit/modules/conta/i01c/contadores.test.ts
//
// I01c (Julio, 20/10, punto 6) · Las pestañas comunes del marco: todas con su
// icono, y los contadores de Impuestos (Calendario en rojo lo que vence en 7
// días o menos; Presentados en gris lo presentado del año). Regla 7: con cero
// no hay número.

import { describe, expect, it } from 'vitest'
import { contadoresImpuestos, type Calendario, type FilaCalendario } from '@/modules/conta/impuestos/calendario'
import { PRODUCTOS } from '@/modules/conta/esqueleto/productos'
import { ICONOS } from '@/modules/conta/diseno'

const fila = (x: Partial<FilaCalendario>): FilaCalendario => ({
  obligacion: 'o', modelo: '303', nombre: 'IVA', cadencia: 'quarterly', ejercicio: 2026, periodo: '3T', presentacion: '2026-10-20',
  domiciliacion: null, provisional: null, atrasado: false, domicilia: false, cuenta_final: null, se_calcula: true, declaracion: null, ...x,
})
const decl = (estado: string) => ({ estado }) as unknown as FilaCalendario['declaracion']
const cal = (filas: FilaCalendario[], presentados = 9): Calendario => ({
  hoy: '2026-10-20', ventana: null, desde: null, puede_gestionar: true, filas, siguiente: [],
  presentados: { ano: 2026, desde: null, vencidos: 0, presentados, en_plazo: presentados, contabilizados: 0 },
  modelos: [], no_presenta: [], se_pueden_anadir: [], certificado: null, pagos_sin_llegar: [],
})

describe('los contadores de Impuestos', () => {
  it('como la maqueta: 2 en rojo en Calendario (el 303 y el 202 vencen hoy) y 9 presentados', () => {
    const c = contadoresImpuestos(cal([
      fila({ modelo: '303', declaracion: decl('draft') }),
      fila({ modelo: '202', periodo: '2P' }),
      fila({ modelo: '111', declaracion: decl('filed') }),
      fila({ modelo: '115', declaracion: decl('filed') }),
    ]))
    expect(c.calendario).toEqual({ n: 2, tono: 'falta', texto: '2 vencen en 7 días o menos' })
    expect(c.presentados).toEqual({ n: 9, tono: 'neutro', texto: '9 presentados en 2026' })
  })
  it('lo que vence dentro de más de 7 días no cuenta; lo atrasado sí; lo que no hace falta, no', () => {
    const c = contadoresImpuestos(cal([
      fila({ presentacion: '2026-10-28' }),
      fila({ presentacion: '2026-10-27' }),
      fila({ presentacion: '2026-09-30', atrasado: true }),
      fila({ declaracion: decl('not_required') }),
    ]))
    expect(c.calendario?.n).toBe(2)
  })
  it('con cero no hay número (regla 7)', () => {
    expect(contadoresImpuestos(cal([], 0))).toEqual({})
  })
})

describe('las pestañas comunes del marco', () => {
  it('todas llevan su icono, y es uno del catálogo', () => {
    const sin = PRODUCTOS.flatMap((p) => p.pestanas.filter((t) => !t.icono || !(t.icono in ICONOS)).map((t) => `${p.id}.${t.id}`))
    expect(sin).toEqual([])
  })
})
