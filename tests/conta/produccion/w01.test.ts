// W01 · Desplegar con los negocios abiertos: la regla nueva del analizador.
//
// Cada caso es un fichero de ejemplo de tests/conta/produccion/w01/ y lo que
// existe en producción lo dice contexto-produccion-w01-20261008.json: la
// respuesta REAL de la consulta del workflow (sqlContexto) lanzada en solo
// lectura el 08/10 sobre esos mismos ficheros. sale tiene 13 475 filas y está
// en el camino del pedido; sales_day_summary también; rider_seen_at la leen
// cuatro funciones vivas. Nada de eso está inventado.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('W01 · la vuelta atrás automática (deshacer.sh), con un psql falso que apunta lo que le piden', () => {
  // El psql falso: escribe en $LOG los -f que recibe (una línea por llamada) y
  // falla si alguno contiene $FALLA_EN. Así se ve el ORDEN y qué va en cada
  // transacción, sin base de datos.
  const correr = (aplicados: string[], fallaEn = '') => {
    const dir = mkdtempSync(join(tmpdir(), 'w01-'))
    const psql = join(dir, 'psql')
    writeFileSync(psql, `#!/usr/bin/env bash
fs=(); prev=""; for a in "$@"; do [ "$prev" = "-f" ] && fs+=("$a"); prev="$a"; done
txt=""; for x in "\${fs[@]}"; do case "$x" in supabase/*) txt="$txt $x";; *) txt="$txt $(tr -d '\\n' < "$x")";; esac; done
echo "-1:$([[ " $* " == *" -1 "* ]] && echo si || echo no)$txt" >> "$LOG"
[ -n "$FALLA_EN" ] && [[ "$txt" == *"$FALLA_EN"* ]] && exit 3
exit 0
`, { mode: 0o755 })
    const lista = join(dir, 'aplicados.txt'); writeFileSync(lista, aplicados.join('\n') + '\n')
    const informe = join(dir, 'informe.md'); writeFileSync(informe, '')
    const log = join(dir, 'log'); writeFileSync(log, '')
    let rc = 0
    try {
      execFileSync('bash', ['scripts/conta/produccion/deshacer.sh', lista], { env: { ...process.env, PSQL: psql, DB_URL: 'postgres://falsa', INFORME: informe, LOG: log, FALLA_EN: fallaEn }, stdio: 'pipe' })
    } catch (e) { rc = (e as { status: number }).status }
    return { rc, llamadas: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean), informe: readFileSync(informe, 'utf8') }
  }
  const C04 = ['20261010T0100_c04_libro', '20261010T0110_c04_enlaces', '20261010T0120_c04_funciones', '20261010T0130_c04_lectura'].map((n) => `supabase/migrations/${n}.sql`)

  it('los .down.sql corren en ORDEN INVERSO, cada uno en una transacción con la baja de su registro', () => {
    const r = correr(C04)
    expect(r.rc).toBe(0)
    expect(r.llamadas).toEqual([...C04].reverse().map((f) => {
      const n = f.replace(/^.*\//, '').replace(/\.sql$/, '')
      return `-1:si supabase/vuelta-atras/${n}.down.sql delete from supabase_migrations.schema_migrations where version = '${n}';`
    }))
    expect(r.informe).toContain('deshecho con `supabase/vuelta-atras/20261010T0100_c04_libro.down.sql`')
  })
  it('si una vuelta atrás falla, PARA ahí: no deshace las anteriores y lo dice en rojo', () => {
    const r = correr(C04, '20261010T0120_c04_funciones.down')
    expect(r.rc).toBe(1)
    expect(r.llamadas).toHaveLength(2)
    expect(r.informe).toContain('| 3 | `supabase/migrations/20261010T0120_c04_funciones.sql` | **la vuelta atrás FALLA: queda aplicado** |')
    expect(r.informe).toContain('| 1 | `supabase/migrations/20261010T0100_c04_libro.sql` | **queda aplicado** (la vuelta atrás paró antes) |')
  })
  it('un fichero sin .down.sql (la 0130 del C00) para la vuelta atrás antes de tocar nada de lo anterior', () => {
    const r = correr(['supabase/migrations/20261010T0100_c04_libro.sql', 'supabase/migrations/20261003T0130_c00_valores_de_serie.sql'])
    expect(r.rc).toBe(1)
    expect(r.llamadas).toEqual([])
    expect(r.informe).toContain('**sin vuelta atrás: queda aplicado**')
  })
})

