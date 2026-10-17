// tests/conta/cumplimiento/terceros-correo.test.ts
//
// D01 · El vigía de terceros conoce las seis columnas de las liquidaciones por
// correo (20261113T0100: otras ganancias, otros cargos de la promoción,
// anuncios, promociones en artículos, contracargos y ajustes). Antes no las
// sumaba, y las 8 liquidaciones de Uber del 16/10 salían «sin cuadrar».
//
// La fixture son esas 8 liquidaciones REALES de producción (regla 31), leídas
// el 17/10 en solo lectura con la parte «liquidaciones» de
// scripts/conta/agente-terceros.sql. Para no subir cifras reales al
// repositorio: sin ids, referencias, tiendas ni fechas, y cada importe
// multiplicado por 2. Eso conserva al céntimo cada suma, cada signo y cada
// diferencia, y los avisos del lector van con los mismos importes ×2. Las
// 255 liquidaciones de la cuenta, con el vigía de main: 1 aviso con las 8;
// con este: 0 sin explicar, 6 «por aclarar» y 2 cuadradas.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { descuadre, explicadoPorElLector, revisarTerceros } from '../../../scripts/conta/lib/terceros.mjs'

type Liq = { ref: string; avisos_lector: string[] } & Record<string, unknown>
const liquidaciones: Liq[] = JSON.parse(readFileSync('tests/conta/cumplimiento/datos/liquidaciones_correo_uber_x2.json', 'utf8'))
const sinAviso = liquidaciones.filter((l) => l.avisos_lector.length === 0)
const conAviso = liquidaciones.filter((l) => l.avisos_lector.length > 0)

describe('vigía de terceros · las liquidaciones del correo (D01)', () => {
  it('la población: 8, de las que 6 traen un aviso del lector', () => {
    expect(liquidaciones).toHaveLength(8)
    expect(conAviso).toHaveLength(6)
  })

  it('las 2 sin aviso cuadran al céntimo con las seis columnas nuevas', () => {
    expect(sinAviso.map((l) => l.ref)).toEqual(['UBER-6', 'UBER-8'])
    for (const l of sinAviso) expect(descuadre(l), l.ref).toBe(0)
  })

  it('las 6 con aviso: la diferencia es exactamente la que dijo el lector (total de marketing − sus líneas)', () => {
    for (const l of conAviso) {
      const d = descuadre(l)
      expect(d, l.ref).not.toBe(0)
      expect(explicadoPorElLector(l, d), l.ref).toBe(l.avisos_lector[0])
    }
  })

  it('el informe: ningún descuadre sin explicar; las 6 «por aclarar», con el motivo del lector', () => {
    const h = revisarTerceros({ liquidaciones })
    expect(h.map((x) => `${x.nivel} ${x.tipo}`)).toEqual(['ambar liquidacion_por_aclarar'])
    expect(h[0].detalle).toMatch(/^6 liquidaciones del correo no cuadran por lo que ya dijo el lector al leerlas\. /)
    expect(h[0].detalle).toContain('UBER-1: Gastos de marketing: las líneas suman −111,18 € y el total dice −569,74 €.')
  })

  it('un aviso que no explica la diferencia no la tapa: sigue siendo un descuadre', () => {
    const l = { ...conAviso[0], net_payout: Number(conAviso[0].net_payout) + 1 }
    expect(explicadoPorElLector(l, descuadre(l))).toBeNull()
    expect(revisarTerceros({ liquidaciones: [l] }).map((x) => x.tipo)).toEqual(['neto_descuadrado'])
  })

  it('sin las seis columnas (un volcado de antes), las 8 salen como antes: sin cuadrar', () => {
    const viejas = liquidaciones.map((l) => ({ ...l, d01: undefined, avisos_lector: undefined }))
    const h = revisarTerceros({ liquidaciones: viejas })
    expect(h.map((x) => x.tipo)).toEqual(['neto_descuadrado'])
    expect(h[0].detalle).toMatch(/^8 liquidaciones no cuadran/)
  })
})
