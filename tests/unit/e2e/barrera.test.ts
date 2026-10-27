// tests/unit/e2e/barrera.test.ts
//
// Respuesta 4 al V04 (27/10) · La barrera de staging, contra un Postgres DE
// VERDAD (regla 31), con el carril.sh y el barrera.sql de verdad:
//   · si el guardián muere a mitad de un fichero (su latido, con kill -9 y sin
//     soltar), la barrera se suelta sola y el siguiente entra en menos de 2 min;
//   · quien espera ve siempre quién la tiene, con su latido.
// Con la caducidad y el latido cortos (6 s y 2 s) para que la prueba vaya
// rápido; los de verdad (60 s y 15 s) se comprueban aparte: caben en 2 min.

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const raiz = resolve(__dirname, '../../..')
const bin = (() => {
  const base = '/usr/lib/postgresql'
  if (!existsSync(base)) return null
  const v = readdirSync(base).filter((d) => existsSync(join(base, d, 'bin', 'pg_ctl'))).sort().pop()
  return v ? join(base, v, 'bin') : null
})()
const listo = !!bin && spawnSync('psql', ['--version']).status === 0
const PUERTO = String(57000 + Math.floor(Math.random() * 900))
let dir = ''
const comoPostgres = userInfo().uid === 0
const run = (exe: string, args: string[]) =>
  comoPostgres ? spawnSync('runuser', ['-u', 'postgres', '--', exe, ...args], { encoding: 'utf8' }) : spawnSync(exe, args, { encoding: 'utf8' })
