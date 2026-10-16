// tests/conta/staging/comparar.test.ts
//
// W02 (16/10): staging contra producción. Los casos son los que C encontró a
// mano el 16/10 en las dos bases (no inventados): order_for_print con una
// firma en cada lado, journal_entry_validar con otro cuerpo, sale_fire solo en
// staging, dosier_visita solo en producción y supplier.usual_vat_rates de más.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { comparar, corto, detalle, iguales, leerAceptadas, leerFoto, salida } from '../../../scripts/conta/staging/comparar.mjs'
import { filtrar } from '../../../scripts/conta/lib/salidaSegura.mjs'
import { sqlRegistroStaging } from '../../../scripts/conta/produccion/analizar.mjs'

const foto = (filas: string[][]) => leerFoto(filas.map((f) => f.join('\t')).join('\n'))
const H = (c: string) => c.repeat(32)

const PROD = foto([
  ['tabla', 'dosier_visita', H('1')],
  ['tabla', 'supplier', H('2')],
  ['columna', 'dosier_visita.id', H('3')],
  ['columna', 'supplier.id', H('4')],
  ['funcion', 'journal_entry_validar(p_entry uuid)', `${H('5')}|${H('6')}`],
  ['funcion', 'order_for_print(p_doc text, p_sale uuid)', `${H('7')}|${H('8')}`],
  ['funcion', 'upsert_pos_sale(p jsonb)', `${H('9')}|${H('a')}`],
  ['disparador', 'supplier.party_desde_proveedor', H('b')],
])
const STAG = foto([
  ['tabla', 'sale_fire', H('c')],
  ['tabla', 'supplier', H('d')],
  ['columna', 'sale_fire.id', H('e')],
  ['columna', 'supplier.id', H('4')],
  ['columna', 'supplier.usual_vat_rates', H('f')],
  ['funcion', 'journal_entry_validar(p_entry uuid)', `${H('0')}|${H('6')}`],
  ['funcion', 'order_for_print(p_doc text, p_sale uuid, p_device uuid)', `${H('7')}|${H('8')}`],
  ['funcion', 'upsert_pos_sale(p jsonb)', `${H('9')}|${H('0')}`],
  ['funcion', '_pos_table_sale(p_sale_id uuid)', `${H('1')}|${H('1')}`],
  ['disparador', 'supplier.party_desde_proveedor', H('b')],
])

describe('staging contra producción', () => {
  const difs = comparar(PROD, STAG)
  const de = (o: string, d: string) => difs.filter((x) => x.objeto === o && x.diferencia === d).map((x) => x.nombre)

  it('cada diferencia de C sale una vez, con su tipo', () => {
    expect(de('tabla', 'solo_produccion')).toEqual(['dosier_visita'])
    expect(de('tabla', 'solo_staging')).toEqual(['sale_fire'])
    expect(de('columna', 'solo_staging')).toEqual(['supplier.usual_vat_rates'])
    expect(de('funcion', 'cuerpo')).toEqual(['journal_entry_validar(p_entry uuid)'])
    expect(de('funcion', 'atributos')).toEqual(['upsert_pos_sale(p jsonb)'])
    // Una firma en cada lado: dos diferencias, no una «distinta».
    expect(de('funcion', 'solo_produccion')).toEqual(['order_for_print(p_doc text, p_sale uuid)'])
    expect(de('funcion', 'solo_staging')).toEqual(['_pos_table_sale(p_sale_id uuid)', 'order_for_print(p_doc text, p_sale uuid, p_device uuid)'])
  })

  it('una tabla de un solo lado no repite sus columnas', () => {
    expect(difs.some((d) => d.nombre.startsWith('dosier_visita.') || d.nombre.startsWith('sale_fire.'))).toBe(false)
  })

  it('lo igual se cuenta (la otra mitad del número)', () => {
    expect(iguales(PROD, STAG)).toEqual({ tabla: 0, columna: 1, funcion: 0, disparador: 1 })
  })

  it('aceptada por su nombre exacto: sale en «aceptadas», no en «rojas», y no se esconde', () => {
    const acep = leerAceptadas('funcion | solo_staging | _pos_table_sale(p_sale_id uuid) | en desarrollo: TPV de mesas\ntabla | solo_staging | sale_fire | en desarrollo\ntabla | solo_staging | ya_no_esta | vieja')
    const r = salida(difs, acep, iguales(PROD, STAG))
    expect(r.rojas).toHaveLength(difs.length - 2)
    expect(r.vistas).toHaveLength(2)
    const pasa = filtrar(r.texto)
    expect(pasa.retenidas).toBe(0)
    const claves = pasa.filas.map((f) => ('seccion' in f ? `# ${f.seccion}` : `${f.clave} ${f.valor}`))
    expect(claves).toContain(`rojas ${difs.length - 2}`)
    expect(claves).toContain('aceptadas 2')
    expect(claves).toContain('aceptadas_que_ya_no_hacen_falta 1')
    expect(claves).toContain('# aceptadas.funcion.solo_staging')
    // La clave empieza por letra aunque la función empiece por «_».
    expect(claves.some((c) => c.startsWith('f._pos_table_sale '))).toBe(true)
    expect(detalle(difs, acep)).toContain('| funcion | solo_staging | `_pos_table_sale(p_sale_id uuid)` |')
  })

  it('una aceptada sin motivo o mal escrita no se acepta: falla', () => {
    expect(() => leerAceptadas('tabla | solo_staging | sale_fire')).toThrow()
    expect(() => leerAceptadas('tablas | solo_staging | sale_fire | x')).toThrow()
    expect(() => leerAceptadas('tabla | cuerpo_x | sale_fire | x')).toThrow()
  })

  it('el nombre corto de una función es sin argumentos', () => {
    expect(corto({ objeto: 'funcion', diferencia: 'cuerpo', nombre: 'a_b(x int)' })).toBe('a_b')
  })

  it('la consulta no corta las firmas: la primera rama del union va en text, no en name (63 caracteres)', () => {
    const sql = readFileSync('scripts/conta/staging/comparar.sql', 'utf8')
    expect(sql).toMatch(/select 'tabla'::text as tipo, tabla::text as nombre/)
  })

  it('la lista de aceptadas del repositorio se lee sin errores', () => {
    expect(() => leerAceptadas(readFileSync('scripts/conta/staging/diferencias-aceptadas.txt', 'utf8'))).not.toThrow()
  })
})

