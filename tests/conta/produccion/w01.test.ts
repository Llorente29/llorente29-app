// W01 · Desplegar con los negocios abiertos: la regla nueva del analizador.
//
// Cada caso es un fichero de ejemplo de tests/conta/produccion/w01/ y lo que
// existe en producción lo dice contexto-produccion-w01-20261008.json: la
// respuesta REAL de la consulta del workflow (sqlContexto) lanzada en solo
// lectura el 08/10 sobre esos mismos ficheros. sale tiene 13 475 filas y está
// en el camino del pedido; sales_day_summary también; rider_seen_at la leen
// cuatro funciones vivas. Nada de eso está inventado.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — módulo .mjs sin tipos
import { archivosFront, cabecera, filtrarHistorial, informe, marcaHuella, sqlBaja, sqlRegistro, usosEnFront, versionDe } from '../../../scripts/conta/produccion/analizar.mjs'

type Informe = { markdown: string; ficheros: Record<string, string>; vatRateFor: string[] }
const DIR = 'tests/conta/produccion/w01'
const ctx = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-w01-20261008.json', 'utf8'))
const f = (n: string) => `${DIR}/${n}.sql`
const leer = (r: string) => { try { return readFileSync(r, 'utf8') } catch { return null } }
const estado = (ficheros: string[], usosFront = {}, l = leer) => (informe(ficheros, ctx, usosFront, l) as Informe).ficheros
const uno = (n: string, usosFront = {}, l = leer) => estado([f(n)], usosFront, l)[f(n)]
const md = (ficheros: string[], usosFront = {}) => (informe(ficheros, ctx, usosFront, leer) as Informe).markdown

describe('W01 · añadir pasa siempre, a cualquier hora', () => {
  it('una tabla sales_* NUEVA no está en el camino del pedido: la crea la tanda (el caso del 07/10)', () => {
    expect(uno('20261020T0100_tabla_sales_nueva')).toBe('sigue')
  })
  it('añadir una columna que admite vacío a sales_day_summary, que existe y SÍ está en el camino, pasa', () => {
    expect(ctx.camino.tablas).toContain('public.sales_day_summary')
    expect(uno('20261020T0110_columna_sales_day_summary')).toBe('sigue')
  })
  it('índice concurrently e insert … on conflict do nothing pasan', () => {
    expect(uno('20261020T0175_indice_concurrently')).toBe('sigue')
    expect(uno('20261020T0180_insert_do_nothing')).toBe('sigue')
  })
})

describe('W01 · destruir o mover: solo con autorizo, y borrar además sin usos y en su propia tanda', () => {
  it('drop column en una tabla del pedido que existe y se usa: BLOQUEA, con quién la usa, filas y bloqueo', () => {
    expect(uno('20261020T0120_quita_columna_pedido')).toBe('bloquea')
    const m = md([f('20261020T0120_quita_columna_pedido')])
    expect(m).toContain('13475 filas')
    expect(m).toContain('ACCESS EXCLUSIVE')
    expect(m).toContain('función orders_feed(uuid)')
  })
  it('…si nada la usara, quedaría en AUTORIZO (no sigue sola)', () => {
    const sinUsos = { ...ctx, usos: {} }
    const r = (informe([f('20261020T0120_quita_columna_pedido')], sinUsos, {}, leer) as Informe).ficheros
    expect(r[f('20261020T0120_quita_columna_pedido')]).toBe('autorizo')
  })
  it('…y con la expansión de la misma tabla en la misma tanda, BLOQUEA aunque nada la use: van en dos tandas', () => {
    const sinUsos = { ...ctx, usos: {} }
    const fs = [f('20261020T0125_expande_pedido'), f('20261020T0120_quita_columna_pedido')]
    const r = informe(fs, sinUsos, {}, leer) as Informe
    expect(r.ficheros[fs[1]]).toBe('bloquea')
    expect(r.markdown).toContain('van en dos tandas')
    expect(r.ficheros[fs[0]]).toBe('sigue')
  })
  it('el front cuenta como uso: una ruta de src/ que la lee bloquea igual', () => {
    const sinUsos = { ...ctx, usos: {} }
    const r = informe([f('20261020T0120_quita_columna_pedido')], sinUsos, { 'public.sale.rider_seen_at': ['src/x.ts'] }, leer) as Informe
    expect(r.ficheros[f('20261020T0120_quita_columna_pedido')]).toBe('bloquea')
    expect(r.markdown).toContain('front src/x.ts')
  })
  it('update masivo: AUTORIZO, con filas y bloqueo', () => {
    expect(uno('20261020T0130_update_masivo')).toBe('autorizo')
    expect(md([f('20261020T0130_update_masivo')])).toContain('88 filas · bloqueo ROW EXCLUSIVE')
  })
  it('índice sin concurrently en sale (camino del pedido, aunque tenga 13 475 filas): AUTORIZO', () => {
    expect(uno('20261020T0170_indice_sin_concurrently')).toBe('autorizo')
  })
  it('insert … on conflict do update reescribe filas: AUTORIZO', () => {
    expect(uno('20261020T0185_insert_do_update')).toBe('autorizo')
  })
})

