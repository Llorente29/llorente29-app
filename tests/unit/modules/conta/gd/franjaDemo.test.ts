// GD · La franja de una cuenta de demostración: sale solo con accounts.is_demo, dice lo que es la cuenta y está en
// el marco de todas las pantallas de Sumied (dentro del contenido, así también en el móvil). Sin datos (T11).
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

let demo = false
vi.mock('@/modules/conta/cuenta/contratoCuenta', () => ({ useCuentaConta: () => ({ esDemo: demo }) }))
const { FranjaDemo } = await import('@/modules/conta/cuenta/FranjaDemo')

describe('GD · la franja de demo', () => {
  it('en una cuenta demo dice «Cuenta de demostración · datos inventados · aquí puedes tocar todo»', () => {
    demo = true
    const html = renderToStaticMarkup(createElement(FranjaDemo))
    expect(html.replace(/<[^>]+>/g, '')).toBe('Cuenta de demostración · datos inventados · aquí puedes tocar todo')
    expect(html).toContain('role="note"')
  })
  it('en una cuenta que no es demo no sale nada', () => {
    demo = false
    expect(renderToStaticMarkup(createElement(FranjaDemo))).toBe('')
  })
  it('va en el marco, dentro del contenido; y no es roja ni ámbar', () => {
    const marco = readFileSync('src/modules/conta/marco/Marco.tsx', 'utf8')
    expect(marco).toMatch(/<main className="cx-principal[^"]*">\s*\{\/\*[^*]*\*\/\}\s*<FranjaDemo \/>/)
    const css = readFileSync('src/modules/conta/marco/marco.css', 'utf8')
    const regla = /\.cx-franja-demo \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(regla).toMatch(/background: var\(--s-neutro-fondo\)/)
    expect(regla).not.toMatch(/falta|aviso|ambar|error|mal/)
  })
})
