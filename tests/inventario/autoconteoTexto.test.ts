// tests/inventario/autoconteoTexto.test.ts
//
// El autoconteo en palabras de oficina (src/modules/supply/lib/autoconteoTexto.ts),
// contra la POBLACIÓN REAL (regla 31): 60 líneas de autoconteos aprobados de
// Foodint, sin nombres (diferencias-reales.json). Los ejemplos con nombre de
// abajo son de esa misma lista.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  cantidad, diferenciaEnPalabras, euros, fraseDelAplicado, horaMadrid, repartirDiferencias,
  type LineaParaDiferencia,
} from '@/modules/supply/lib/autoconteoTexto'

type Fila = { u: string; s: number | null; c: number | null; vq: number | null; vv: number | null; nr: boolean; ex: boolean }
const reales: Fila[] = JSON.parse(readFileSync(path.join(__dirname, 'diferencias-reales.json'), 'utf8')).filas
const linea = (f: Fila): LineaParaDiferencia => ({
  systemQty: f.s, countedQty: f.c, varianceQty: f.vq, varianceValue: f.vv,
  unitAbbr: f.u || null, excludedAt: f.ex ? '2026-10-20T10:00:00Z' : null,
})
const nbsp = (s: string) => s.replace(/\u00A0/g, ' ')

describe('la hora del aplicado, en Madrid', () => {
  it('el cron de las 03:10 UTC son las 5:10 en verano y las 4:10 en invierno', () => {
    expect(horaMadrid('2026-10-21T03:10:00Z')).toBe('5:10')
    expect(horaMadrid('2026-10-26T03:10:00Z')).toBe('4:10')
  })
  it('«Aplicado solo a las 5:10», con el día cuando no es el del recuento', () => {
    expect(fraseDelAplicado({ via: 'cron', approvedAt: '2026-10-21T03:10:04Z', createdAt: '2026-10-21T01:30:00Z' }))
      .toBe('Aplicado solo a las 5:10')
    expect(fraseDelAplicado({ via: 'cron', approvedAt: '2026-10-22T03:10:04Z', createdAt: '2026-10-21T04:00:00Z' }))
      .toBe('Aplicado solo a las 5:10 del jueves 22')
  })
  it('al terminar en la tablet dice quién lo terminó, y el rezagado dice cuándo', () => {
    expect(fraseDelAplicado({ via: 'al_terminar', approvedAt: '2026-10-21T15:42:00Z', createdAt: '2026-10-21T04:00:00Z', approvedByName: 'Natacha' }))
      .toBe('Aplicado al terminar el recuento, a las 17:42, lo terminó Natacha')
    expect(fraseDelAplicado({ via: 'al_terminar', approvedAt: '2026-10-21T15:42:00Z', createdAt: '2026-10-21T04:00:00Z', approvedByName: 'Autoconteo' }))
      .toBe('Aplicado al terminar el recuento, a las 17:42')
    expect(fraseDelAplicado({ via: 'rezagado', approvedAt: '2026-10-22T05:46:00Z', createdAt: '2026-10-21T04:00:00Z' }))
      .toBe('Aplicado solo a las 7:46 del jueves 22, al preparar el recuento siguiente')
  })
})

describe('cantidades y euros', () => {
  it('kilos y litros desde 1.000 g/ml, sin decimales sueltos', () => {
    expect(nbsp(cantidad(2334.48043184885, 'g'))).toBe('2,33 kg')
    expect(nbsp(cantidad(360.71737550299, 'g'))).toBe('361 g')
    expect(nbsp(cantidad(45.2352941176471, 'ud'))).toBe('45,24 ud')
    expect(nbsp(cantidad(0.5, 'ud'))).toBe('0,5 ud')
  })
  it('entre la cifra y la unidad va un espacio de no separación (no se parte en el móvil)', () => {
    expect(cantidad(26, 'ud')).toBe('26\u00A0ud')
    expect(euros(-63.13)).toBe('−63,13\u00A0€')
  })
  it('el signo va siempre, y sin coste no es un cero', () => {
    expect(nbsp(euros(-63.13)!)).toBe('−63,13 €')
    expect(nbsp(euros(2.5)!)).toBe('+2,50 €')
    expect(euros(null)).toBeNull()
  })
})

describe('las 60 líneas reales', () => {
  it('ninguna frase sale vacía, con NaN, ni con más de dos decimales', () => {
    for (const f of reales) {
      const d = diferenciaEnPalabras(linea(f))
      expect(d.texto.length).toBeGreaterThan(5)
      expect(d.texto).not.toMatch(/NaN|undefined|null/)
      expect(nbsp(d.texto)).not.toMatch(/\d,\d{3,}/)
    }
  })

  it('el tono casa con el signo; el teórico en negativo nunca dice «faltaban» ni «sobraban»', () => {
    for (const f of reales) {
      const d = diferenciaEnPalabras(linea(f))
      if (f.ex) { expect(d.tono).toBe('apartada'); continue }
      if ((f.s ?? 0) < 0) { expect(d.tono).toBe('saneado'); expect(d.texto).not.toMatch(/Faltaban|Sobraban/); continue }
      if (Math.abs(f.vq ?? 0) < 1e-7) { expect(d.tono).toBe('cuadra'); continue }
      expect(d.tono).toBe((f.vq ?? 0) < 0 ? 'falta' : 'sobra')
    }
  })

  it('los casos de la muestra, como los leería la oficina', () => {
    const t = (i: number) => nbsp(diferenciaEnPalabras(linea(reales[i])).texto)
    expect(t(17)).toBe('Faltaban 26 ud; quedan 42 ud')                       // −63,13 €
    expect(nbsp(diferenciaEnPalabras(linea(reales[17])).valor!)).toBe('−63,13 €')
    expect(t(2)).toBe('Faltaban 531 g; quedan 2,7 kg')
    expect(t(35)).toBe('Sobraban 2,33 kg; quedan 25 kg')
    expect(t(10)).toBe('El stock decía −31 ud, que no puede ser; queda en lo contado, 0 ud. No cuenta como merma')
    expect(t(26)).toBe('Cuadra: 15 ud')
    expect(t(24)).toBe('Apartada a mano: no se aplica. Se contaron 0 ud')
  })

  it('el reparto: todas las filas están en algún sitio (regla 7), las que cambian, ordenadas por valor', () => {
    const r = repartirDiferencias(reales.map(linea))
    expect(r.cambian.length + r.cuadran.length + r.apartadas.length + r.sinContar).toBe(reales.length)
    expect(r.apartadas.length).toBe(reales.filter(f => f.ex).length)
    const conValor = r.cambian.filter(x => x.d.tono !== 'saneado').map(x => x.d.peso)
    expect([...conValor].sort((a, b) => b - a)).toEqual(conValor)
    // Las saneadas van detrás de las que cuestan dinero.
    const primeraSaneada = r.cambian.findIndex(x => x.d.tono === 'saneado')
    expect(r.cambian.slice(primeraSaneada).every(x => x.d.tono === 'saneado')).toBe(true)
    expect(nbsp(r.cambian[0].d.valor!)).toBe('−63,85 €')
  })
})