describe('W01 · cambiar en caliente: declarado en la cabecera y con prueba de staging', () => {
  it('función reemplazada con la misma firma, con cabecera y prueba que la nombra: pasa', () => {
    expect(cabecera(readFileSync(f('20261020T0140_funcion_misma_firma'), 'utf8'))).toEqual([
      { objeto: 'public.conta_reabrir_mes', prueba: 'supabase/staging/sql/20261010_c04_prueba_libro.sql' },
    ])
    expect(readFileSync('supabase/staging/sql/20261010_c04_prueba_libro.sql', 'utf8')).toMatch(/\bconta_reabrir_mes\b/)
    expect(uno('20261020T0140_funcion_misma_firma')).toBe('sigue')
  })
  it('la misma, sin cabecera: BLOQUEA (no lo abre autorizo; se arregla el fichero)', () => {
    expect(uno('20261020T0141_funcion_sin_cabecera')).toBe('bloquea')
  })
  it('la misma, con una prueba que no existe: BLOQUEA', () => {
    expect(uno('20261020T0142_funcion_prueba_inexistente')).toBe('bloquea')
  })
  it('una función del camino del pedido (kds_board), declarada y con prueba: además AUTORIZO', () => {
    const conPrueba = (r: string) => (r === 'supabase/staging/sql/20261020_prueba_kds_board.sql' ? 'select public.kds_board(null, null);' : leer(r))
    expect(ctx.camino.funciones).toContain('public.kds_board(uuid,text)')
    expect(uno('20261020T0160_funcion_camino', {}, conPrueba)).toBe('autorizo')
    expect(uno('20261020T0160_funcion_camino')).toBe('bloquea')
  })
  it('otra firma de una función que existe es una sobrecarga: BLOQUEA (regla 2: drop + create)', () => {
    expect(uno('20261020T0150_sobrecarga')).toBe('bloquea')
    expect(md([f('20261020T0150_sobrecarga')])).toContain('sobrecarga de public.conta_reabrir_mes(uuid,date,text)')
  })
})

describe('W01 · la tanda real del C04, con lo que existía antes de aplicarla', () => {
  // Población: existentes leídos por el ensayo del 07/10 a las 00:31 (run 37696691916).
  const ex = JSON.parse(readFileSync('tests/conta/produccion/existentes-produccion-c04-20261007.json', 'utf8'))
  const tanda = ['20261003T0130_c00_valores_de_serie', '20261010T0100_c04_libro', '20261010T0110_c04_enlaces', '20261010T0120_c04_funciones', '20261010T0130_c04_lectura'].map((n) => `supabase/migrations/${n}.sql`)
  const r = informe(tanda, { ...ex, camino: { tablas: [], funciones: [] } }, {}, leer) as Informe
  it('sales_day_summary (que la crea la 0100) ya no para por su nombre: no sale en ninguna línea que pare', () => {
    const bloqueC04 = r.markdown.split('### ').find((b) => b.startsWith(`\`${tanda[1]}\``))!
    expect(bloqueC04).not.toMatch(/\*\*(cambia|destruye|bloquea)\*\* [^\n]*sales_day_summary/)
  })
  it('pero con la regla nueva la 0100 BLOQUEA por otra cosa: cambia en caliente CHECK y disparador de fiscal_year sin declararlo', () => {
    expect(r.ficheros[tanda[1]]).toBe('bloquea')
    const bloqueC04 = r.markdown.split('### ').find((b) => b.startsWith(`\`${tanda[1]}\``))!
    expect(bloqueC04).toContain('**cambia** · añade · restriccion · `public.fiscal_year`')
    expect(bloqueC04).toContain('falta la cabecera')
  })
  it('la C00 0130 bloquea igual (CHECK de expense_category sin cabecera) además de pedir autorizo por sus UPDATE; la C04 0120 bloquea por conta_reabrir_mes sin cabecera', () => {
    expect(r.ficheros[tanda[0]]).toBe('bloquea')
    expect(r.markdown).toContain('`public.expense_category` · drop constraint if exists expense_category_serie')
    expect(r.ficheros[tanda[3]]).toBe('bloquea')
    expect(r.markdown).toContain('`public.conta_reabrir_mes(uuid,date,text)` — reemplaza la función (misma firma)')
  })
})