const url = () => `postgresql://postgres@/postgres?host=${dir}&port=${PUERTO}`
function sql(q: string): string {
  const r = spawnSync('psql', [url(), '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout.trim()
}
const CADUCA = 6
const entorno = (yo: string, cdir: string) => ({
  ...process.env, DB_URL: url(), PSQL: join(bin!, 'psql'), CARRIL_DIR: cdir, CARRIL_YO: yo,
  CARRIL_CADUCA_S: String(CADUCA), CARRIL_LATIDO_S: '2', CARRIL_BARRERA_MIN: '1', CARRIL_MIGRAR_MIN: '1',
})
const carril = (op: string, yo: string, cdir: string) =>
  spawnSync('bash', [join(raiz, 'scripts/e2e/carril.sh'), op], { encoding: 'utf8', env: entorno(yo, cdir) })
/** Lanza un carril.sh que espera (migrar-coger o barrera-entrar) y dice cuánto tardó en entrar. */
function esperar(op: string, yo: string, cdir: string): Promise<{ ms: number; salida: string; status: number | null }> {
  const t0 = Date.now()
  return new Promise((ok) => {
    const p = spawn('bash', [join(raiz, 'scripts/e2e/carril.sh'), op], { env: entorno(yo, cdir) })
    let salida = ''
    p.stdout.on('data', (d) => { salida += d })
    p.stderr.on('data', (d) => { salida += d })
    p.on('close', (status) => ok({ ms: Date.now() - t0, salida, status }))
  })
}
const matarLatido = (cdir: string, nombre: string) => {
  const pid = Number(readFileSync(join(cdir, `${nombre}.latido`), 'utf8').trim())
  process.kill(pid, 'SIGKILL')
}
const carpeta = () => mkdtempSync(join(tmpdir(), 'carril-'))
const esperaMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!listo)('la barrera de staging: reservas con latido (en un Postgres de verdad)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'barrera-'))
    if (comoPostgres) { chmodSync(dir, 0o777); chownSync(dir, 102, 104) }
    const ini = run(join(bin!, 'initdb'), ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'postgres', '--no-sync'])
    if (ini.status !== 0) throw new Error(ini.stderr)
    const arr = run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-o', `-k ${dir} -p ${PUERTO} -c listen_addresses='' -c fsync=off`, '-w', 'start', '-l', join(dir, 'log')])
    if (arr.status !== 0) throw new Error(arr.stderr || readFileSync(join(dir, 'log'), 'utf8'))
    // Como staging: sin las cuentas de producción.
    sql(`create table public.accounts (id uuid primary key)`)
  }, 60_000)

  afterAll(() => {
    if (!dir) return
    run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('un fichero dentro y otro a la vez: los dos entran (lee es compartida); al salir, la reserva se va', () => {
    const a = carpeta(), b = carpeta()
    expect(carril('barrera-entrar', 'run 1 · trozo 1/2 · fichero A', a).status).toBe(0)
    expect(carril('barrera-entrar', 'run 1 · trozo 2/2 · fichero B', b).status).toBe(0)
    expect(sql(`select count(*) from e2e_carril.barrera where estado = 'dentro' and modo = 'lee'`)).toBe('2')
    carril('barrera-salir', 'A', a); carril('barrera-salir', 'B', b)
    expect(sql(`select count(*) from e2e_carril.barrera`)).toBe('0')
  }, 30_000)

  it('el guardián de un fichero muere a mitad (sin soltar): quien migra entra en menos de 2 min, y mientras espera ve quién la tiene', async () => {
    const a = carpeta(), m = carpeta()
    expect(carril('barrera-entrar', 'run 2 · trozo 1/2 · d01/plataforma', a).status).toBe(0)
    const migra = esperar('migrar-coger', 'aplicar 631', m)
    await esperaMs(1500)
    // Mientras espera, la tabla dice quién la tiene y quién espera.
    expect(sql(`select string_agg(quien || ' ' || modo || ' ' || estado, ', ' order by desde) from e2e_carril.barrera`))
      .toBe('e2e-barrera run 2 · trozo 1/2 · d01/plataforma lee dentro, e2e-migrar aplicar 631 migra espera')
    matarLatido(a, 'barrera')
    const r = await migra
    expect(r.status, r.salida).toBe(0)
    expect(r.salida).toContain('Esperando a que acaben: e2e-barrera run 2 · trozo 1/2 · d01/plataforma · lee · latido hace')
    expect(r.ms).toBeLessThan(120_000)
    expect(r.ms).toBeLessThan((CADUCA + 10) * 1000)
    // Mientras migra, un fichero nuevo espera y ve quién la tiene; al soltar, entra.
    const b = carpeta()
    const fichero = esperar('barrera-entrar', 'run 2 · trozo 2/2 · d01/referencia', b)
    await esperaMs(1500)
    expect(sql(`select modo || ' ' || estado from e2e_carril.barrera order by desde`)).toBe('migra dentro\nlee espera')
    carril('migrar-soltar', 'aplicar 631', m)
    const f = await fichero
    expect(f.status, f.salida).toBe(0)
    carril('barrera-salir', 'B', b)
  }, 60_000)

  it('quien migra muere sin soltar: el fichero siguiente entra en menos de 2 min', async () => {
    const m = carpeta(), b = carpeta()
    expect(carril('migrar-coger', 'aplicar 632', m).status).toBe(0)
    matarLatido(m, 'migrar')
    const r = await esperar('barrera-entrar', 'run 3 · trozo 1/2 · d01/sin-plataformas', b)
    expect(r.status, r.salida).toBe(0)
    expect(r.ms).toBeLessThan((CADUCA + 10) * 1000)
    carril('barrera-salir', 'B', b)
  }, 60_000)

  it('quien no consigue la barrera dice cuánto esperó de verdad y quién la tenía', () => {
    const m = carpeta(), b = carpeta()
    expect(carril('migrar-coger', 'aplicar 633', m).status).toBe(0)
    const r = spawnSync('bash', [join(raiz, 'scripts/e2e/carril.sh'), 'barrera-entrar'], {
      encoding: 'utf8', env: { ...entorno('run 4 · fichero', b), CARRIL_BARRERA_MIN: '0' } })
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/Sin la barrera tras \d+ s: se está aplicando algo a staging\. La tienen: e2e-migrar aplicar 633 · migra · latido hace \d+ s/)
    carril('migrar-soltar', 'aplicar 633', m)
  }, 30_000)
})

describe('la barrera: los tiempos de verdad', () => {
  it('con la caducidad y el latido de verdad, el siguiente entra en menos de 2 min', () => {
    const sh = readFileSync(join(raiz, 'scripts/e2e/carril.sh'), 'utf8')
    const caduca = Number(/CADUCA_S=\$\{CARRIL_CADUCA_S:-(\d+)\}/.exec(sh)?.[1])
    const latido = Number(/LATIDO_S=\$\{CARRIL_LATIDO_S:-(\d+)\}/.exec(sh)?.[1])
    expect(latido).toBeLessThan(caduca / 2)
    // Lo peor: la reserva acaba de latir cuando muere (caduca entera) y quien
    // espera vuelve a mirar cada 2 s.
    expect(caduca + 2).toBeLessThan(120)
  })
})
