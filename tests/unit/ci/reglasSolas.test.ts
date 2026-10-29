// tests/unit/ci/reglasSolas.test.ts
//
// W12 (29/10) · Las reglas que se comprueban solas: los guiones (sus decisiones
// y sus mensajes, en tres partes: qué ha pasado, dónde y qué hacer) y que cada
// workflow las lleve en su sitio.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { veredicto } from '../../../scripts/ci/sin-rebase.mjs'
import { enMarcha, mensajeTope } from '../../../scripts/ci/esperar-e2e.mjs'
import { decidir, mensaje as mensajeRojas } from '../../../scripts/e2e/dos-rojas.mjs'

const wf = (n: string) => readFileSync(`.github/workflows/${n}.yml`, 'utf8')
const job = (texto: string, nombre: string) => {
  const i = texto.indexOf(`\n  ${nombre}:\n`)
  const resto = texto.slice(i + 1)
  const fin = resto.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:\n/)
  return fin < 0 ? resto : resto.slice(0, fin + 1)
}

describe('regla T6 · dos e2e seguidas en rojo: la tercera no corre', () => {
  const r = (id: number, conclusion: string, status = 'completed') => ({ id, status, conclusion })
  it('para con las dos últimas acabadas en rojo, sin contar las canceladas ni la de ahora', () => {
    expect(decidir([r(9, '', 'in_progress'), r(8, 'failure'), r(7, 'cancelled'), r(6, 'failure'), r(5, 'success')], 9).para).toBe(true)
    expect(decidir([r(8, 'failure'), r(7, 'success'), r(6, 'failure')], 9).para).toBe(false)
    expect(decidir([r(8, 'failure')], 9).para).toBe(false)
  })
  it('una verde lanzada a mano rompe la racha (la cuenta como la última)', () => {
    expect(decidir([r(8, 'success'), r(7, 'failure'), r(6, 'failure')], 9).para).toBe(false)
  })
  it('el mensaje dice qué ha pasado, dónde (los dos enlaces) y qué hacer', () => {
    const m = mensajeRojas('claude/x', [r(8, 'failure'), r(6, 'failure')], 'https://github.com', 'o/r')
    expect(m).toContain('Las dos últimas e2e de la rama «claude/x» salieron en rojo')
    expect(m).toContain('https://github.com/o/r/actions/runs/8 y https://github.com/o/r/actions/runs/6')
    expect(m).toContain('Qué hacer: para y avisa a Julio')
  })
  it('va en el primer job de la e2e, solo en un push de una rama', () => {
    const plan = job(wf('e2e-staging-conta'), 'plan')
    expect(plan).toContain('run: node scripts/e2e/dos-rojas.mjs')
    expect(plan).toContain("if: github.event_name == 'push' && github.ref_name != 'main'")
  })
})

describe('regla T8 · merge, nunca rebase', () => {
  it('la historia sigue con «ahead» o «identical»; con «diverged» o «behind», en rojo', () => {
    expect(veredicto('ahead', 'a'.repeat(40), 'b'.repeat(40))).toBeNull()
    expect(veredicto('identical', 'a'.repeat(40), 'a'.repeat(40))).toBeNull()
    const m = veredicto('diverged', 'a'.repeat(40), 'b'.repeat(40), '123')!
    expect(m).toContain('La rama del PR se ha reescrito')
    expect(m).toContain('(ejecución 123)')
    expect(m).toContain('Qué hacer: en la rama de un PR, nunca rebase ni push forzado')
    expect(veredicto('behind', 'a'.repeat(40), 'b'.repeat(40))).not.toBeNull()
  })
  it('pr-a-main lo mira en cada push al PR', () => {
    const t = wf('pr-a-main')
    expect(t).toContain("if: github.event.action == 'synchronize'")
    expect(t).toContain('run: node scripts/ci/sin-rebase.mjs "$ANTES" "$DESPUES"')
  })
})

describe('regla T9 · nunca una e2e y un ensayo a la vez en la misma rama', () => {
  it('cuenta lo que no ha acabado', () => {
    expect(enMarcha([{ id: 1, status: 'in_progress' }, { id: 2, status: 'completed' }, { id: 3, status: 'queued' }]).map((r) => r.id)).toEqual([1, 3])
  })
  it('el mensaje del tope dice qué ha pasado, dónde y qué hacer', () => {
    const m = mensajeTope('claude/x', 45, [{ id: 7 }], 'https://github.com', 'o/r')
    expect(m).toContain('sigue en marcha después de 45 minutos')
    expect(m).toContain('https://github.com/o/r/actions/runs/7')
    expect(m).toContain('Qué hacer: espera a que acabe')
  })
  it('el ensayo de producción espera (el real no), en un job aparte y fuera de la cola', () => {
    const t = wf('aplicar-produccion-conta')
    const espera = job(t, 'espera-e2e')
    expect(espera).toContain("if: inputs.modo == 'ensayo'")
    expect(espera).toContain('node scripts/ci/esperar-e2e.mjs 45')
    expect(espera).not.toContain('concurrency')
    expect(job(t, 'aplicar')).toMatch(/needs: \[espera-e2e, aprobacion\]/)
    expect(job(t, 'aplicar')).toContain('group: aplicar-produccion-conta')
    expect(t.slice(0, t.indexOf('\njobs:'))).not.toMatch(/\nconcurrency:/)
  })
  it('la prueba de staging desde una rama espera; desde main, no', () => {
    const t = wf('aplicar-staging-conta')
    expect(job(t, 'espera-e2e')).toContain("if: github.ref_name != 'main'")
    expect(job(t, 'aplicar')).toContain('needs: espera-e2e')
    expect(job(t, 'aplicar')).toContain('group: aplicar-staging-conta')
    expect(t.slice(0, t.indexOf('\njobs:'))).not.toMatch(/\nconcurrency:/)
  })
})

describe('regla T10 · el real lo aprueba Julio', () => {
  it('solo el job de la aprobación lleva el entorno «produccion», y solo en el real', () => {
    const t = wf('aplicar-produccion-conta')
    const ap = job(t, 'aprobacion')
    expect(ap).toContain("if: inputs.modo == 'real'")
    expect(ap).toContain('environment: produccion')
    expect(t.match(/environment: /g)).toHaveLength(1)
    expect(job(t, 'aplicar')).toContain("needs.aprobacion.result != 'failure'")
  })
})

describe('regla T11 · datos personales', () => {
  it('pr-a-main lo mira en lo que añade el PR, sus commits y su descripción', () => {
    const t = wf('pr-a-main')
    expect(t).toContain('run: node scripts/ci/datos-personales.mjs "$BASE" "$HEAD"')
    expect(t).toContain('PR_CUERPO: ${{ github.event.pull_request.body }}')
  })
})
