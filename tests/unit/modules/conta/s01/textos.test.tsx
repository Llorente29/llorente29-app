import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NIVELES } from '@/modules/conta/esqueleto/preferencias'
import { MarcoContexto, type Marco } from '@/modules/conta/marco/nuevo/contexto'
import { TEXTOS, huecos, texto, type ClaveTexto } from '@/modules/conta/textos/textos'
import { PorNivel } from '@/modules/conta/textos/PorNivel'

describe('S01 · El diccionario de textos por nivel', () => {
  const claves = Object.keys(TEXTOS) as ClaveTexto[]

  it('cada clave lleva sus tres textos, no vacíos y sin llaves sueltas', () => {
    for (const c of claves) for (const n of NIVELES) {
      const s = TEXTOS[c][n]
      expect(s.trim(), `${c} · ${n}`).not.toBe('')
      expect(s.replace(/\{[a-zA-Z]+\}/g, ''), `${c} · ${n}`).not.toMatch(/[{}]/)
    }
  })

  it('rellena los huecos y, sin dato, lo deja escrito para que se vea', () => {
    expect(texto('recibida.titulo', 'sin_experiencia', { proveedor: 'Makro', numero: 'F-1' })).toBe('Una compra de Makro')
    expect(texto('recibida.titulo', 'medio', { proveedor: 'Makro', numero: 'F-1' })).toBe('Makro · F-1')
    expect(texto('recibida.titulo', 'experto', { proveedor: 'Makro', numero: 'F-1' })).toBe('Recibida · F-1 · Makro')
    expect(texto('recibida.titulo', 'medio', { proveedor: 'Makro' })).toBe('Makro · {numero}')
    expect(huecos('{a} y {b} y {a}')).toEqual(['a', 'b'])
  })

  it('medio es el texto de siempre (lo que ya conocían quienes estaban)', () => {
    expect(TEXTOS['recibida.apuntar'].medio).toBe('Está bien · apuntar')
    expect(TEXTOS['recibida.leido'].medio).toBe('Lo que he leído')
    // Maqueta 3: «Ver el asiento», plegable, en vez de «Cómo se apunta» (el bloque se sigue llamando así para el lector).
    expect(TEXTOS['recibida.verAsiento'].medio).toBe('Ver el asiento')
    expect(TEXTOS['inicio.banco'].medio).toBe('En el banco')
    expect(TEXTOS['inicio.pendiente'].medio).toBe('Solo necesito que me digas esto')
  })

  it('<PorNivel> pinta los tres (ocupa lo del más largo) y solo el del nivel se ve y se oye', () => {
    const html = renderToStaticMarkup(<MarcoContexto.Provider value={{ nivel: 'experto' } as Marco}><PorNivel clave="recibida.apuntar" /></MarcoContexto.Provider>)
    expect(html).toBe('<span class="s-por-nivel">'
      + '<span aria-hidden="true">Está bien, guardar</span>'
      + '<span aria-hidden="true">Está bien · apuntar</span>'
      + '<span aria-hidden="false" data-actual="true">Validar</span></span>')
  })

  it('fuera del marco nuevo, medio', () => {
    expect(renderToStaticMarkup(<PorNivel clave="recibida.apuntar" />)).toContain('<span aria-hidden="false" data-actual="true">Está bien · apuntar</span>')
  })
})
