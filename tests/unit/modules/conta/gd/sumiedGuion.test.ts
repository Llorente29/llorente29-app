// GD · nº96, fase 3, y nº98 · El vídeo de Sumied para gestorías con la máquina del V01:
//   · cada frase aprobada tiene su gesto en el guion (di), y las tarjetas (portada y cierre) las pone el montaje;
//   · en ensayo no escribe: lo que escribe pasa por pulsaQueEscribe, y Stripe, la validación y el envío, solo grabando;
//   · los subtítulos, dos líneas como mucho (se ve en el móvil);
//   · «Volver a empezar» deja también el acceso de Felipe Herrera para Electricidad Voltio (el devuelto del portal).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FRASES } from '../../../../../scripts/video/gd/locucion.mjs'
import { trozos } from '../../../../../scripts/video/subtitulos.mjs'
import { ACCESOS_DE_LA_DEMO, PORTAL_DEL_DEVUELTO } from '../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos'

const g = readFileSync('scripts/video/gd/sumied.mjs', 'utf8')

describe('GD · el vídeo de Sumied para gestorías', () => {
  it('cada frase tiene su gesto en el guion; portada y cierre, en el montaje', () => {
    for (const id of Object.keys(FRASES)) {
      if (id === 'portada' || id === 'cierre') continue
      const pegada = g.includes(`di('${id}'`) || new RegExp(`\\['\\d', '${id.replace('.', '\\.')}'\\]`).test(g)
      expect(pegada, `la frase ${id} no tiene gesto`).toBe(true)
    }
    expect(g).toContain("tarjeta(navegador, join(salida, 'portada.png'), 'Sumied para gestorías')")
    expect(g).toContain("tarjeta(navegador, join(salida, 'cierre.png'), 'Sumied para gestorías')")
  })

  it('en ensayo no escribe nada', () => {
    expect(g).toMatch(/async function pulsaQueEscribe[\s\S]*?if \(GRABA\) await ra\.clic\(l, ms\); else await ra\.a\(l, ms\)/)
    for (const b of ['Preparar el cobro', 'Este mes no', '/^Aprobar']) expect(g).toMatch(new RegExp(`pulsaQueEscribe\\([^\\n]*${b.replace(/[/^]/g, (c) => `\\${c}`)}`))
    expect(g).toMatch(/if \(GRABA && enviado\) \{\s*await R\.sinVer\(async \(\) => \{[\s\S]*?validarIngresosFacturados/)
    expect(g).toMatch(/if \(GRABA\) \{\s*\/\/ Julio \(nº98\): se paga con la tarjeta de pruebas de Stripe/)
    expect(g).toMatch(/await di\('06\.10', async \(\) => \{\s*if \(!GRABA\) return/)
  })

  it('subtítulos de dos líneas como mucho, con todas las frases', () => {
    for (const t of Object.values(FRASES)) {
      const ts = trozos(t)
      for (const x of ts) expect(x.texto.length).toBeLessThanOrEqual(94)
      expect(ts.map((x) => x.texto).join(' ')).toBe(t.split(/\s+/).join(' '))
      expect(ts[0].a).toBe(0); expect(ts.at(-1)?.b).toBe(1)
    }
  })

  it('«Volver a empezar» deja el acceso de Felipe Herrera, con su usuario', () => {
    expect(ACCESOS_DE_LA_DEMO.map((a) => a.persona)).toEqual(['Tomás Ruiz', 'Felipe Herrera'])
    expect(PORTAL_DEL_DEVUELTO.correo).toMatch(/\.example$/)
    const f = readFileSync('supabase/functions/conta-gd-volver-a-empezar/index.ts', 'utf8')
    expect(f).toContain('admin.auth.admin.createUser({ email: a.correo, email_confirm: true')
    expect(f).toContain("for (const a of ACCESOS_DE_LA_DEMO)")
  })
})

describe('GD · nº99 · la voz elegida y la pronunciación', () => {
  it('la voz de los vídeos es Julio Clon, con el modelo v4, en su único sitio', () => {
    const v = readFileSync('scripts/video/voz-elevenlabs.txt', 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    expect(v).toEqual(['TbcXaMnSerONT83CTICz', 'modelo: v4'])
  })

  it('a la voz va «GoCardless» como suena; los subtítulos dicen GoCardless', async () => {
    const { paraLaVoz, FRASES: F, PRONUNCIA } = await import('../../../../../scripts/video/gd/locucion.mjs')
    expect(PRONUNCIA.GoCardless).toBe('Gou Cárdles')
    expect(paraLaVoz(F['06.10'])).toContain('Gou Cárdles pasa los cargos')
    expect(paraLaVoz(F['06.10'])).not.toContain('GoCardless')
    expect(F['06.10']).toContain('GoCardless')
    expect(readFileSync('scripts/video/voz_nube.py', 'utf8')).toContain('habla = lambda x: x.get("voz") or x["texto"]')
  })

  it('la prueba de 01, 02 y 03: cada escena se puede pedir sola', () => {
    for (const e of ['01', '02', '03', '04', '05', '06', '07', '07b', '08', '09', '10', '11']) expect(g).toContain(`if (pide('${e}')) {`)
    const w = readFileSync('.github/workflows/gd-video-qbo.yml', 'utf8')
    expect(w.slice(w.indexOf('  video:'))).toContain('ESCENAS: ${{ inputs.escenas }}')
  })
})
