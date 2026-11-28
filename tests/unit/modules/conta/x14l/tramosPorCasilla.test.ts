// tests/unit/modules/conta/x14l/tramosPorCasilla.test.ts
//
// X14l · Una recibida traída de ERP10 puede llevar dos tramos al mismo tipo (dos casillas: una línea y su abono). Lo que la
// pantalla hace con sus tramos (lineasYCuotas, el lector de la recibida guardada) los lee como lista: entran los dos, tal cual,
// sin sumarlos ni quedarse con uno. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { lineasYCuotas } from '@/modules/conta/lib/recibidaGuardada'

const tipoDe = (pct: number) => ({ id: `iva-${pct}`, rate: pct })

describe('dos casillas de ERP10 al mismo tipo', () => {
  it('entran las dos, tal cual, y suman la factura', () => {
    const impuestos = [{ porcentaje: 21, base: 100, cuota: 21 }, { porcentaje: 21, base: -20, cuota: -4.2 }, { porcentaje: 0, base: 50, cuota: 0 }]
    const r = lineasYCuotas([], impuestos, '62900000', tipoDe, false)
    expect(r.lineas.map((l) => [l.base, l.tipo?.porcentaje])).toEqual([[100, 21], [-20, 21], [50, 0]])
    expect(r.cuotas).toEqual(impuestos)
    expect(r.lineas.reduce((s, l) => s + l.base, 0)).toBe(130)
    expect(Math.round((r.cuotas ?? []).reduce((s, c) => s + c.cuota, 0) * 100)).toBe(1680)
  })
})
