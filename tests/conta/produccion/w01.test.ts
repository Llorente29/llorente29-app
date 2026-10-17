// W01 · Desplegar con los negocios abiertos: la regla nueva del analizador.
//
// Cada caso es un fichero de ejemplo de tests/conta/produccion/w01/ y lo que
// existe en producción lo dice contexto-produccion-w01-20261008.json: la
// respuesta REAL de la consulta del workflow (sqlContexto) lanzada en solo
// lectura el 08/10 sobre esos mismos ficheros. sale tiene 13 475 filas y está
// en el camino del pedido; sales_day_summary también; rider_seen_at la leen
// cuatro funciones vivas. Nada de eso está inventado.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  // R9: una cuenta (scripts/conta/produccion/cuentas/*) no se apunta en $LOG:
  // el psql falso devuelve $CUENTA_SALIDA, lo que «medirían» las cuentas tras deshacer.
  const correr = (aplicados: string[], fallaEn = '', cuentas?: { antes: string; despues: string }) => {
    const dir = mkdtempSync(join(tmpdir(), 'w01-'))
    const psql = join(dir, 'psql')
    writeFileSync(psql, `#!/usr/bin/env bash
fs=(); prev=""; for a in "$@"; do [ "$prev" = "-f" ] && fs+=("$a"); prev="$a"; done
case "\${fs[0]:-}" in scripts/conta/produccion/cuentas/*) printf '%s\\n' "$CUENTA_SALIDA"; exit 0;; esac
txt=""; for x in "\${fs[@]}"; do case "$x" in supabase/*) txt="$txt $x";; *) txt="$txt $(tr -d '\\n' < "$x")";; esac; done
echo "-1:$([[ " $* " == *" -1 "* ]] && echo si || echo no)$txt" >> "$LOG"
[ -n "$FALLA_EN" ] && [[ "$txt" == *"$FALLA_EN"* ]] && exit 3
exit 0
`, { mode: 0o755 })
    const lista = join(dir, 'aplicados.txt'); writeFileSync(lista, aplicados.join('\n') + '\n')
    const informe = join(dir, 'informe.md'); writeFileSync(informe, '')
    const log = join(dir, 'log'); writeFileSync(log, '')
    const extra: Record<string, string> = {}
    if (cuentas) {
      extra.CUENTAS = join(dir, 'cuentas.txt'); writeFileSync(extra.CUENTAS, 'scripts/conta/produccion/cuentas/ventas-del-dia.sql\n')
      extra.CUENTAS_ANTES = join(dir, 'cuentas-antes.csv'); writeFileSync(extra.CUENTAS_ANTES, cuentas.antes)
      extra.CUENTA_SALIDA = cuentas.despues
      extra.CUENTAS_DESPUES = join(dir, 'cuentas-tras.csv')
    }
    let rc = 0
    try {
      execFileSync('bash', ['scripts/conta/produccion/deshacer.sh', lista], { env: { ...process.env, PSQL: psql, DB_URL: 'postgres://falsa', INFORME: informe, LOG: log, FALLA_EN: fallaEn, ...extra }, stdio: 'pipe' })
    } catch (e) { rc = (e as { status: number }).status }
    return { rc, llamadas: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean), informe: readFileSync(informe, 'utf8') }
  }
  const C04 = ['20261010T0100_c04_libro', '20261010T0110_c04_enlaces', '20261010T0120_c04_funciones', '20261010T0130_c04_lectura'].map((n) => `supabase/migrations/${n}.sql`)

  // Las cuentas, como las da ventas-del-dia.sql (sin el nombre del fichero: lo pone cuentas.sh).
  const ANTES = 'asientos de ventas · propuesto,24\nresúmenes del día · día entero,24\n'
  const CON_ANTES = ANTES.split('\n').filter(Boolean).map((l) => `ventas-del-dia,${l}`).join('\n') + '\n'

  it('los .down.sql corren en ORDEN INVERSO, cada uno en una transacción con la baja de su registro', () => {
    const r = correr(C04, '', { antes: CON_ANTES, despues: ANTES.trim() })
    expect(r.rc).toBe(0)
    expect(r.llamadas).toEqual([...C04].reverse().map((f) => {
      const n = f.replace(/^.*\//, '').replace(/\.sql$/, '')
      return `-1:si supabase/vuelta-atras/${n}.down.sql delete from supabase_migrations.schema_migrations where version = '${n}';`
    }))
    expect(r.informe).toContain('deshecho con `supabase/vuelta-atras/20261010T0100_c04_libro.down.sql`')
    expect(r.informe).toContain('**Sí: las cuentas salen iguales que antes de la tanda.**')
  })
  // R9 (13/10): los seis .down.sql salieron bien y los 24 asientos no volvieron;
  // el informe dijo «como antes» sin contar nada.
  it('deshecho sin error pero las cuentas NO salen iguales: sale con 3 y dice cuánto falta', () => {
    const r = correr(C04, '', { antes: CON_ANTES, despues: 'asientos de ventas · propuesto,0\nresúmenes del día · día entero,0' })
    expect(r.rc).toBe(3)
    expect(r.informe).toContain('| ventas-del-dia · asientos de ventas · propuesto | 24 | 0 | **-24** (faltan 24) |')
    expect(r.informe).toContain('**NO: deshecho sin error, pero las cuentas no salen iguales**')
    expect(r.informe).not.toContain('**Sí:')
  })
  it('sin lo que cuenta la tanda, no dice que está como antes: sale con 3', () => {
    const r = correr(C04)
    expect(r.rc).toBe(3)
    expect(r.llamadas).toHaveLength(4)
    expect(r.informe).toContain('**No se puede decir**')
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
  it('R9: «está como antes» solo cuando deshacer.sh lo ha contado (sale con 0), con las cuentas del «antes»', () => {
    const d = pasos[indice(/^Después · comprobación/)]
    expect(d).toContain('CUENTAS_ANTES: /tmp/cuentas-antes.csv')
    expect(d).toMatch(/case "\$rc" in\n\s+0\) echo "::error::Vuelta atrás hecha y contada: producción está como antes/)
    expect(d).not.toMatch(/if bash scripts\/conta\/produccion\/deshacer\.sh[^\n]*; then\n[^\n]*como antes/)
    expect(pasos[indice(/^Antes · D1/)]).toContain('bash scripts/conta/produccion/cuentas.sh /tmp/cuentas.txt /tmp/cuentas-antes.csv')
  })
  it('R9: «D1 y recuento» corre también cuando un real se deshace solo', () => {
    const p = pasos[indice(/^Después de la vuelta atrás/)]
    expect(p).toContain("(inputs.modo == 'vuelta_atras' || (inputs.modo == 'real' && steps.despues.outcome == 'failure'))")
    expect(p).toContain('recuento-serie.sql')
  })
  it('R9: el ensayo de la vuelta atrás cuenta dentro de su transacción y PARA si no sale igual', () => {
    const p = pasos[indice(/^ENSAYO · la vuelta atrás automática/)]
    expect(p).toContain('/tmp/cuentas-ensayo-atras.csv')
    expect(p).toContain('NO deja los datos como estaban')
    expect(p).toMatch(/así no se lanza el real\."\n\s+cat "\$INFORME" >> "\$GITHUB_STEP_SUMMARY"\n\s+exit 1/)
  })
  it('R9: el manifiesto se lee con manifiesto.sh, y en la tanda de aplicar las cuentas son obligatorias', () => {
    expect(texto).toContain('bash scripts/conta/produccion/manifiesto.sh "$M" /tmp/tanda.txt /tmp/cuentas.txt "$PAT" "$OBLIG"')
    expect(texto).toMatch(/M=supabase\/produccion\/aplicar\.txt; PAT='[^']+'; OBLIG=si/)
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

describe('R9 · el manifiesto declara qué cuenta (manifiesto.sh)', () => {
  const correr = (texto: string, oblig = 'si') => {
    const dir = mkdtempSync(join(tmpdir(), 'r9-'))
    const m = join(dir, 'm.txt'); writeFileSync(m, texto)
    try {
      const out = execFileSync('bash', ['scripts/conta/produccion/manifiesto.sh', m, join(dir, 't.txt'), join(dir, 'c.txt'), '^supabase/migrations/[A-Za-z0-9_./-]+\\.sql$', oblig], { encoding: 'utf8', stdio: 'pipe' })
      return { rc: 0, out, tanda: readFileSync(join(dir, 't.txt'), 'utf8'), cuentas: readFileSync(join(dir, 'c.txt'), 'utf8') }
    } catch (e) { const x = e as { status: number; stdout: string }; return { rc: x.status, out: x.stdout, tanda: '', cuentas: '' } }
  }
  const F = 'supabase/migrations/20261020T0140_libro_lectura_registro.sql'
  it('separa los ficheros de las cuentas', () => {
    const r = correr(`# tanda\n${F}\ncuenta: scripts/conta/produccion/cuentas/ventas-del-dia.sql\n`)
    expect(r.rc).toBe(0)
    expect(r.tanda).toBe(`${F}\n`)
    expect(r.cuentas).toBe('scripts/conta/produccion/cuentas/ventas-del-dia.sql\n')
  })
  it('sin cuentas, la tanda de aplicar PARA; la de vuelta atrás, no', () => {
    expect(correr(`${F}\n`).rc).toBe(1)
    expect(correr(`${F}\n`).out).toContain('no declara qué cuenta')
    expect(correr(`${F}\n`, 'no').rc).toBe(0)
  })
  it('una cuenta fuera de su carpeta, o que no existe, PARA', () => {
    expect(correr(`${F}\ncuenta: scripts/conta/agente-libro.sql\n`).rc).toBe(1)
    expect(correr(`${F}\ncuenta: scripts/conta/produccion/cuentas/no-existe.sql\n`).rc).toBe(1)
  })
})

describe('R9 · la tanda de producción en staging (real-con-fallo y real)', () => {
  const lineas = (f: string) => readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  // La tanda del R9 (ventas por plataforma): su copia, ya aplicada en producción.
  it('es la de producción (la de ventas por plataforma), en el mismo orden, con la 0125 de staging antes de la 0130 y las mismas cuentas', () => {
    const prod = lineas('tests/conta/produccion/tanda-ventas-plataforma-20261013.txt')
    const stg = lineas('supabase/staging/tanda-de-produccion.txt')
    expect(stg.filter((l) => !l.includes('/staging/'))).toEqual([...prod.filter((l) => !l.startsWith('cuenta:')), ...prod.filter((l) => l.startsWith('cuenta:'))])
    const i = stg.indexOf('supabase/staging/sql/20261020T0125_ventas_por_plataforma_regla_a.sql')
    expect(stg[i + 1]).toBe('supabase/migrations/20261020T0130_ventas_por_plataforma_rehacer.sql')
    expect(existsSync('supabase/staging/vuelta-atras/20261020T0125_ventas_por_plataforma_regla_a.down.sql')).toBe(true)
  })
  it('el script mira que no es producción antes de deshacer nada, y en real-con-fallo solo sale en verde si deshacer.sh sale con 0', () => {
    const sh = readFileSync('scripts/conta/produccion/real-en-staging.sh', 'utf8')
    expect(sh.indexOf("'51ad1792-6629-4ef7-833a-b57b09a86710'")).toBeLessThan(sh.indexOf('vuelta-atras.txt | while'))
    expect(sh).toContain('bash scripts/conta/produccion/deshacer.sh "$T/aplicados.txt"; rc=$?')
    expect(sh).toContain('[ "$rc" -eq 0 ] || ok=0')
  })
})

describe('R11 · paso 8 sobre la tanda del B01 (su copia, aplicada el 14/10), con su contexto medido', () => {
  it('los ocho «sigue» y ningún «autorizo»', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-b01-20261014.json',
      '--manifiesto=tests/conta/produccion/tanda-b01-20261014.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out.match(/_b01_[a-z_]+\.sql: sigue/g)).toHaveLength(8)
    expect(out).toContain('autorizo: (ninguno)')
  })
})

describe('R11 · paso 8 sobre la tanda de la C06b (0720, su copia, aplicada), con su contexto medido', () => {
  it('la 0720 sigue', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-c06b-validar-pdf-20261014.json',
      '--manifiesto=tests/conta/produccion/tanda-c06b-validar-pdf-20261014.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261111T0720_c06b_validar_con_pdf.sql: sigue')
  })
})

describe('R11 · paso 8 sobre la tanda del B01 «deshacer un extracto» (0180, su copia, aplicada), con su contexto medido', () => {
  it('20261101T0180 sigue', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-b01-extracto-deshacer-20261015.json',
      '--manifiesto=tests/conta/produccion/tanda-b01-extracto-deshacer-20261015.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261101T0180_b01_extracto_deshacer.sql: sigue')
  })
})

describe('R11 · paso 8 sobre la tanda de la C06b «incluye_recibidas» (0740, su copia, aplicada), con su contexto medido', () => {
  it('20261111T0740 sigue', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-c06b-r8-recibidas-20261015.json',
      '--manifiesto=tests/conta/produccion/tanda-c06b-r8-recibidas-20261015.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261111T0740_c06b_diez_autorizo_recibidas.sql: sigue')
  })
})

