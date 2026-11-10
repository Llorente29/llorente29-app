// GD · nº94 · La demo, definitiva:
//   1. «Volver a empezar» acaba dejando el portal de la demo preparado y el acceso de Tomás Ruiz listo;
//   2. la siembra solo deja cobros sueltos que nunca se pagan (Penniless): uno pagado deja una liquidación sin factura;
//   3. el «comprobar» escribe cada paso en el resumen, por la puerta de la demo.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PASOS, PORTAL_DE_LA_DEMO } from '../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos'
import { CLIENTES } from '../../../../../supabase/functions/_shared/gd/datos'

describe('GD · nº94 · la demo, definitiva', () => {
  it('«Volver a empezar» acaba con el portal de la demo preparado', () => {
    expect(PASOS.at(-1)?.id).toBe('portal')
    expect(PORTAL_DE_LA_DEMO.correo).toMatch(/\.example$/)
    const f = readFileSync('supabase/functions/conta-gd-volver-a-empezar/index.ts', 'utf8')
    const caso = f.slice(f.indexOf("case 'portal'"))
    expect(caso).toContain("rpc('conta_portal_demo_preparar', { p_cuenta: cuenta })")
    expect(caso).toContain("rpc('conta_portal_acceso_usuario', { p_acceso: acceso.id, p_user: usuario })")
    const guion = readFileSync('scripts/video/gd/qbo.mjs', 'utf8')
    expect(guion).toMatch(/PASOS_VOLVER = \[[^\]]*'cambios', 'portal'\]/)
  })

  it('la siembra solo deja cobros sueltos que nunca se pagan', () => {
    const sueltos = CLIENTES.filter((c) => c.gc?.suelto)
    expect(sueltos.length).toBeGreaterThan(0)
    for (const c of sueltos) expect(c.gc?.escenario).toBe('Penniless')
    expect(readFileSync('supabase/functions/_shared/gd/siembra.ts', 'utf8')).toContain("if (c.gc.escenario !== 'Penniless') throw")
  })

  it('el «comprobar» escribe cada paso en el resumen', () => {
    const g = readFileSync('scripts/video/gd/comprobar.mjs', 'utf8')
    for (const m of ['✓', '—', '!', '✗']) expect(g).toContain(`resumen.push(corta(\`${m} \${id}`)
    expect(g).toContain('...resumen].join')
  })
})
