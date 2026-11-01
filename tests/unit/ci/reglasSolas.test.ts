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
import { veredicto as veredictoAprobar } from '../../../scripts/ci/aprobar-desde-sesion.mjs'
import { analizarFichero, categoria, ordenesDePsql } from '../../../scripts/conta/produccion/analizar.mjs'
import { readdirSync } from 'node:fs'

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
  it('el ensayo de producción espera a la e2e de la rama nombrada (el real no), en un job aparte y fuera de la cola', () => {
    const t = wf('aplicar-produccion-conta')
    const espera = job(t, 'espera-e2e')
    expect(espera).toContain("if: inputs.modo == 'ensayo' && inputs.rama != ''")
    expect(espera).toContain('RAMA: ${{ inputs.rama }}')
    expect(espera).toContain('node scripts/ci/esperar-e2e.mjs 45')
    expect(espera).not.toContain('concurrency')
    expect(job(t, 'aplicar')).toMatch(/needs: \[espera-e2e\]/)
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

describe('regla T10 y W12b · el real lo aprueba Julio, y todo desde main', () => {
  it('el job que aplica toma el entorno según el modo: el ensayo, «produccion-ensayo»; el real y la vuelta atrás, «produccion»', () => {
    const t = wf('aplicar-produccion-conta')
    expect(job(t, 'aplicar')).toContain("environment: ${{ inputs.modo == 'ensayo' && 'produccion-ensayo' || 'produccion' }}")
    expect(t).not.toContain('\n  aprobacion:\n')
  })
  it('se lanza desde main, con la rama y su commit; el commit va en el nombre del run', () => {
    const t = wf('aplicar-produccion-conta')
    expect(t).toContain('run-name: "${{ inputs.modo }} · ${{ inputs.rama || github.ref_name }}')
    expect(t).toContain('${{ inputs.commit || github.sha }}"')
    expect(t).toContain('if [ "$GITHUB_REF_NAME" != "main" ]; then')
    // De la rama, solo datos; los guiones, de main.
    expect(t).toContain('git checkout "$COMMIT" -- supabase src scripts/conta/produccion/cuentas')
    expect(t).toContain('if [ "$ultimo" != "$COMMIT" ]; then')
  })
  it('el real busca un ensayo en verde LANZADO DESDE MAIN con el mismo nombre (rama y commit)', () => {
    const t = wf('aplicar-produccion-conta')
    expect(t).toContain('buscado="ensayo · ${propio#real · }"')
    expect(t).toContain('select(.head_branch == "main" and .display_title == $t)')
  })
  it('ningún job usa un secreto de producción sin su entorno (que solo admite main)', () => {
    const SECRETOS: Record<string, string[]> = {
      PROD_CONTA_DB_URL: ['produccion', 'produccion-ensayo'],
      PROD_CONTA_RO_DB_URL: ['lectura', 'produccion', 'produccion-ensayo'],
      SUPABASE_ACCESS_TOKEN: ['despliegue'],
      SUPABASE_SERVICE_KEY: ['despliegue'],
    }
    const malos: string[] = []
    for (const f of readdirSync('.github/workflows').filter((x) => x.endsWith('.yml'))) {
      const t = readFileSync(`.github/workflows/${f}`, 'utf8')
      const jobs = t.slice(t.indexOf('\njobs:\n')).split(/\n(?= {2}[A-Za-z0-9_-]+:\s*\n)/).slice(1)
      for (const texto of jobs) {
        const nombre = texto.match(/^ {2}([A-Za-z0-9_-]+):/)?.[1] ?? '?'
        const env = texto.match(/^ {4}environment: (.+)$/m)?.[1]?.trim() ?? ''
        for (const [s, validos] of Object.entries(SECRETOS)) {
          if (!texto.includes(`secrets.${s}`)) continue
          const ok = validos.some((v) => env === v || env.includes(`'${v}'`))
          if (!ok) malos.push(`${f} › ${nombre} usa ${s} con el entorno «${env || 'ninguno'}»`)
        }
      }
    }
    expect(malos).toEqual([])
  })
  it('las funciones a staging se despliegan desde main, nombrando la rama (sin push de ninguna rama)', () => {
    const t = wf('desplegar-funciones-staging-conta')
    expect(t).not.toMatch(/^  push:/m)
    expect(t).toContain('git checkout "$COMMIT" -- supabase/functions supabase/config.toml supabase/staging/funciones.txt')
    expect(job(t, 'desplegar')).toContain('environment: despliegue')
  })
})

describe('W12b · el analizador para las órdenes de psql', () => {
  it('cualquier línea que empiece por «\\», esté donde esté, con su número', () => {
    expect(ordenesDePsql('select 1;\n  \\connect otra\nselect 2;\n\\! env\n')).toEqual([
      { linea: 2, texto: '\\connect otra' }, { linea: 4, texto: '\\! env' },
    ])
    expect(ordenesDePsql("select '\\x';\ncreate function f() returns text language sql as $$ select 'a\\b' $$;")).toEqual([])
  })
  it('y BLOQUEA: no lo abre «autorizo»', () => {
    const ops = analizarFichero('x.sql', 'create table t(a int);\n\\connect otra\ninsert into t values (1);\n')
    const psql = ops.find((o) => o.accion === 'psql')!
    expect(psql.objeto).toBe('línea 2')
    expect(categoria(psql, { existe: () => false }).cat).toBe('bloquea')
  })
})

describe('W12b · una sesión no puede aprobar un real', () => {
  it('el guion da por buena la prueba solo si GitHub lo rechaza', () => {
    expect(veredictoAprobar(403, '123', 'Must have admin rights').ok).toBe(true)
    expect(veredictoAprobar(404, '123').ok).toBe(true)
    const mal = veredictoAprobar(200, '123')
    expect(mal.ok).toBe(false)
    expect(mal.mensaje).toContain('Una sesión HA PODIDO aprobar el real del run 123')
    expect(mal.mensaje).toContain('Qué hacer:')
  })
})

describe('regla T11 · datos personales', () => {
  it('pr-a-main lo mira en lo que añade el PR, sus commits y su descripción', () => {
    const t = wf('pr-a-main')
    expect(t).toContain('run: node scripts/ci/datos-personales.mjs "$BASE" "$HEAD"')
    expect(t).toContain('PR_CUERPO: ${{ github.event.pull_request.body }}')
  })
})