describe('W01 · ya aplicado no se reaplica', () => {
  const tanda = [f('20261020T0100_tabla_sales_nueva'), f('20261020T0110_columna_sales_day_summary')]
  const md5 = (r: string) => createHash('md5').update(readFileSync(r)).digest('hex')
  it('la versión es el nombre entero sin .sql (los prefijos de fecha se repiten en 33 ficheros)', () => {
    expect(versionDe('supabase/migrations/20261010T0100_c04_libro.sql')).toBe('20261010T0100_c04_libro')
    expect(versionDe('supabase/vuelta-atras/20261010T0100_c04_libro.down.sql')).toBe('20261010T0100_c04_libro')
  })
  it('registrado con la MISMA huella: se descarta de la tanda', () => {
    const registro = [{ version: versionDe(tanda[0]), huella: marcaHuella(md5(tanda[0])) }]
    expect(filtrarHistorial(tanda, registro, md5)).toEqual({ pendientes: [tanda[1]], yaAplicados: [tanda[0]], distintos: [] })
  })
  it('registrado con OTRA huella (alguien cambió un fichero ya aplicado): para', () => {
    const registro = [{ version: versionDe(tanda[0]), huella: marcaHuella('0'.repeat(32)) }]
    const h = filtrarHistorial(tanda, registro, md5)
    expect(h.distintos).toEqual([{ f: tanda[0], registrada: '0'.repeat(32), actual: md5(tanda[0]) }])
    expect(h.yaAplicados).toEqual([])
  })
  it('una fila del conector con la misma versión pero sin huella cuenta como distinta, no como aplicada', () => {
    const h = filtrarHistorial(tanda, [{ version: versionDe(tanda[0]), huella: 'create table …' }], md5)
    expect(h.distintos.map((d: { f: string }) => d.f)).toEqual([tanda[0]])
  })
  it('sin registrar, pero todo lo que crea ya existe: BLOQUEA (el C03 del 07/10, con lo que leyó aquel ensayo)', () => {
    const ex = JSON.parse(readFileSync('tests/conta/produccion/existentes-produccion-c03-ya-aplicado-20261007.json', 'utf8'))
    const c03 = 'supabase/migrations/20261009T0100_c03_terceros.sql'
    const r = informe([c03], { ...ex, camino: { tablas: [], funciones: [] } }, {}, leer) as Informe
    expect(r.ficheros[c03]).toBe('bloquea')
    expect(r.markdown).toContain('parece aplicado antes de que hubiera historial')
  })
  it('el registro y la baja son SQL cerrado, con la huella dentro', () => {
    const h = md5(tanda[0])
    expect(sqlRegistro(tanda[0], h, 'run 1 · julio')).toBe(`insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ('20261020T0100_tabla_sales_nueva', 'tabla_sales_nueva', array['-- huella md5:${h}'], 'run 1 · julio');\n`)
    expect(sqlBaja('supabase/vuelta-atras/20261020T0100_tabla_sales_nueva.down.sql')).toBe("delete from supabase_migrations.schema_migrations where version = '20261020T0100_tabla_sales_nueva';\n")
    expect(() => sqlRegistro("x'; drop table y; --.sql", h, 'q')).toThrow()
  })
})

describe('W01 · el front, por búsqueda en el repositorio', () => {
  const d = [{ tipo: 'columna', tabla: 'public.supplier', columna: 'email', clave: 'public.supplier.email' },
    { tipo: 'funcion', funcion: 'public.orders_feed', clave: 'public.orders_feed' }]
  it('encuentra una columna solo en ficheros que también nombran su tabla, y una función por su nombre entrecomillado', () => {
    const u = usosEnFront(d, [
      { ruta: 'a.ts', texto: "supabase.from('supplier').select('id, email')" },
      { ruta: 'b.ts', texto: "const email = user.email" },
      { ruta: 'c.ts', texto: "supabase.rpc('orders_feed', { p })" },
    ])
    expect(u).toEqual({ 'public.supplier.email': ['a.ts'], 'public.orders_feed': ['c.ts'] })
  })
  it('sobre el front real: orders_feed se llama desde src/, y los tipos generados no cuentan', () => {
    const archivos = archivosFront('WORKTREE') as { ruta: string }[]
    expect(archivos.some((a) => a.ruta === 'src/types/database.ts')).toBe(false)
    expect(usosEnFront([d[1]], archivos)['public.orders_feed']?.length ?? 0).toBeGreaterThan(0)
  })
})
