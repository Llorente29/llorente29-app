// tests/unit/e2e/carrilReserva.test.ts
//
// N11 (20/11) · El carril es de quien tiene su RESERVA con latido, no solo de quien sujeta el
// cerrojo (4203, N). Contra un Postgres DE VERDAD (regla 31), con el carril.sh, el
// guardian_e2e.sql y el reserva_carril.sql de verdad. Lo que pasó el 19/11: staging se reinició a
// las 22:22, el guardián de la entera de r08 perdió su conexión (y con ella el cerrojo del carril
// 1), a las 22:32 la e2e de x10d cogió el carril 1 y lo borró, y una docena de ficheros cayó con
// «No se pudo entrar como …carril-1…: HTTP 400». Aquí el reinicio es terminar en el servidor la
// conexión del guardián:
//   · el siguiente NO coge ese carril (sigue reservado) y coge otro;
//   · el latido sigue después del corte;
//   · si el job muere de verdad (sin latido), la reserva caduca y el carril se puede coger;
//   · soltar no borra un carril que ya es de otro.
// Con la caducidad y el latido cortos (6 s y 1 s) para que la prueba vaya rápido.

import { spawnSync } from 'node:child_process'
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
const PUERTO = String(58000 + Math.floor(Math.random() * 900))
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
const carpetas: string[] = []
const carpeta = () => { const c = mkdtempSync(join(tmpdir(), 'carril-')); carpetas.push(c); return c }
const entorno = (yo: string, cdir: string, extra: Record<string, string> = {}) => ({
  ...process.env, DB_URL: url(), PSQL: join(bin!, 'psql'), CARRIL_DIR: cdir, CARRIL_YO: yo, CARRIL_MAX: '2',
  CARRIL_RESERVA_CADUCA_S: String(CADUCA), CARRIL_LATIDO_S: '1', CARRIL_ESPERA_MIN: '1', CARRIL_BARRERA_MIN: '1',
  CARRIL_CERROJO_VIEJO: '0', ...extra,
})
const carril = (op: string, yo: string, cdir: string, extra: Record<string, string> = {}) =>
  spawnSync('bash', [join(raiz, 'scripts/e2e/carril.sh'), op], { encoding: 'utf8', env: entorno(yo, cdir, extra), timeout: 90_000 })
