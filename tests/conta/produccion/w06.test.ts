// W06 (Julio, 26/10) · «Que staging cace lo mismo que el ensayo de producción».
//   · cuenta-crece.mjs: la regla de la revisión sobre las cuentas de las tandas,
//     contra la cuenta REAL que paró el #241 y contra las 79 que ya hay (regla 31).
//   · definiciones-comparar.mjs: la foto de las definiciones, antes y después.
//   · Los workflows: staging compara antes de que nada vaya de verdad, y el
//     ensayo de producción saca su tabla al registro del job.
// La prueba de verdad del comparador (una vuelta atrás buena y cuatro rotas a
// propósito) corre en staging: modo «compara-prueba» de aplicar-staging-conta.yml.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { creceSolo, ctes, tablas } from '../../../scripts/conta/produccion/cuenta-crece.mjs'
import { contraRegistro, delta, diferencias, leerCsv, leerFoto } from '../../../scripts/conta/staging/definiciones-comparar.mjs'

const CUENTAS = 'scripts/conta/produccion/cuentas'
const leer = (f: string) => readFileSync(f, 'utf8')

describe('cuenta-crece.mjs · una cuenta no mide algo que crece solo', () => {
  it('caza la cuenta del #241: «asientos (base entera)» lee journal_entry sin corte', () => {
    const r = creceSolo(leer('tests/conta/produccion/w06/cuenta-v02p-run241.sql'))
    const asientos = r.find((x) => x.medida === 'asientos (base entera)')
    expect(asientos?.tablas).toEqual(['public.journal_entry'])
  })

  it('con un corte de fecha fijo, pasa (las liquidaciones de Foodint de la cuenta de hoy)', () => {
    const r = creceSolo(leer(`${CUENTAS}/v02p-motor-por-tienda.sql`))
    expect(r.map((x) => x.medida)).not.toContain('liquidaciones de Foodint creadas hasta el 26/10 a las 06:00 UTC')
    // Las que siguen sin corte se dicen: las diferencias resueltas las escribe quien usa la pantalla.
    expect(r.map((x) => x.medida)).toEqual([
      'diferencias resueltas (base entera)', 'diferencias resueltas con su marca (base entera)', 'asientos de diferencias resueltas (base entera)',
    ])
  })

  it('el catálogo no crece solo: funciones, columnas, almacenes', () => {
    const sql = `select clave, valor from (
      select 1 o, 'huella' clave, (select md5(prosrc) from pg_proc where proname = 'x') valor union all
      select 2, 'columnas', (select count(*) from information_schema.columns where table_name = 'y')::text union all
      select 3, 'almacén', (select count(*) from storage.buckets where id = 'z')::text
    ) t order by o;`
    expect(creceSolo(sql)).toEqual([])
  })

  it('«-- quieta: <por qué>» dentro de la medida la deja pasar; sin motivo, no', () => {
    const sql = (c: string) => `select clave, valor from (
      select 1 o, 'filas' clave, (select count(*) from public.journal_entry ${c})::text valor
    ) t;`
    expect(creceSolo(sql('-- quieta: solo la escribe esta tanda\n'))).toEqual([])
    expect(creceSolo(sql('-- quieta:\n'))).toHaveLength(1)
  })

  it('una tabla que crea la propia tanda (mirada con to_regclass) no cuenta', () => {
    expect(creceSolo(leer(`${CUENTAS}/w06-compara-prueba.sql`))).toEqual([])
  })

  it('el corte también vale con between o con la fecha delante', () => {
    const sql = (w: string) => `select 1 o, 'n' clave, (select count(*) from public.sale where ${w})::text valor`
    expect(creceSolo(sql("sold_at between '2026-10-01' and '2026-10-26'"))).toEqual([])
    expect(creceSolo(sql("'2026-10-26'::timestamptz > created_at"))).toEqual([])
    expect(creceSolo(sql('created_at < now()'))).toHaveLength(1)
  })

  it('lo que no es una tabla no se cuenta como tabla: CTE, «is distinct from», extract, nombres partidos', () => {
    expect(ctes('with nuevas as (select 1), f as materialized (select 2) select 1')).toEqual(new Set(['nuevas', 'f']))
    expect(tablas("a is distinct from b.c".replace(/distinct\s+from/, 'distinct_de'))).toEqual([])
    expect(creceSolo(`select 1 o, 'x' clave, (select count(*) from public.t where to_regclass('public.t') is not null and extract(epoch from p.cuando) > 0)::text valor`)).toEqual([])
  })

  it('las 79 cuentas que ya hay: lo que avisa son tablas de verdad, nunca un nombre que no lo es (regla 31)', () => {
    const ficheros = readdirSync(CUENTAS).filter((f) => f.endsWith('.sql'))
    expect(ficheros.length).toBeGreaterThanOrEqual(79)
    const avisadas = new Set<string>()
    let medidas = 0
    for (const f of ficheros) for (const x of creceSolo(leer(join(CUENTAS, f)))) { medidas++; x.tablas.forEach((t: string) => avisadas.add(t)) }
    for (const t of avisadas) expect(t).toMatch(/^(public|vault|storage)\.([a-z_0-9]+(\(\))?|\* \(al vuelo\))$/)
    // Medido el 26/10: 305 medidas de 75 de los 79 ficheros. No se tocan: la
    // revisión solo mira las que un PR añade o cambia.
    expect(medidas).toBeGreaterThan(250)
  })
})

