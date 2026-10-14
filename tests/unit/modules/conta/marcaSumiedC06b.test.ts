// C06b (respuesta 6 de Julio, tarea 6) · La marca Sumied: el dominio la
// decide, sus colores pasan AA donde se usan, y en nada de lo que ve un
// cliente aparece «Folvy» (la entrada, la vista previa del enlace y los
// correos). Contra los ficheros de verdad: index.html y marcas.ts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MARCAS, esHostDeProduccion, resolverMarca } from '../../../../supabase/functions/_shared/marcas'
import { contrasena, contrasenaCambiada, invitacion } from '../../../../supabase/functions/send-email/marca'
import { indexDeMarca } from '../../../../build/indexDeMarca'
import { cssDelTema } from '@/marca/tema'

const S = MARCAS.sumied
const INDEX = readFileSync('index.html', 'utf8')
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

describe('el dominio decide la marca', () => {
  it('app.sumied.com es Sumied, y es de producción: ?marca= no la cambia', () => {
    expect(resolverMarca({ host: 'app.sumied.com', buscar: '?marca=folvy', recordada: null }).id).toBe('sumied')
    expect(esHostDeProduccion('app.sumied.com')).toBe(true)
  })
  it('sumied.com a secas no es la app (queda para la web pública)', () => {
    expect(S.dominios).toEqual(['app.sumied.com'])
  })
  it('fuera de producción se prueba con ?marca=sumied; en *.folvy.app, no', () => {
    expect(resolverMarca({ host: 'folvy-app-git-conta-c06b-foodint.vercel.app', buscar: '?marca=sumied', recordada: null }).id).toBe('sumied')
    expect(resolverMarca({ host: 'app.folvy.app', buscar: '?marca=sumied', recordada: null }).id).toBe('folvy')
  })
})

describe('los colores de Sumied, con AA donde se usan', () => {
  const t = S.tema!
  it('la identidad aprobada: azul noche, azul de acción hondo, turquesa, gris claro; Inter', () => {
    expect(t).toMatchObject({ tinta: '#0B1F3B', accion: '#1E63C9', acento: '#00D1B2', accionSuave: '#EAF2F8' })
    expect(t.letra).toMatch(/^'Inter Variable', 'Inter'/)
  })
  it('texto, apoyo y enlaces sobre blanco y sobre el gris claro: ≥ 4,5:1', () => {
    for (const fondo of ['#FFFFFF', t.accionSuave]) {
      for (const color of [t.tinta, t.apoyo, t.accion]) expect(contraste(color, fondo), `${color} sobre ${fondo}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('texto blanco en los botones: ≥ 4,5:1', () => {
    expect(contraste('#FFFFFF', t.accion)).toBeGreaterThanOrEqual(4.5)
  })
  it('la prueba puede fallar: el azul del logo (#2F80ED) no vale para un botón con texto blanco', () => {
    expect(contraste('#FFFFFF', '#2F80ED')).toBeLessThan(4.5)
  })
  it('el turquesa solo es fondo: con la tinta encima ≥ 4,5:1 (como letra sobre blanco no llegaría)', () => {
    expect(contraste(t.tinta, t.acento)).toBeGreaterThanOrEqual(4.5)
    expect(contraste(t.acento, '#FFFFFF')).toBeLessThan(3)
  })
  it('el tema se escribe encima de los tokens del módulo y de la entrada; sin tema, nada', () => {
    const css = cssDelTema(S)!
    expect(css).toContain('html[data-marca="sumied"] .cx')
    expect(css).toContain('--cx-azul: #1E63C9;')
    expect(css).toContain('--mx-azul: #1E63C9;')
    expect(css).toContain("--cx-letra: 'Inter Variable'")
    expect(cssDelTema(MARCAS.folvy)).toBeNull()
    expect(cssDelTema(MARCAS.contabilidad)).toBeNull()
  })
})

describe('en nada de lo que ve un cliente de Sumied aparece «Folvy»', () => {
  it('el index que lee la vista previa del enlace (WhatsApp)', () => {
    const h = indexDeMarca(INDEX, S, 'https://app.sumied.com')
    expect(h).not.toMatch(/Folvy/i)
    expect(h).toContain('<meta property="og:image" content="https://app.sumied.com/marcas/sumied/vista-previa.png" />')
    expect(h).toContain('<title>Sumied</title>')
  })
  it('los tres correos, con su logo y su azul', () => {
    const correos = [
      invitacion(S, { nombre: 'Ana Prueba', empresa: 'Empresa de Prueba, S.L.', enlace: 'https://app.sumied.com/x' }),
      contrasena(S, { enlace: 'https://app.sumied.com/y' }),
      contrasenaCambiada(S, { cuando: '14 de octubre de 2026, 12:00', entrar: 'https://app.sumied.com/login' }),
    ]
    for (const c of correos) {
      expect(`${c.subject}\n${c.html}\n${c.text}`).not.toMatch(/Folvy/i)
      expect(c.html).toContain('https://app.sumied.com/marcas/sumied/logo-correo.png')
      expect(c.html).not.toContain('#2F5BFF')
    }
    expect(correos[0].html).toContain('background:#1E63C9')
  })
  it('las frases de la entrada son las ciertas hoy: nada de nóminas ni personal, que aún no existen', () => {
    expect(S.entrar.frases.join(' ')).not.toMatch(/nómina|personal/i)
  })
})
