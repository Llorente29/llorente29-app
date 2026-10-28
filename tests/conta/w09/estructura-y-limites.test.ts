// W09 (Julio, 28/10) · La estructura de staging sin datos, la base local, y
// psql con límite (el #728 esperó casi una hora a la red sin una consulta).
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buscarSecretos, limpiarVolcado, rolDelJwt, rolesDelVolcado } from '../../../scripts/staging/esquema.mjs'
import { CONECTAR_S, faltas, limiteDe, PASO_MIN, poner } from '../../../scripts/ci/limites-psql.mjs'

const jwt = (datos: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(datos)).toString('base64url')}.firmaDePruebaFirma`
const WF = readFileSync('.github/workflows/estructura-staging.yml', 'utf8')

describe('el volcado: limpio, sin secretos y con sus roles', () => {
  it('quita los \\restrict del pg_dump 17.6 y, para la 16, el transaction_timeout y el privilegio MAINTAIN', () => {
    const v = '\\restrict abc\nSET transaction_timeout = 0;\nCREATE TABLE public.x (id int);\nGRANT SELECT,TRUNCATE,MAINTAIN ON TABLE public.x TO anon;\nGRANT MAINTAIN ON TABLE public.x TO anon;\n\\unrestrict abc'
    expect(limpiarVolcado(v)).toBe('SET transaction_timeout = 0;\nCREATE TABLE public.x (id int);\nGRANT SELECT,TRUNCATE,MAINTAIN ON TABLE public.x TO anon;\nGRANT MAINTAIN ON TABLE public.x TO anon;')
    expect(limpiarVolcado(v, { para16: true })).toBe('CREATE TABLE public.x (id int);\nGRANT SELECT,TRUNCATE ON TABLE public.x TO anon;\n-- (sin MAINTAIN en la 16) GRANT MAINTAIN ON TABLE public.x TO anon;')
  })
  it('la clave anon no es secreto (la de tg_auto_dispatch); service_role, una URL con contraseña o una clave de Stripe, sí', () => {
    expect(rolDelJwt(jwt({ role: 'anon', ref: 'xzmpnchlguibclvxyynt' }))).toBe('anon')
    expect(buscarSecretos(`  headers := '{"apikey": "${jwt({ role: 'anon' })}"}'`)).toEqual([])
    expect(buscarSecretos(`x := '${jwt({ role: 'service_role' })}';`)[0].que).toContain('rol service_role')
    expect(buscarSecretos("x := 'postgresql://postgres:clave@db.ejemplo.co:5432/postgres';")).toHaveLength(1)
    expect(buscarSecretos("k := 'sk_live_abcdefghij1234';")).toHaveLength(1)
    expect(buscarSecretos('CREATE TABLE public.x (id int);')).toEqual([])
  })
  it('los roles que nombra, para crearlos antes de cargarlo', () => {
    const v = 'GRANT ALL ON TABLE public.x TO anon;\nGRANT SELECT ON TABLE public.x TO authenticated, service_role;\nALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;\nGRANT USAGE ON SCHEMA public TO PUBLIC;\nCREATE POLICY p ON public.x FOR SELECT TO dashboard_user USING (true);\n    select * from candidatos c join cab to_x on true where x in (select 1 from vendidas);'
    // Los «FROM x» de dentro de una función son tablas, no roles (el primer volcado sacaba 180).
    expect(rolesDelVolcado(v)).toEqual(['anon', 'authenticated', 'dashboard_user', 'postgres', 'service_role', 'supabase_admin'])
  })
})

describe('el workflow de la estructura', () => {
  it('solo estructura (--schema-only), y busca secretos ANTES de publicar', () => {
    expect(WF).toContain('--schema-only')
    expect(WF).not.toMatch(/--data-only|pg_dumpall|COPY /)
    expect(WF.indexOf('esquema.mjs secretos')).toBeLessThan(WF.indexOf('- name: Publicar en estructura/staging'))
  })
  it('después de cada aplicar de main en verde, a mano o al cambiar él mismo; y a la rama aparte, no a main', () => {
    expect(WF).toContain("workflows: ['Aplicar SQL en staging-conta']")
    expect(WF).toContain("github.event.workflow_run.conclusion == 'success'")
    expect(WF).toContain('git push -q origin "$COMMIT:refs/heads/estructura/staging"')
    expect(WF).not.toMatch(/HEAD:main|push origin main/)
  })
  it('el guion local trae la estructura de esa rama y no lleva ninguna URL de staging', () => {
    const g = readFileSync('scripts/staging/base-local.sh', 'utf8')
    expect(g).toContain('git show origin/estructura-staging:supabase/staging/esquema.sql')
    expect(g).not.toMatch(/oseymswjlzplqoxrfjzi|supabase\.co|DB_URL/)
  })
})

describe('psql con límite, en todos los workflows que tocan la base', () => {
  const ficheros = readdirSync('.github/workflows').filter((f) => f.endsWith('.yml'))
  const resultados = ficheros.map((f) => ({ f, r: faltas(readFileSync(`.github/workflows/${f}`, 'utf8')) }))

  it('cada uno lleva PGCONNECT_TIMEOUT arriba y cada paso que toca la base, su timeout (no mayor que el job)', () => {
    const conBase = resultados.filter(({ r }) => r.tocaLaBase)
    expect(conBase.length).toBeGreaterThanOrEqual(15)
    expect(resultados.flatMap(({ f, r }) => r.fuera.map((x) => `${f}: ${x.que}${x.paso ? ` («${x.paso}»)` : ''}`))).toEqual([])
  })
  it('el #728: el ensayo en ROLLBACK de staging ya no puede esperar una hora', () => {
    const aplicar = resultados.find(({ f }) => f === 'aplicar-staging-conta.yml')!.r
    const ensayo = aplicar.pasos!.find((p) => p.paso === 'Ensayar en ROLLBACK lo que añade la rama')!
    expect(ensayo.timeout).toBe(PASO_MIN)
    expect(readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')).toContain(`PGCONNECT_TIMEOUT: '${CONECTAR_S}'`)
  })
  it('si a un paso le quitan el límite, la comprobación lo dice; y poner lo vuelve a poner', () => {
    const original = readFileSync('.github/workflows/vigia-autoconteo.yml', 'utf8')
    const sin = original.replace(/\n {8}timeout-minutes: \d+(?=\n {8}env:\n {10}DB_URL)/, '')
    expect(sin).not.toBe(original)
    expect(faltas(sin).fuera.map((x) => x.que)).toContain('paso que toca la base sin timeout-minutes')
    expect(faltas(poner('vigia-autoconteo.yml', sin)).fuera).toEqual([])
  })
  it('los largos, nunca por encima de su job', () => {
    expect(limiteDe('e2e-staging-conta.yml', 'Pruebas (ordenador y móvil)', 120)).toBe(120)
    expect(limiteDe('carril-staging-conta.yml', 'Carril · esperar su turno y coger uno', 20)).toBe(20)
    expect(limiteDe('x.yml', 'cualquiera', 10)).toBe(10)
    expect(limiteDe('x.yml', 'cualquiera', 60)).toBe(PASO_MIN)
  })
})
