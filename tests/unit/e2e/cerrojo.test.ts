// tests/unit/e2e/cerrojo.test.ts
//
// El cerrojo de las e2e (scripts/e2e/cerrojo.sh) contra un psql FALSO que
// contesta lo que contestó el de verdad el 13/10: «cogido» y, detrás,
// «UPDATE 1» (psql -A -t no quita la etiqueta). Con la comparación de antes, el
// run cogía el cerrojo, no se enteraba y lo renovaba cada 30 s durante una
// hora (lo encontró A; runs 38457338675 y 38457342932).

import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(process.cwd(), 'scripts/e2e/cerrojo.sh')
let dir = ''

/**
 * Un psql que apunta cada SQL que recibe (por la entrada o con -c) y contesta
 * según el escenario: «libre» (el UPDATE devuelve la fila), «ocupado» (nada) o «roto».
 */
function psqlFalso(escenario: 'libre' | 'ocupado' | 'roto') {
  const f = join(dir, 'psql')
  writeFileSync(f, `#!/usr/bin/env bash
sql=""; for a in "$@"; do [ "$prev" = "-c" ] && sql="$a"; prev="$a"; done
[ -z "$sql" ] && sql=$(cat)
printf '%s\\n----\\n' "$sql" >> "${dir}/sql.log"
case "${escenario}" in
  roto) exit 2 ;;
  ocupado) case "$sql" in *"returning 'cogido'"*) ;; *returning*) ;; *) echo "run 1 · conta/d01 · frente a · desde 21:00 · caduca 21:50" ;; esac ;;
  libre) case "$sql" in *"returning 'cogido'"*) printf 'cogido\\nUPDATE 1\\n' ;; *"returning 'soltado'"*) printf 'soltado\\nUPDATE 1\\n' ;; esac ;;
esac
`)
  chmodSync(f, 0o755)
  return f
}

function correr(orden: string, psql: string, extra: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, orden], {
    env: { ...process.env, PSQL: psql, DB_URL: 'postgres://falso', CERROJO_YO: 'run 9 · prueba · frente c', CERROJO_PAUSA: '0', ...extra },
    encoding: 'utf8',
  })
}
const sqls = () => readFileSync(join(dir, 'sql.log'), 'utf8').split('----\n').filter((x) => x.trim())

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cerrojo-')); writeFileSync(join(dir, 'sql.log'), '') })

describe('el cerrojo de las e2e', () => {
  it('el fallo del 13/10, reproducido: con «cogido» + «UPDATE 1», la comparación de antes NO casaba', () => {
    const antes = execFileSync('bash', ['-c', `r=$(printf 'cogido\\nUPDATE 1\\n'); [ "$(echo "$r" | tr -d '[:space:]')" = "cogido" ] && echo casa || echo no-casa`], { encoding: 'utf8' }).trim()
    expect(antes).toBe('no-casa')
  })

  it('libre: lo coge al PRIMER intento aunque psql saque la etiqueta, y no lo renueva', () => {
    const r = correr('coger', psqlFalso('libre'))
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('Cerrojo cogido (run 9 · prueba · frente c) en el intento 1.')
    expect(sqls().filter((s) => s.includes("returning 'cogido'"))).toHaveLength(1)
  })

  it('tiene un tiempo máximo: lo cogido caduca solo (50 min) y uno caducado se puede coger', () => {
    correr('coger', psqlFalso('libre'))
    const [sql] = sqls()
    expect(sql).toContain("make_interval(mins => :'minutos'::int)")
    expect(sql).toContain('hasta < now()')
    const r = spawnSync('bash', ['-c', `grep -o 'CERROJO_MINUTOS:-[0-9]*' ${SCRIPT}`], { encoding: 'utf8' })
    expect(r.stdout.trim()).toBe('CERROJO_MINUTOS:-50')
  })

  it('ocupado: espera, dice quién lo tiene, y a los N intentos para en rojo (no espera para siempre)', () => {
    const r = correr('coger', psqlFalso('ocupado'), { CERROJO_INTENTOS: '3' })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('Espera (1 de 3): el cerrojo lo tiene run 1 · conta/d01 · frente a')
    expect(r.stdout).toContain('3 intentos esperando el cerrojo de las e2e. No se lanza nada.')
    expect(sqls().filter((s) => s.includes("returning 'cogido'"))).toHaveLength(3)
  })

  it('soltar: solo lo suelta quien lo tiene, y lo dice', () => {
    const r = correr('soltar', psqlFalso('libre'))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Cerrojo soltado (run 9 · prueba · frente c).')
    expect(sqls()[0]).toContain("where id = 1 and quien = :'yo'")
  })

  it('soltar sin la base (run que falla o se cancela a medias): no rompe el final del run y avisa de que caduca solo', () => {
    const r = correr('soltar', psqlFalso('roto'))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('caduca solo a los 50 minutos')
  })

  // W02 (1c, 16/10): la e2e ya no lo coge (cada una tiene su carril). Mientras
  // queden ramas con la e2e de antes, lo coge quien aplica a staging, para no
  // entrar a mitad de una de ellas; y lo suelta pase lo que pase.
  it('aplicar-staging-conta lo coge antes de aplicar y lo suelta pase lo que pase; la e2e de carril, no', () => {
    const ap = readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')
    const coger = ap.indexOf('scripts/e2e/cerrojo.sh coger')
    expect(coger).toBeGreaterThan(0)
    expect(coger).toBeLessThan(ap.indexOf('- name: Aplicar, fichero a fichero'))
    const soltar = ap.slice(ap.indexOf('- name: Cerrojo de migrar · soltarlo'))
    expect(soltar.slice(0, 400)).toMatch(/if: always\(\)[\s\S]*scripts\/e2e\/cerrojo\.sh soltar/)
    // Como mucho 15 min (30 × 30 s): con la barrera de migrar cogida, cada
    // minuto aquí para a todas las e2e (V03, respuesta 6, 26/10).
    expect(ap.match(/CERROJO_INTENTOS: '30'/g)).toHaveLength(2)
    expect(ap).not.toMatch(/CERROJO_INTENTOS: '(?!30')/)
    const e2e = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
    expect(e2e).not.toContain('scripts/e2e/cerrojo.sh coger')
  })
})