describe('el registro de staging', () => {
  it('el mismo insert de producción, pero reaplicable (on conflict)', () => {
    const h = 'b806958a8ede95b3313f9a2ff00e0dd6'
    expect(sqlRegistroStaging('supabase/migrations/20261113T0100_c06b_centimo_iva.sql', h, 'staging aplicar · run 1 · conta/x')).toBe(
      "insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ('20261113T0100_c06b_centimo_iva', 'c06b_centimo_iva', array['-- huella md5:" + h + "'], 'staging aplicar · run 1 · contax') on conflict (version) do update set statements = excluded.statements, created_by = excluded.created_by;\n",
    )
  })

  it('aplicar-staging-conta aplica el fichero y su registro en la MISMA transacción', () => {
    const ap = readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')
    expect(ap).toMatch(/analizar\.mjs registro-staging "\$f"[^\n]*> \/tmp\/registro\.sql/)
    expect(ap).toContain('-1 -f "$f" -f /tmp/registro.sql')
    // Y compara con producción antes y después de la tanda, sin pararla.
    expect(ap).toMatch(/antes:\n[\s\S]*uses: \.\/\.github\/workflows\/comparar-staging-produccion\.yml/)
    expect(ap).toMatch(/aplicar:\n {4}needs: antes\n {4}if: \$\{\{ !cancelled\(\) \}\}/)
  })

  it('real-en-staging quita el registro que puso el manifiesto antes de su insert de producción', () => {
    const r = readFileSync('scripts/conta/produccion/real-en-staging.sh', 'utf8')
    expect(r).toMatch(/created_by like 'staging aplicar%%'[\s\S]*analizar\.mjs registro "\$f"[^\n]*>> "\$T\/registro\.sql"/)
  })
})

describe('la huella del cuerpo, a los dos lados (16/10)', () => {
  // Las huellas REALES de las 15:42 del 16/10 (md5(prosrc), leídas a los dos
  // lados): staging tenía las de antes del céntimo; producción, las de 20261113T0100.
  const A = 'a'.repeat(32)
  const prod = foto([
    ['funcion', 'journal_entry_validar(p_entry uuid, p_quien_nombre text)', `798e4c431fe9d790288d974b7fe22431|${A}`],
    ['funcion', 'conta_propuesta_ventas_unidad(p_company uuid, p_location uuid, p_dia date, p_canal uuid, p_marca uuid)', `32bb2645585207249c7c46bd2100b119|${A}`],
    ['tabla', 'supplier', H('2')],
  ])
  const stag = foto([
    ['funcion', 'journal_entry_validar(p_entry uuid, p_quien_nombre text)', `72a4f4a090d3a739dbf1bad5813292cf|${A}`],
    ['funcion', 'conta_propuesta_ventas_unidad(p_company uuid, p_location uuid, p_dia date, p_canal uuid, p_marca uuid)', `78e1fc8ae374e9106ace62c6fd5b5536|${A}`],
    ['tabla', 'supplier', H('2')],
  ])

  it('cada función con otro cuerpo saca su huella en producción y en staging, por la puerta', () => {
    const r = salida(comparar(prod, stag), new Map(), iguales(prod, stag))
    const pasa = filtrar(r.texto)
    expect(pasa.retenidas).toBe(0)
    const v = Object.fromEntries(pasa.filas.filter((f) => 'clave' in f).map((f) => [(f as { clave: string }).clave, (f as { valor: string }).valor]))
    expect(v['f.journal_entry_validar.prod']).toBe('798e4c431fe9d790')
    expect(v['f.journal_entry_validar.stag']).toBe('72a4f4a090d3a739')
    expect(v['f.conta_propuesta_ventas_unidad.prod']).toBe('32bb2645585207249c7c46bd2100b119'.slice(0, 16))
    expect(v['f.conta_propuesta_ventas_unidad.stag']).toBe('78e1fc8ae374e910')
  })

  it('también en las aceptadas, y en el detalle del artefacto', () => {
    const acep = leerAceptadas('funcion | cuerpo | journal_entry_validar(p_entry uuid, p_quien_nombre text) | prueba')
    const difs = comparar(prod, stag)
    const pasa = filtrar(salida(difs, acep, iguales(prod, stag)).texto)
    expect(pasa.filas).toContainEqual({ clave: 'f.journal_entry_validar.stag', valor: '72a4f4a090d3a739' })
    expect(detalle(difs, acep)).toContain('| 798e4c431fe9d790 | 72a4f4a090d3a739 | prueba |')
  })

  it('lo que no es un cuerpo distinto no lleva huellas de cuerpo', () => {
    const solo = foto([['funcion', 'nueva()', `${A}|${A}`], ['tabla', 'x', H('1')]])
    const pasa = filtrar(salida(comparar(foto([['tabla', 'x', H('1')]]), solo), new Map(), {}).texto)
    expect(pasa.filas.some((f) => 'clave' in f && /\.(prod|stag)$/.test((f as { clave: string }).clave))).toBe(false)
  })
})
