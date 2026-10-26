// tests/unit/e2e/transicion.test.ts
//
// W02 (1c, 16/10): mientras queden ramas con la e2e de antes —que corre en las
// cuentas de la plantilla y escribe en ellas con e2e.cerrojo cogido—, el clon
// de un carril coge también e2e.cerrojo, solo para el rato del clon. Contra un
// psql FALSO que apunta cada SQL: lo que importa es QUÉ pide y EN QUÉ ORDEN.

import { describe, it, expect, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(process.cwd(), 'scripts/e2e/carril.sh')
let dir = ''

function psqlFalso(escenario: 'libre' | 'ocupado') {
  const f = join(dir, 'psql')
  writeFileSync(f, `#!/usr/bin/env bash
sql=""; for a in "$@"; do [ "$prev" = "-c" ] && sql="$a"; prev="$a"; done
[ -z "$sql" ] && sql=$(cat)
printf '%s\\n----\\n' "$sql" >> "${dir}/sql.log"
case "$sql" in
  *"returning 'cogido'"*) [ "${escenario}" = libre ] && printf 'cogido\\nUPDATE 1\\n' || true ;;
  *"returning 'soltado'"*) printf 'soltado\\nUPDATE 1\\n' ;;
  *) echo "run 1 · conta/b02 · frente b · desde 21:00 · caduca 21:50" ;;
esac
`)
  chmodSync(f, 0o755)
  return f
}

function correr(orden: string, psql: string, extra: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, orden], {
    env: { ...process.env, PSQL: psql, DB_URL: 'postgres://falso', CARRIL_DIR: dir, CARRIL_YO: 'run 7/1 · trozo 1/2 · conta/w02', CARRIL_ESPERA_MIN: '1', ...extra },
    encoding: 'utf8',
  })
}
const sqls = () => (existsSync(join(dir, 'sql.log')) ? readFileSync(join(dir, 'sql.log'), 'utf8') : '')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'transicion-'))
  writeFileSync(join(dir, 'numero'), '3\n')
})

describe('la transición: el clon y la e2e de antes', () => {
  it('libre: coge e2e.cerrojo como «carril N clonando», con caducidad de 10 min', () => {
    const r = correr('plantilla-coger', psqlFalso('libre'))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Ninguna e2e de antes escribe en la plantilla')
    expect(sqls()).toContain('update e2e.cerrojo')
    expect(r.stdout).toContain('carril 3 clonando · run 7/1 · trozo 1/2 · conta/w02')
  })

  it('ocupado por una e2e de antes: espera y, si no se suelta, falla en rojo (no clona encima)', () => {
    const r = correr('plantilla-coger', psqlFalso('ocupado'), { CERROJO_PAUSA: '0' })
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain('el cerrojo lo tiene run 1 · conta/b02')
    expect(r.stdout).toContain('Una e2e de las de antes lleva 1 min escribiendo en la plantilla')
  })

  it('soltar lo suelta solo si es suyo (el mismo «quién» que al cogerlo)', () => {
    const r = correr('plantilla-soltar', psqlFalso('libre'))
    expect(r.status).toBe(0)
    expect(sqls()).toMatch(/quien = null[\s\S]*quien = :'yo'/)
  })

  it('CARRIL_CERROJO_VIEJO=0 lo apaga: ni una consulta', () => {
    const r = correr('plantilla-coger', psqlFalso('ocupado'), { CARRIL_CERROJO_VIEJO: '0' })
    expect(r.status).toBe(0)
    expect(sqls()).toBe('')
  })

  it('el orden es el mismo en la e2e y en aplicar: primero (4202,0), luego e2e.cerrojo', () => {
    const wf = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
    const ap = readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')
    const sh = readFileSync(SCRIPT, 'utf8')
    // Desde el 26/10 el (4202,0) de la e2e es la barrera del clon (barrera-entrar), no el carril.
    expect(wf.indexOf('scripts/e2e/carril.sh coger')).toBeLessThan(wf.indexOf('scripts/e2e/carril.sh barrera-entrar'))
    expect(wf.indexOf('scripts/e2e/carril.sh barrera-entrar')).toBeLessThan(wf.indexOf('scripts/e2e/carril.sh plantilla-coger'))
    expect(wf.indexOf('scripts/e2e/carril.sh clonar')).toBeLessThan(wf.indexOf('scripts/e2e/carril.sh barrera-salir'))
    expect(wf.indexOf('scripts/e2e/carril.sh plantilla-coger')).toBeLessThan(wf.indexOf('scripts/e2e/carril.sh clonar'))
    expect(ap.indexOf('scripts/e2e/carril.sh migrar-coger')).toBeLessThan(ap.indexOf('scripts/e2e/cerrojo.sh coger'))
    // El clon lo suelta al acabar, bien o mal; soltar (if: always()) también.
    const clonar = sh.slice(sh.indexOf('\nclonar() {'), sh.indexOf('\nborrar() {'))
    expect(clonar.match(/plantilla_soltar/g)).toHaveLength(2)
    expect(sh.slice(sh.indexOf('\nsoltar() {'), sh.indexOf('\nmigrar_coger() {'))).toContain('plantilla_soltar')
  })
})