const numero = (cdir: string) => readFileSync(join(cdir, 'numero'), 'utf8').trim()
const pid = (cdir: string, f: string) => Number(readFileSync(join(cdir, f), 'utf8').trim())
/** El reinicio de staging, para un guardián: su conexión muere en el servidor (y con ella el cerrojo). */
const cortar = (cdir: string) => {
  const bpid = /^pid (\d+)/m.exec(readFileSync(join(cdir, 'guardian.log'), 'utf8'))![1]
  sql(`select pg_terminate_backend(${bpid})`)
}
const matar = (p: number) => { try { process.kill(p, 'SIGKILL') } catch { /* ya no estaba */ } }
const esperaMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!listo)('el carril: una reserva con latido que sobrevive a un reinicio (en un Postgres de verdad)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'carril-pg-'))
    if (comoPostgres) { chmodSync(dir, 0o777); chownSync(dir, 102, 104) }
    const ini = run(join(bin!, 'initdb'), ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'postgres', '--no-sync'])
    if (ini.status !== 0) throw new Error(ini.stderr)
    const arr = run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-o', `-k ${dir} -p ${PUERTO} -c listen_addresses='' -c fsync=off`, '-w', 'start', '-l', join(dir, 'log')])
    if (arr.status !== 0) throw new Error(arr.stderr || readFileSync(join(dir, 'log'), 'utf8'))
    // Como staging: sin las cuentas de producción.
    sql(`create table public.accounts (id uuid primary key)`)
  }, 60_000)

  afterAll(() => {
    for (const c of carpetas) for (const f of ['carril.latido', 'guardian.pid', 'barrera.latido']) if (existsSync(join(c, f))) matar(pid(c, f))
    if (dir) {
      run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
      rmSync(dir, { recursive: true, force: true })
    }
    for (const c of carpetas) rmSync(c, { recursive: true, force: true })
  })

  it('el 19/11, otra vez: el guardián pierde su conexión y el siguiente coge OTRO carril; el latido sigue; soltar no borra uno ajeno', async () => {
    const a = carpeta(), b = carpeta(), c = carpeta()
    const ra = carril('coger', 'run 44615857390 · trozo 2/2 · r08', a)
    expect(ra.status, ra.stdout + ra.stderr).toBe(0)
    expect(numero(a)).toBe('1')
    expect(sql(`select numero || ' ' || quien from e2e_carril.carril`)).toBe('1 e2e-carril run 44615857390 · trozo 2/2 · r08')

    // Staging se reinicia: muere la conexión del guardián y con ella el cerrojo (4203, 1).
    cortar(a)
    await esperaMs(500)
    expect(sql(`select count(*) from pg_locks where locktype = 'advisory' and classid = 4203 and objid = 1 and granted`)).toBe('0')

    // La e2e de x10d llega: el carril 1 sigue reservado, coge el 2 (antes cogía el 1 y lo borraba).
    const rb = carril('coger', 'run 44629118563 · x10d', b)
    expect(rb.status, rb.stdout + rb.stderr).toBe(0)
    expect(numero(b)).toBe('2')

    // El latido de A sigue después del corte: su reserva no caduca.
    await esperaMs((CADUCA + 2) * 1000)
    expect(sql(`select count(*) from e2e_carril.carril where numero = 1 and latido_at > now() - interval '3 seconds'`)).toBe('1')

    // Un tercero no encuentra sitio, y se le dice quién los tiene.
    const rc = carril('coger', 'run 3 · otro', c, { CARRIL_ESPERA_MIN: '0' })
    expect(rc.status).toBe(1)
    expect(rc.stdout + rc.stderr).toMatch(/Los 2 carriles siguen cogidos tras 0 min de espera\. Los tienen: carril 1: e2e-carril run 44615857390 · trozo 2\/2 · r08 · latido hace \d+ s \| carril 2: e2e-carril run 44629118563 · x10d · latido hace \d+ s/)

    // Si el carril 1 ya es de otro (su reserva se perdió en un corte largo y alguien lo cogió),
    // soltar no lo borra ni le quita la reserva.
    sql(`update e2e_carril.carril set id = gen_random_uuid(), quien = 'e2e-carril run 9 · otro' where numero = 1`)
    await esperaMs(2500)
    expect(existsSync(join(a, 'carril.perdido'))).toBe(true)
    const sa = carril('soltar', 'run 44615857390 · trozo 2/2 · r08', a)
    expect(sa.status, sa.stdout + sa.stderr).toBe(0)
    expect(sa.stdout).toContain('::warning::La reserva del carril 1 se perdió mientras corría: la tiene e2e-carril run 9 · otro.')
    expect(sa.stdout).toContain('::warning::El carril 1 lo tiene ahora e2e-carril run 9 · otro: no lo borro')
    expect(sa.stdout).not.toMatch(/borrado|No se ha podido borrar/)
    expect(sql(`select quien from e2e_carril.carril where numero = 1`)).toBe('e2e-carril run 9 · otro')
  }, 90_000)

  it('el job muere de verdad (sin latido ni guardián): la reserva caduca y el carril se puede volver a coger', async () => {
    const b = carpetas[1], c = carpeta()
    // B muere: ni latido ni conexión.
    matar(pid(b, 'carril.latido'))
    cortar(b)
    matar(pid(b, 'guardian.pid'))
    sql(`delete from e2e_carril.carril where numero = 1`) // el 1, ocupado por un cerrojo de las ramas de antes
    const viejo = spawnSync('bash', ['-c', `"${join(bin!, 'psql')}" "${url()}" -X -q -c "select pg_advisory_lock(4203, 1), pg_sleep(60)" > /dev/null 2>&1 &`], { encoding: 'utf8' })
    expect(viejo.status).toBe(0)
    await esperaMs(1000)
    const t0 = Date.now()
    const rc = carril('coger', 'run 4 · después', c)
    expect(rc.status, rc.stdout + rc.stderr).toBe(0)
    // El 1 lo tiene una rama de antes (solo cerrojo): no se coge. El 2, cuando caduca su reserva.
    expect(numero(c)).toBe('2')
    expect(Date.now() - t0).toBeLessThan((CADUCA + 20) * 1000)
    const sc = carril('soltar', 'run 4 · después', c)
    expect(sc.status, sc.stdout + sc.stderr).toBe(0)
    expect(sql(`select count(*) from e2e_carril.carril where numero = 2`)).toBe('0')
    sql(`select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and classid = 4203 and objid = 1`)
  }, 90_000)
})

describe('el carril: los tiempos de verdad', () => {
  it('la reserva aguanta un reinicio de staging (el del 19/11 duró un minuto) y caduca antes de lo que espera el siguiente', () => {
    const sh = readFileSync(join(raiz, 'scripts/e2e/carril.sh'), 'utf8')
    const caduca = Number(/CADUCA_CARRIL_S=\$\{CARRIL_RESERVA_CADUCA_S:-(\d+)\}/.exec(sh)?.[1])
    const latido = Number(/LATIDO_S=\$\{CARRIL_LATIDO_S:-(\d+)\}/.exec(sh)?.[1])
    const espera = Number(/ESPERA_MIN=\$\{CARRIL_ESPERA_MIN:-(\d+)\}/.exec(sh)?.[1])
    expect(caduca).toBeGreaterThanOrEqual(180)
    expect(latido).toBeLessThan(caduca / 4)
    expect(caduca + 15).toBeLessThan(espera * 60)
  })
})
