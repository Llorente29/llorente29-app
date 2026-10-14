// C06b (respuesta 6, tarea 5) · Antes de pedir tanda o abrir PR a main: la
// suite e2e ENTERA en verde EN ESTE COMMIT. Los títulos son los que pone
// e2e-staging-conta.yml (run-name): «e2e · entera|frente|<pruebas> · <rama> · <sha>».
import { describe, expect, it } from 'vitest'
import { enteraEnVerde } from '../../scripts/conta/e2e-entera.mjs'

const SHA = 'f26366b7cd273b175272a19ee9a451f655e32d1c'
const run = (id: number, tipo: string, conclusion: string | null, sha = SHA) => ({
  id, head_sha: sha, display_title: `e2e · ${tipo} · conta/c06b-repasos · ${sha}`, status: conclusion ? 'completed' : 'in_progress', conclusion,
})

describe('la suite entera del commit', () => {
  it('una e2e del frente en verde NO vale: hace falta la entera', () => {
    expect(enteraEnVerde([run(1, 'frente', 'success')], SHA).ok).toBe(false)
  })
  it('la entera en verde de este commit, sí', () => {
    const v = enteraEnVerde([run(2, 'entera', 'failure'), run(3, 'entera', 'success')], SHA)
    expect(v).toMatchObject({ ok: true, run: { id: 3 } })
  })
  it('la entera en verde de OTRO commit, no', () => {
    expect(enteraEnVerde([run(4, 'entera', 'success', 'otro')], SHA).ok).toBe(false)
  })
  it('dice por qué no: en rojo, sin acabar, o que no hay ninguna', () => {
    expect(enteraEnVerde([run(5, 'entera', 'failure')], SHA).porque).toMatch(/en failure \(run 5\)/)
    expect(enteraEnVerde([run(6, 'entera', null)], SHA).porque).toMatch(/sin acabar \(run 6\)/)
    expect(enteraEnVerde([], SHA).porque).toMatch(/no hay ninguna suite entera/)
  })
})