describe('R11 · paso 8 sobre la tanda del B01 «nunca una tarjeta entera» (0190 y 0191, su copia, aplicada), con su contexto medido', () => {
  it('la 0190 sigue y la 0191 pide autorizo', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-b01-tarjeta-oculta-20261015.json',
      '--manifiesto=tests/conta/produccion/tanda-b01-tarjeta-oculta-20261015.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261101T0190_b01_tarjeta_oculta.sql: sigue')
    expect(out).toContain('autorizo: 20261101T0191_b01_tarjeta_oculta_guardado.sql')
  })
})

describe('R11 · paso 8 sobre la tanda del D01 «liquidaciones por correo» (0100 y 0110, su copia, aplicada), con su contexto medido', () => {
  it('las dos siguen, sin «autorizo»', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-d01-liquidaciones-20261016.json',
      '--manifiesto=tests/conta/produccion/tanda-d01-liquidaciones-20261016.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261113T0100_d01_liquidaciones_correo.sql: sigue')
    expect(out).toContain('20261113T0110_d01_liquidaciones_direccion_foodint.sql: sigue')
    expect(out).toContain('autorizo: (ninguno)')
  })
})

describe('R11 · paso 8 sobre la tanda de la C06b «recibidas abiertas» (0760, su copia, aplicada), con su contexto medido', () => {
  it('la 0760 pide «autorizo» con su nombre', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-c06b-recibidas-abiertas-20261016.json',
      '--manifiesto=tests/conta/produccion/tanda-c06b-recibidas-abiertas-20261016.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261111T0760_c06b_diez_recibidas_abiertas_datos.sql: AUTORIZO')
    expect(out).toContain('autorizo: 20261111T0760_c06b_diez_recibidas_abiertas_datos.sql')
  })
})

