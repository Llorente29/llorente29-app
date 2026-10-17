// tests/unit/e2e/carril.test.ts
//
// W02 (paso 1c): cada e2e con sus propias cuentas. La regla del carril vive en
// tres sitios —el clon en SQL (scripts/e2e/carril/comun.sql), las pruebas
// (tests/e2e/conta/sesion.ts) y los scripts de Node (scripts/e2e/carril.mjs)—
// y los tres tienen que decir lo mismo: si una prueba calcula un id distinto
// del que copió el clon, busca una fila que no existe.
//
// Los valores esperados NO salen de esta prueba: los calculó la función SQL
// del clon en staging-conta el 16/10 (pg_temp.en_carril), con ids reales de la
// plantilla. El caso «d45988cb-0fa1…» es el que rompió la primera regla: un id
// al azar que ya tenía 0fa1 (= 4001) en el segundo grupo y, con «poner N», se
// quedaba igual y chocaba consigo mismo.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carrilDe, correoDelCarril as correoTs, enCarril as enCarrilTs } from '../../e2e/conta/sesion'
import { correoDelCarril as correoMjs, enCarril as enCarrilMjs } from '../../../scripts/e2e/carril.mjs'

// [id de la plantilla, carril, lo que devolvió pg_temp.en_carril en staging]
const DE_SQL: [string, number, string][] = [
  ['c01a0000-0000-4000-8000-0000000000a3', 7, 'c01a0000-0007-4000-8000-0000000000a3'],
  ['3b34403a-a7d6-4a48-a8d7-737e8cababdc', 4001, '3b34403a-a877-4a48-a8d7-737e8cababdc'],
  ['d45988cb-0fa1-4591-9a3b-1384bb80ad99', 4001, 'd45988cb-0000-4591-9a3b-1384bb80ad99'],
  ['fc7df35a-c53c-460e-907a-ebea3d7fef8b', 4095, 'fc7df35a-cac3-460e-907a-ebea3d7fef8b'],
  ['00000000-ffff-0000-0000-000000000000', 1, '00000000-fffe-0000-0000-000000000000'],
]

describe('la regla del carril', () => {
  it('las pruebas y los scripts calculan el mismo id que el clon en SQL', () => {
    for (const [id, n, sql] of DE_SQL) {
      expect(enCarrilTs(id, n)).toBe(sql)
      expect(enCarrilMjs(id, n)).toBe(sql)
    }
  })

  it('ningún id se queda igual en ningún carril (el fallo de la primera regla)', () => {
    const ids = DE_SQL.map(([id]) => id)
    for (const id of ids) for (let n = 1; n <= 4095; n++) expect(enCarrilTs(id, n)).not.toBe(id)
  })

  it('dos carriles no comparten ningún id, y el mismo id siempre va al mismo sitio', () => {
    const id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'
    const vistos = new Set<string>()
    for (let n = 1; n <= 4095; n++) vistos.add(enCarrilTs(id, n))
    expect(vistos.size).toBe(4095)
    expect(enCarrilTs(id, 12)).toBe(enCarrilTs(id, 12))
  })

  it('los ids de las semillas (segundo grupo 0000) quedan con el número del carril, a la vista', () => {
    expect(enCarrilTs('c01a0000-0000-4000-8000-00000000000a', 0x2a)).toBe('c01a0000-002a-4000-8000-00000000000a')
  })

  it('sin carril, todo como antes (otras ramas con la e2e de antes)', () => {
    expect(enCarrilTs('c01a0000-0000-4000-8000-00000000000a', null)).toBe('c01a0000-0000-4000-8000-00000000000a')
    expect(correoTs('a.admin@prueba.folvy.test', null)).toBe('a.admin@prueba.folvy.test')
  })

  it('el correo: parte local + .carril-N, igual en los dos sitios y como lo hace el clon', () => {
    for (const c of ['a.admin@prueba.folvy.test', 'sola.admin@c06-prueba.test', 'c06.plataforma@c06-prueba.test']) {
      expect(correoTs(c, 3)).toBe(correoMjs(c, 3))
    }
    expect(correoTs('a.admin@prueba.folvy.test', 3)).toBe('a.admin.carril-3@prueba.folvy.test')
    const sql = readFileSync('scripts/e2e/carril/comun.sql', 'utf8')
    expect(sql).toContain(`split_part(c, '@', 1) || '.carril-' || n || '@' || split_part(c, '@', 2)`)
  })

  it('el carril: un número de 1 a 4095, o nada', () => {
    expect(carrilDe(undefined)).toBeNull()
    expect(carrilDe(' 12 ')).toBe(12)
    expect(() => carrilDe('0')).toThrow(/1 a 4095/)
    expect(() => carrilDe('a')).toThrow(/1 a 4095/)
    expect(() => enCarrilMjs('c01a0000-0000-4000-8000-00000000000a', 4096)).toThrow(/fuera de rango/)
  })

  it('el SQL del clon usa la misma fórmula (XOR del segundo grupo)', () => {
    const sql = readFileSync('scripts/e2e/carril/comun.sql', 'utf8')
    expect(sql).toContain("('x' || substr(u::text, 10, 4))::bit(16)::int # n")
  })
})
