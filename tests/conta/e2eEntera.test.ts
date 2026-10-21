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
  // W02 (1c): la entera va en 4 trozos; si uno falla se puede relanzar ESE
  // trozo para diagnosticar, pero ese verde es un reintento y no vale.
  it('una entera en verde en el segundo intento (un trozo relanzado) NO vale, y lo dice', () => {
    const v = enteraEnVerde([{ ...run(7, 'entera', 'success'), run_attempt: 2 }], SHA)
    expect(v.ok).toBe(false)
    expect(v.porque).toMatch(/intento 2 \(run 7\).*diagnosticar/)
  })
  it('la del primer intento, sí (y un run sin run_attempt, el de antes, cuenta como primero)', () => {
    expect(enteraEnVerde([{ ...run(8, 'entera', 'success'), run_attempt: 1 }], SHA)).toMatchObject({ ok: true, run: { id: 8 } })
    expect(enteraEnVerde([run(9, 'entera', 'success')], SHA).ok).toBe(true)
  })
})

// Julio, 21/10: para una tanda vale cualquier entera en verde del mismo commit,
// también la que corre un PUSH porque el PR toca lo común (título «frente»).
// Los trabajos, los de dos runs reales del #245: el 736 (push que tocaba lo
// común: la entera en 2 trozos) y el 737 (la zona y la corta, en uno).
describe('la entera que elige un push por tocar lo común', () => {
  const T736 = ['plan', 'trozo 1/2', 'trozo 2/2', 'entera', 'aviso']
  const T737 = ['plan', 'trozo 1/1', 'entera', 'aviso']
  it('el 736 vale; el 737 (una parte, en un trozo) no', () => {
    expect(enteraEnVerde([run(736, 'frente', 'success')], SHA, { 736: T736 })).toMatchObject({ ok: true, run: { id: 736 } })
    expect(enteraEnVerde([run(737, 'frente', 'success')], SHA, { 737: T737 }).ok).toBe(false)
  })
  it('sin sus trabajos, un «frente» no cuenta (como antes)', () => {
    expect(enteraEnVerde([run(736, 'frente', 'success')], SHA).ok).toBe(false)
  })
  it('en rojo no vale, y lo dice', () => {
    expect(enteraEnVerde([run(736, 'frente', 'failure')], SHA, { 736: T736 }).porque).toMatch(/en failure \(run 736\)/)
  })
})