describe('R11 · paso 8 sobre la tanda B02 · T1 «lo que entra» (0200, su copia, aplicada), con su contexto medido', () => {
  it('la 0200 sigue, sin «autorizo»', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-b02-entrada-20261016.json',
      '--manifiesto=tests/conta/produccion/tanda-b02-entrada-20261016.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261101T0200_b02_entrada.sql: sigue')
    expect(out).toContain('autorizo: (ninguno)')
  })
})

describe('R11 · paso 8 sobre la tanda de la C06b «promociones y envíos» (0100 y 0110, su copia, aplicada: run 38954792366), con su contexto medido', () => {
  it('las dos siguen, sin «autorizo»', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-c06b-promociones-envios-20261016.json',
      '--manifiesto=tests/conta/produccion/tanda-c06b-promociones-envios-20261016.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261116T0100_c06b_promociones_envios.sql: sigue')
    expect(out).toContain('20261116T0110_c06b_promociones_envios_datos.sql: sigue')
    expect(out).toContain('autorizo: (ninguno)')
  })
})

describe('R11 · paso 8 sobre la tanda del R03 «la dirección que no llega» (0300, 0310 y 0320, su copia, aplicada), con su contexto medido', () => {
  it('las tres, en el camino del pedido: autorizo con su nombre', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-r03-direccion-20261017.json',
      '--manifiesto=tests/conta/produccion/tanda-r03-direccion-20261017.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261118T0300_r03_direccion_incompleta.sql: AUTORIZO')
    expect(out).toContain('20261118T0310_r03_ticket_codigo_quien_reparte.sql: AUTORIZO')
    expect(out).toContain('20261118T0320_r03_entrega_datos.sql: AUTORIZO')
  })
})

