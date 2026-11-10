// GD · nº84 · «Volver a empezar», la parte de Sumied, por tandas. El 10/11 a las 07:48 UTC vaciar la demo de una
// vez pasó de los 8 s que la base deja a cada llamada de la plataforma («canceling statement due to statement
// timeout»), y el run del vídeo salió en verde con el fallo escondido en el registro. Lo que se vigila aquí:
//   · el paso «sumied» llama a la función por tandas con un presupuesto lejos de los 8 s y dice «sigue»;
//   · cada tanda avanza (el tiempo solo corta cuando ya ha borrado algo), y la prueba de staging lo recorre;
//   · el guion del vídeo deja la señal de rojo y el workflow la convierte en un run en rojo.
// Las pruebas de la base (con 0 ms, 8 tandas) están en supabase/staging/sql/20261110_gd_vaciar_por_tandas_prueba.sql.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SUMIED_MS, TANDAS_MAX } from '../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos'

const leer = (f: string) => readFileSync(f, 'utf8')

describe('GD · nº84 · el paso «sumied», por tandas', () => {
  it('cada tanda cabe holgada en los 8 s de la base', () => {
    expect(SUMIED_MS).toBeGreaterThan(0)
    expect(SUMIED_MS).toBeLessThanOrEqual(5000)
    expect(TANDAS_MAX).toBeGreaterThanOrEqual(4)
  })

  it('la función llama a la de tandas y pasa su «sigue» a quien pulsa', () => {
    const f = leer('supabase/functions/conta-gd-volver-a-empezar/index.ts')
    const caso = f.slice(f.indexOf("case 'sumied'"), f.indexOf("case 'leer'"))
    expect(caso).toContain("rpc('demo_gestoria_volver_a_empezar_tanda', { p_cuenta: cuenta, p_ms: SUMIED_MS })")
    expect(caso).toContain('sigue = d.sigue === true')
    expect(caso).not.toContain("rpc('demo_gestoria_volver_a_empezar',")
  })

  it('la base: solo la cuenta demo, y el tiempo corta solo cuando ya ha borrado algo', () => {
    const m = leer('supabase/migrations/20261110T0857_gd_vaciar_por_tandas.sql')
    expect(m).toContain('is_demo is true')
    expect(m).toContain("delete from public.%I where account_id = $1")
    expect(m).toMatch(/clock_timestamp\(\) >= v_hasta and v_total \+ v_en_pasada > 0/)
    expect(m).toContain('grant execute on function public.demo_gestoria_volver_a_empezar_tanda(uuid, int) to service_role')
    expect(m).toContain('revoke all on function public.demo_gestoria_volver_a_empezar_tanda(uuid, int) from public, anon, authenticated')
  })

  it('el vídeo: si «Volver a empezar» falla, el run sale en rojo', () => {
    const g = leer('scripts/video/gd/qbo.mjs')
    expect(g).toContain('volverFallo = true')
    expect(g).toMatch(/if \(volverFallo\) \{[\s\S]*writeFileSync\(ROJO/)
    const w = leer('.github/workflows/gd-video-qbo.yml')
    const paso = w.slice(w.indexOf('¿Volvió a empezar?'))
    expect(paso).toContain('if: always()')
    expect(paso).toContain('gd-qbo-rojo.txt')
    expect(paso).toContain('exit 1')
  })
})
