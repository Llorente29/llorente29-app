import { describe, it, expect } from 'vitest'
import {
  PERIODO_VACIO, tramosCobertura, pctCobertura, hayHuecoNoAtribuible,
  articuloTieneHueco, pctArticulo, textoCobertura, detalleHuecos, motivoSinCausa,
  type CoberturaPeriodo,
} from '@/modules/supply/lib/coberturaConsumo'

// La ventana real del conteo INV-00194 (Foodint Alcalá, 30/08 17:42 → 31/08
// 17:37), medida contra producción el 31/08. Sirve de ancla: si alguien cambia
// la fórmula, este caso lo dice con números que existieron.
const INV194: CoberturaPeriodo = {
  lineasVendidas: 115, lineasConConsumo: 106, lineasSinMapear: 7,
  modificadores: 54, modificadoresSinVinculo: 37, modificadoresMudos: 9,
}

describe('tramosCobertura', () => {
  it('cuenta como traducidos los platos que descuentan y los modificadores que aportan', () => {
    expect(tramosCobertura(INV194)).toEqual({ traducidas: 114, total: 169 })
  })
  it('nunca da modificadores que aportan negativos', () => {
    const p = { ...PERIODO_VACIO, modificadores: 2, modificadoresSinVinculo: 2, modificadoresMudos: 2 }
    expect(tramosCobertura(p).traducidas).toBe(0)
  })
})

describe('pctCobertura', () => {
  it('mide la ventana real de INV-00194', () => {
    expect(pctCobertura(INV194)).toBe(67.5)
  })
  it('sin ventas devuelve null, no 100', () => {
    // Un 100 % sin ventas sería la mentira tranquilizadora de la regla 8.
    expect(pctCobertura(PERIODO_VACIO)).toBeNull()
  })
  it('cobertura completa da 100', () => {
    const p: CoberturaPeriodo = {
      lineasVendidas: 10, lineasConConsumo: 10, lineasSinMapear: 0,
      modificadores: 4, modificadoresSinVinculo: 0, modificadoresMudos: 0,
    }
    expect(pctCobertura(p)).toBe(100)
  })
})

describe('hayHuecoNoAtribuible', () => {
  it('lo detecta por modificadores sin vincular', () => {
    expect(hayHuecoNoAtribuible({ ...PERIODO_VACIO, lineasVendidas: 5, lineasConConsumo: 5, modificadores: 1, modificadoresSinVinculo: 1 })).toBe(true)
  })
  it('lo detecta por un plato mapeado que aun así no descuenta', () => {
    expect(hayHuecoNoAtribuible({ ...PERIODO_VACIO, lineasVendidas: 5, lineasConConsumo: 4 })).toBe(true)
  })
  it('es falso cuando todo lo vendido se tradujo', () => {
    expect(hayHuecoNoAtribuible({ ...PERIODO_VACIO, lineasVendidas: 5, lineasConConsumo: 5 })).toBe(false)
  })
})

describe('cobertura por artículo', () => {
  it('Milanesa Ternera: 5 de 11, el hueco real medido en INV-00194', () => {
    const c = { tocan: 11, descuentan: 5 }
    expect(articuloTieneHueco(c)).toBe(true)
    expect(pctArticulo(c)).toBe(45.5)
  })
  it('un artículo que ninguna venta tocaba no tiene hueco ni porcentaje', () => {
    expect(articuloTieneHueco({ tocan: 0, descuentan: 0 })).toBe(false)
    expect(pctArticulo({ tocan: 0, descuentan: 0 })).toBeNull()
    expect(pctArticulo(undefined)).toBeNull()
  })
  it('un artículo cubierto del todo no tiene hueco', () => {
    expect(articuloTieneHueco({ tocan: 14, descuentan: 14 })).toBe(false)
  })
})

describe('textoCobertura / detalleHuecos', () => {
  it('nombra cada causa del hueco, sin agregarlas en un "otros"', () => {
    const t = textoCobertura(INV194)
    expect(t).toContain('67,5 %')
    expect(t).toContain('114 de 169')
    expect(t).toContain('37 modificadores sin vincular')
    expect(t).toContain('9 vinculados pero sin unidad utilizable')
    expect(t).toContain('7 líneas sin mapear')
    expect(t).toContain('2 platos sin escandallo')
  })
  it('sin huecos lo dice en positivo', () => {
    const p = { ...PERIODO_VACIO, lineasVendidas: 3, lineasConConsumo: 3 }
    expect(detalleHuecos(p)).toBe('')
    expect(textoCobertura(p)).toContain('Todo lo vendido en el periodo se tradujo a stock')
  })
  it('sin ventas no inventa un porcentaje', () => {
    expect(textoCobertura(PERIODO_VACIO)).toContain('No hubo ventas')
  })
  it('singulariza bien con un solo hueco de cada tipo', () => {
    const p = { ...PERIODO_VACIO, lineasVendidas: 2, lineasConConsumo: 0, lineasSinMapear: 1, modificadores: 1, modificadoresSinVinculo: 1 }
    const d = detalleHuecos(p)
    expect(d).toContain('1 modificador sin vincular')
    expect(d).toContain('1 línea sin mapear')
    expect(d).toContain('1 plato sin escandallo')
  })
})

describe('motivoSinCausa', () => {
  it('el hueco DEMOSTRABLE del artículo manda sobre el del periodo', () => {
    const m = motivoSinCausa({ tocan: 11, descuentan: 5 }, INV194)
    expect(m).toContain('6 de 11 ventas que llevaban este artículo no lo descontaron')
    expect(m).toContain('no la cocina')
  })
  it('sin hueco propio, cae al del periodo con su porcentaje', () => {
    const m = motivoSinCausa({ tocan: 14, descuentan: 14 }, INV194)
    expect(m).toContain('32,5 % de lo vendido en este periodo no descuenta stock')
    expect(m).toContain('37 modificadores sin vincular')
  })
  it('con cobertura completa devuelve null: el clasificador propone como siempre', () => {
    const p = { ...PERIODO_VACIO, lineasVendidas: 4, lineasConConsumo: 4 }
    expect(motivoSinCausa({ tocan: 4, descuentan: 4 }, p)).toBeNull()
    expect(motivoSinCausa(undefined, p)).toBeNull()
  })
})