describe('R11 · paso 8 sobre la tanda del M01 «Esperan» (0100, su copia, aplicada), con su contexto medido', () => {
  it('sigue, sin autorizo', () => {
    const out = execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', 'tests/conta/produccion/contexto-produccion-m01-esperan-20261017.json',
      '--manifiesto=tests/conta/produccion/tanda-m01-esperan-20261017.txt'], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('20261117T0100_m01_motivos_para_validar.sql: sigue')
    expect(out).toContain('autorizo: (ninguno)')
  })
})

describe('R11 · paso 8: la tanda viva, contra el contexto real medido para ESOS ficheros', () => {
  const correr = (fixture?: string) => {
    try { return { rc: 0, out: execFileSync('node', ['scripts/conta/produccion/analisis-tanda-viva.mjs', ...(fixture ? [fixture] : [])], { encoding: 'utf8', stdio: 'pipe' }) } }
    catch (e) { const x = e as { status: number; stdout: string; stderr: string }; return { rc: x.status, out: x.stdout + x.stderr } }
  }
  it('con los ficheros medidos, da el estado de cada uno y los «autorizo» (W02, el relevo del secreto del despacho: AUTORIZO)', () => {
    const r = correr()
    expect(r.rc).toBe(0)
    expect(r.out).toContain('20261120T0100_w02_secreto_despacho_relevo.sql: AUTORIZO')
    expect(r.out).toContain('autorizo: 20261120T0100_w02_secreto_despacho_relevo.sql')
  })
  it('si un fichero de la tanda no es el medido (otro md5), PARA y pide volver a medir', () => {
    const m = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-tanda-viva.json', 'utf8'))
    m.tanda['supabase/migrations/20261120T0100_w02_secreto_despacho_relevo.sql'] = '00000000000000000000000000000000'
    const f = join(mkdtempSync(join(tmpdir(), 'r11-')), 'ctx.json'); writeFileSync(f, JSON.stringify(m))
    const r = correr(f)
    expect(r.rc).toBe(1)
    expect(r.out).toContain('20261120T0100_w02_secreto_despacho_relevo.sql ha cambiado desde la medida')
  })
})