describe('W01 · el workflow de producción: sin franja, y las guardas de siempre en su sitio', () => {
  const texto = readFileSync('.github/workflows/aplicar-produccion-conta.yml', 'utf8')
  const pasos = texto.split(/\n {6}- (?:name|uses): /).slice(1)
  const indice = (re: RegExp) => pasos.findIndex((p) => re.test(p))
  const conecta = (p: string) => /"\$PSQL" "\$(RO_)?DB_URL"|deshacer\.sh|agentes\.sh/.test(p)

  it('ya no hay franja ni campo fuera_de_ventana', () => {
    expect(texto).not.toMatch(/fuera_de_ventana|FUERA_PEDIDO|1215|00:30/)
    expect(texto).toContain("sin franja: W01")
  })
  it('guardas 1 y 2: la URL no es la de staging y sí la de producción, ANTES de cualquier conexión', () => {
    const g = indice(/^Guarda 1 y 2/)
    expect(g).toBeGreaterThanOrEqual(0)
    expect(pasos[g]).toContain('*"$STAGING_REF"*) echo "::error::La URL apunta a STAGING. Abortado sin conectar."; exit 1')
    expect(pasos[g]).toContain('*"$PROD_REF"*) echo "La URL es de producción."')
    expect(texto).toContain('PROD_REF: xzmpnchlguibclvxyynt')
    expect(pasos.findIndex(conecta)).toBeGreaterThan(g)
  })
  it('guarda 3: al otro lado está Foodint, antes de leer el contexto o aplicar nada', () => {
    const g = indice(/^Guarda 3 · al otro lado está Foodint/)
    expect(pasos[g]).toContain(`select count(*) from public.accounts where id = '$FOODINT'`)
    expect(texto).toContain('FOODINT: 51ad1792-6629-4ef7-833a-b57b09a86710')
    const primeraLecturaDeVerdad = pasos.findIndex((p, i) => i !== g && conecta(p))
    expect(primeraLecturaDeVerdad).toBeGreaterThan(g)
  })
  it('los agentes van con conta_lectura y la URL de producción', () => {
    expect(texto).toContain('if (u.username or "").split(".")[0] != "conta_lectura":')
  })
  it('el real aplica cada fichero con su registro en la misma transacción, y la comprobación llama a la vuelta atrás', () => {
    expect(texto).toContain('-1 -f "$f" -f /tmp/registro.sql')
    expect(texto).toContain('bash scripts/conta/produccion/deshacer.sh /tmp/aplicados.txt')
    expect(texto).toContain("echo 'rollback;'")
  })
})

// Cada caso lanza `node analizar.mjs front-compatible`, que lee el front de dos commits con git:
// tarda ~0,9 s solo, pero con toda la batería en paralelo pasó de los 5 s por defecto (08/10).
describe('W01 · front compatible en los dos sentidos (antes-de-subir)', { timeout: 30_000 }, () => {
  const correr = (m: string) => {
    try { return { rc: 0, out: execFileSync('node', ['scripts/conta/produccion/analizar.mjs', 'front-compatible', m], { encoding: 'utf8' }) } }
    catch (e) { const x = e as { status: number; stdout: string }; return { rc: x.status, out: x.stdout } }
  }
  it('una tanda que borra supplier.name, que el front lee (publicado y en este commit), PARA y dice dónde', () => {
    const r = correr('tests/conta/produccion/w01/manifiesto-front-leida.txt')
    expect(r.rc).toBe(1)
    expect(r.out).toMatch(/✗ public\.supplier\.name lo lee todavía el front de origin\/main \(publicado\): src\//)
    expect(r.out).toMatch(/✗ public\.supplier\.name lo lee todavía el front de este commit: src\//)
  })
  it('sale.rider_seen_at no la lee el front directamente (va por RPC): pasa aquí; la base ya la para por sus funciones', () => {
    const r = correr('tests/conta/produccion/w01/manifiesto-front-nadie.txt')
    expect(r.rc).toBe(0)
    expect(r.out).toContain('nadie lee public.sale.rider_seen_at')
  })
  it('la tanda viva no borra nada', () => {
    expect(correr('supabase/produccion/aplicar.txt').out).toContain('no borra ni renombra nada')
  })
})