describe('definiciones-comparar.mjs · la foto, antes y después', () => {
  it('lee el CSV de psql: comas y comillas dentro, y el vacío sin comillas es «no existía»', () => {
    expect(leerCsv('a,"x, ""y"""\nb,\n"c\nd",z\n')).toEqual([['a', 'x, "y"'], ['b', null], ['c\nd', 'z']])
  })

  it('saca solo lo que cambia: lo nuevo, lo que ya no está y lo distinto', () => {
    const antes = leerFoto('índice public.a_idx,CREATE INDEX a_idx ON public.a USING btree (x)\nfunción f(),huella 1\ncolumna public.a.x,text\n')
    const despues = leerFoto('función f(),huella 2\ncolumna public.a.x,text\nalmacén w06-prueba,público false\n')
    expect(diferencias(antes, despues).map((x) => [x.clave, x.antes ?? '—', x.despues ?? '—'])).toEqual([
      ['almacén w06-prueba', '—', 'público false'],
      ['función f()', 'huella 1', 'huella 2'],
      ['índice public.a_idx', 'CREATE INDEX a_idx ON public.a USING btree (x)', '—'],
    ])
  })

  it('el registro de lo que va de verdad guarda cómo estaba antes, y se compara contra él', () => {
    const antes = leerFoto('función f(),huella 1\n')
    const con = leerFoto('función f(),huella 2\níndice public.b_idx,CREATE INDEX b_idx ON public.b USING btree (y)\n')
    const reg = delta(antes, con)
    expect(reg).toBe('"función f()","huella 1"\n"índice public.b_idx",\n')
    // Deshecho bien: vuelve. Deshecho a medias (el índice se queda): no vuelve.
    expect(contraRegistro(leerFoto('función f(),huella 1\n'), reg)).toEqual([])
    expect(contraRegistro(con, reg).map((x) => x.clave)).toEqual(['función f()', 'índice public.b_idx'])
  })
})

describe('los workflows', () => {
  const staging = leer('.github/workflows/aplicar-staging-conta.yml')
  const produccion = leer('.github/workflows/aplicar-produccion-conta.yml')

  it('staging compara la tanda de la rama ANTES de que nada vaya de verdad (W05)', () => {
    const compara = staging.indexOf('- name: Comparar como el ensayo de producción')
    const deVerdad = staging.indexOf('- name: Lo que solo añade, de verdad')
    expect(compara).toBeGreaterThan(0)
    expect(compara).toBeLessThan(deVerdad)
    expect(staging).toContain('bash scripts/conta/staging/compara.sh "$TANDA_PROD/aplicar.txt"')
    expect(staging).toContain('bash scripts/conta/staging/de-verdad.sh "$GITHUB_REF_NAME"')
    // El manifiesto fijo de antes del C10 ya no es lo que se compara.
    expect(staging.slice(compara, deVerdad)).not.toContain('tanda-de-produccion.txt')
  })

  it('la prueba del comparador: la buena en verde y las cuatro rotas en rojo', () => {
    expect(staging).toContain("for caso in buena rota-indice rota-columna rota-almacen rota-funcion")
    for (const c of ['buena', 'rota-indice', 'rota-columna', 'rota-almacen', 'rota-funcion']) {
      expect(readdirSync(`supabase/staging/compara-prueba/${c}`)).toEqual(['20261026T1500_w06_prueba.down.sql'])
    }
  })

  it('el ensayo de producción saca la tabla de la vuelta atrás al registro del job, sin cambiar lo que compara', () => {
    const paso = produccion.slice(produccion.indexOf('- name: ENSAYO · la vuelta atrás automática funcionaría'), produccion.indexOf('- name: REAL · fichero a fichero'))
    expect(paso).toContain('tail -n +"$desde" "$INFORME"')
    expect(paso).toContain('node scripts/conta/produccion/cuentas-comparar.mjs /tmp/cuentas-antes.csv /tmp/cuentas-ensayo-atras.csv "Antes de la tanda" "Tanda y vuelta atrás" > /tmp/cuentas-atras.md || igual=0')
  })
})
