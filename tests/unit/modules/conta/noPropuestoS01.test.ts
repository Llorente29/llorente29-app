// tests/unit/modules/conta/noPropuestoS01.test.ts
//
// S01 · PR 3 · Entrega 5: el apartado donde sale «Lo que no he podido proponer»
// lo escribe la base (conta_propuesta_pendiente.donde) y lo busca la pantalla
// (DONDE). Es un texto entre comillas a los dos lados (regla 40): esta prueba
// los compara con las migraciones de la S01, en las dos direcciones.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DONDE, tituloNoPropuesto } from '@/modules/conta/lib/noPropuesto'

const dir = 'supabase/migrations'
const sql = readdirSync(dir)
  .filter((f) => /^20261028T\d{4}_s01_propuestas_.*\.sql$/.test(f))
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .join('\n')
const enLaBase = new Set([...sql.matchAll(/'((?:Contabilidad|Compras y gastos|Ventas) › [^']+)'/g)].map((m) => m[1]))

describe('S01 · lo que no he podido proponer, en su apartado', () => {
  it('las migraciones de las propuestas están (no compara contra nada vacío)', () => {
    expect(sql.length).toBeGreaterThan(0)
    expect(enLaBase.size).toBeGreaterThan(0)
  })
  it('cada apartado que escribe la base tiene su pantalla', () => {
    const pantallas = new Set<string>(Object.values(DONDE))
    for (const d of enLaBase) expect(pantallas.has(d), d).toBe(true)
  })
  it('cada pantalla que lo busca recibe algo de la base', () => {
    for (const d of Object.values(DONDE)) expect(enLaBase.has(d), d).toBe(true)
  })
  it('el título dice cuántos', () => {
    expect(tituloNoPropuesto(1)).toBe('Lo que no he podido proponer, y por qué · 1')
    expect(tituloNoPropuesto(3)).toBe('Lo que no he podido proponer, y por qué · 3')
  })
})
