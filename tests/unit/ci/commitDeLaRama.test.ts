// tests/unit/ci/commitDeLaRama.test.ts — X09 (19/11): el commit de «commit», comprobado al
// lanzar el ensayo o el real (scripts/ci/commit-de-la-rama.mjs), con una frase que dice qué se
// ha puesto y cuál es el último. Commits inventados.

import { describe, expect, it } from 'vitest'
import { fraseSinEnsayo, validarCommit } from '../../../scripts/ci/commit-de-la-rama.mjs'

const ULTIMO = 'bd9167f9b2a3b52646336a2ea7224c190bd1b6f0'
const VIEJO = '3b9aef1d9d0f1ad393813191f9aa98978a69e2a9'
const RAMA = 'conta/x08-dias-tpv-a-erp10'
const PRINCIPIO = 'El commit tiene que ser el último de la rama, entero (40 caracteres).'
const v = (commit: string, o: Partial<{ ultimo: string | null; existe: (s: string) => boolean }> = {}) =>
  validarCommit({ rama: RAMA, commit, ultimo: ULTIMO, ...o })

describe('validarCommit: el último de la rama, entero', () => {
  it('el último, entero: vale', () => {
    expect(v(ULTIMO)).toEqual({ ok: true, frase: `El commit ${ULTIMO} es el último de «${RAMA}».` })
  })
  it('corto (los 9 primeros, como lo enseña git log --oneline): no vale, y dice cuál es el último', () => {
    expect(v('bd9167f9b')).toEqual({ ok: false, frase: `${PRINCIPIO} Has puesto: «bd9167f9b», que es corto (9 caracteres) · El último es: ${ULTIMO}` })
  })
  it('pegado dos veces (lo del 19/11): no vale, y lo dice', () => {
    expect(v(ULTIMO + ULTIMO)).toEqual({ ok: false, frase: `${PRINCIPIO} Has puesto: «${ULTIMO}${ULTIMO}», que está pegado dos veces · El último es: ${ULTIMO}` })
  })
  it('con espacios delante o detrás (copiado de una tabla), o con un salto de línea: no vale, y lo dice', () => {
    expect(v(` ${ULTIMO} `).frase).toBe(`${PRINCIPIO} Has puesto: « ${ULTIMO} », que lleva espacios o saltos de línea · El último es: ${ULTIMO}`)
    expect(v(`${ULTIMO}\n`).frase).toBe(`${PRINCIPIO} Has puesto: «${ULTIMO}⏎», que lleva espacios o saltos de línea · El último es: ${ULTIMO}`)
    expect(v(` ${ULTIMO} `).ok).toBe(false)
  })
  it('uno que no es el último (hubo otro push después): no vale, y dice cuál es', () => {
    expect(v(VIEJO)).toEqual({ ok: false, frase: `${PRINCIPIO} Has puesto: ${VIEJO}, que no es el último de «${RAMA}» (después ha habido otro push) · El último es: ${ULTIMO}` })
  })
  it('uno de 40 caracteres que no está en el repositorio: no vale, y lo dice', () => {
    expect(v('0'.repeat(40), { existe: () => false }).frase).toBe(`${PRINCIPIO} Has puesto: ${'0'.repeat(40)}, que no está en el repositorio · El último es: ${ULTIMO}`)
  })
  it('en mayúsculas, con letras que no son de un commit, largo o vacío: cada uno con su porqué', () => {
    expect(v(ULTIMO.toUpperCase()).frase).toContain('que va en mayúsculas')
    expect(v('bd9167f9b2a3b52646336a2ea7224c190bd1b6fz').frase).toContain('que lleva caracteres que no son de un commit (0-9 y a-f)')
    expect(v(`${ULTIMO}0`).frase).toContain('que es largo (41 caracteres)')
    expect(v('')).toEqual({ ok: false, frase: `${PRINCIPIO} No has puesto ninguno · El último es: ${ULTIMO}` })
  })
  it('una rama que no existe: lo dice; sin «rama» (una tanda ya fusionada), no hay commit que mirar', () => {
    expect(v(ULTIMO, { ultimo: null })).toEqual({ ok: false, frase: `No existe la rama «${RAMA}». Mira el nombre en el PR (sin espacios).` })
    expect(validarCommit({ rama: '', commit: '', ultimo: null }).ok).toBe(true)
  })
})

describe('fraseSinEnsayo: el real dice qué ensayo buscó y cuáles hay de esa rama', () => {
  const run = (titulo: string, o: Record<string, unknown> = {}) => ({ display_title: titulo, status: 'completed', conclusion: 'success', head_branch: 'main', created_at: '2026-11-19T06:52:51Z', ...o })
  it('el título exacto, y los de esa rama con su estado y su hora (de Madrid); los de otra rama, no', () => {
    const t = fraseSinEnsayo({
      buscado: `ensayo · ${RAMA} · ${ULTIMO}`, rama: RAMA,
      runs: [
        run(`ensayo · ${RAMA} · ${VIEJO}`, { created_at: '2026-11-19T06:30:00Z' }),
        run(`ensayo · ${RAMA} · bd9167f9b`, { conclusion: 'cancelled', created_at: '2026-11-19T06:52:41Z' }),
        run(`ensayo · conta/otra-rama · ${ULTIMO}`),
        run(`real · ${RAMA} · ${VIEJO}`),
      ],
    })
    expect(t).toBe([
      `No hay ningún ENSAYO en verde lanzado desde main con el título exacto «ensayo · ${RAMA} · ${ULTIMO}». Primero el ensayo de este commit, luego el real.`,
      `De «${RAMA}» hay estos 2:`,
      `  · «ensayo · ${RAMA} · bd9167f9b» · cancelado · 19/11 07:52`,
      `  · «ensayo · ${RAMA} · ${VIEJO}» · en verde · 19/11 07:30`,
    ].join('\n'))
  })
  it('sin ningún ensayo de esa rama, lo dice; uno lanzado desde otra rama, se ve que no cuenta', () => {
    expect(fraseSinEnsayo({ buscado: 'ensayo · x · y', rama: 'x', runs: [] })).toContain('De «x» no hay ningún ensayo.')
    expect(fraseSinEnsayo({ buscado: 'ensayo · x · y', rama: 'x', runs: [run('ensayo · x · y', { head_branch: 'x' })] }))
      .toContain('«ensayo · x · y» · en verde · 19/11 07:52, lanzado desde «x» (no cuenta)')
  })
})
