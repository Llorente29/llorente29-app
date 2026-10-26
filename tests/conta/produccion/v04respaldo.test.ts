// tests/conta/produccion/v04respaldo.test.ts
//
// Respuesta 1 al V04 (27/10) · Que no se repita el ensayo #256. Una tanda que
// cambia en caliente una función que YA EXISTE tiene que guardar la de antes
// (_respaldar_funcion, antes del create or replace) y su .down.sql restaurarla
// de ahí (_restaurar_funcion). Una copia a mano escrita en el repositorio lleva
// \n, y la de producción puede llevar \r\n (fiscal_for_print: 31): la huella
// del ensayo sale distinta y para. El analizador lo para ANTES, con BLOQUEA.
// Y fiscal_for_print está en el camino del pedido: su tanda pide autorizo.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — módulo .mjs sin tipos
import { informe, respaldoDe, rutaDown } from '../../../scripts/conta/produccion/analizar.mjs'

type Informe = { markdown: string; ficheros: Record<string, string> }
const M = 'supabase/migrations/20261027T0100_x01_cambia_f.sql'
const D = 'supabase/vuelta-atras/20261027T0100_x01_cambia_f.down.sql'
const P = 'supabase/staging/sql/20261027_x01_prueba.sql'
const FIRMA = 'public.f_tique(text,uuid)'
const ctx = { tablas: [], funciones: [FIRMA], filas: {}, otras: {}, camino: { tablas: [], funciones: [] }, usos: {}, registro: [] }
const cab = `-- cambia: public.f_tique · prueba: ${P}\n`
const crea = `create or replace function public.f_tique(p_token text, p_sale uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;\n`
const guarda = `select public._respaldar_funcion('${FIRMA}', '20261027T0100_x01_cambia_f');\n`
const restaura = `select public._restaurar_funcion('${FIRMA}', '20261027T0100_x01_cambia_f');\n`
const copiaAMano = `create or replace function public.f_tique(p_token text, p_sale uuid) returns jsonb language sql as $$ select '{"antes":1}'::jsonb $$;\n`
const leerDe = (ficheros: Record<string, string>) => (r: string) => ficheros[r] ?? (r === P ? 'select public.f_tique(null, null);' : null)
const estado = (mig: string, down: string | null, c = ctx) =>
  (informe([M], c, {}, leerDe({ [M]: mig, ...(down == null ? {} : { [D]: down }) })) as Informe)

describe('V04 · Respuesta 1 · la vuelta atrás de una función que ya existe sale del respaldo', () => {
  it('guardada antes de cambiarla y restaurada en su .down.sql: sigue, y lo dice', () => {
    const r = estado(cab + guarda + crea, restaura)
    expect(r.ficheros[M]).toBe('sigue')
    expect(r.markdown).toContain('guardada y restaurada byte a byte')
  })
  it('con su vuelta atrás copiada a mano (lo del #256): BLOQUEA y dice qué falta', () => {
    const r = estado(cab + crea, copiaAMano)
    expect(r.ficheros[M]).toBe('bloquea')
    expect(r.markdown).toContain(`_respaldar_funcion('${FIRMA}'`)
    expect(r.markdown).toContain(`no la restaura del respaldo`)
  })
  it('guardada DESPUÉS de cambiarla (guardaría la nueva): BLOQUEA', () => {
    expect(estado(cab + crea + guarda, restaura).ficheros[M]).toBe('bloquea')
  })
  it('guardada, pero sin .down.sql que la restaure: BLOQUEA', () => {
    expect(estado(cab + guarda + crea, null).ficheros[M]).toBe('bloquea')
    expect(estado(cab + guarda + crea, '-- nada\n').ficheros[M]).toBe('bloquea')
  })
  it('un comentario que nombra la llamada no cuenta como llamada', () => {
    expect(estado(cab + `-- ${guarda}` + crea, restaura).ficheros[M]).toBe('bloquea')
  })
  it('una función que NO existe todavía (añade) no pide respaldo', () => {
    expect(estado(cab + crea, null, { ...ctx, funciones: [] }).ficheros[M]).toBe('sigue')
  })
  it('las migraciones que ya estaban en main el 26/10 no se miden con esta regla (lista congelada)', () => {
    expect(respaldoDe('supabase/migrations/20261208T0880_d07a_respaldo_antes_de_reenviar.sql', { objeto: FIRMA }, () => crea)).toBeNull()
    expect(respaldoDe(M, { objeto: FIRMA }, leerDe({ [M]: guarda + crea, [D]: restaura }))).toEqual({ guarda: true, restaura: true, down: D })
    expect(rutaDown(M)).toBe(D)
  })
  it('en el camino del pedido, además AUTORIZO', () => {
    const r = estado(cab + guarda + crea, restaura, { ...ctx, camino: { tablas: [], funciones: [FIRMA] } })
    expect(r.ficheros[M]).toBe('autorizo')
  })
})

describe('V04 · Respuesta 1 · la tanda de verdad (2309), con su contexto medido el 26/10 a las 23:37Z', () => {
  const dir = 'supabase/produccion/tandas/folvy/conta-v04-tique'
  const c = JSON.parse(readFileSync(`${dir}/contexto.json`, 'utf8'))
  const f = 'supabase/migrations/20261026T2309_v04_tique_serie_y_quien_factura.sql'
  it('fiscal_for_print está en el camino del pedido del workflow, y la tanda pide autorizo', () => {
    const wf = readFileSync('.github/workflows/aplicar-produccion-conta.yml', 'utf8')
    const re = new RegExp(/CAMINO_FUNCIONES: '([^']+)'/.exec(wf)![1])
    expect(re.test('public.fiscal_for_print(text,uuid)')).toBe(true)
    expect(re.test('public.fiscal_for_preview(uuid)')).toBe(false)
    expect(c.contexto.camino.funciones).toEqual(['public.fiscal_for_print(text,uuid)'])
    const r = informe([f], c.contexto, {}) as Informe
    expect(r.ficheros[f]).toBe('autorizo')
    expect(r.markdown).toContain('guardada y restaurada byte a byte')
  })
  it('el contexto es de este fichero, no de uno anterior', async () => {
    const { createHash } = await import('node:crypto')
    expect(c.tanda[f]).toBe(createHash('md5').update(readFileSync(f)).digest('hex'))
  })
})
