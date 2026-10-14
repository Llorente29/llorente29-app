// tests/unit/modules/conta/vistaPreviaC06.test.ts
//
// C06, respuesta 2: lo que lee la vista previa de un enlace (WhatsApp, correo)
// nunca dice «Folvy» con la marca; el index de Folvy no cambia; vercel.json
// sirve el index de la marca por su dominio y, fuera de producción, con
// ?marca=. Contra los ficheros de verdad: index.html y vercel.json del repo.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { indexDeMarca } from '../../../../build/indexDeMarca'
import { MARCAS, direccionDeFacturas, urlBaseDeMarca } from '../../../../supabase/functions/_shared/marcas'

const INDEX = readFileSync('index.html', 'utf8')
const VERCEL = JSON.parse(readFileSync('vercel.json', 'utf8')) as { rewrites: Array<Record<string, unknown>> }

describe('el index de cada marca (lo que lee un enlace compartido)', () => {
  for (const m of Object.values(MARCAS).filter((x) => x.id !== 'folvy')) {
    it(`${m.id}: título, descripción, iconos y vista previa de la marca, y ni un «Folvy»`, () => {
      const h = indexDeMarca(INDEX, m, urlBaseDeMarca(m))
      expect(h).not.toMatch(/folvy/i)
      expect(h).toContain(`<title>${m.nombre}</title>`)
      expect(h).toContain(`<meta name="description" content="${m.descripcion}" />`)
      expect(h).toContain(`<meta property="og:title" content="${m.nombre}" />`)
      expect(h).toContain(`href="${m.favicon}"`)
      expect(h).toContain(`href="${m.manifiesto}"`)
      if (m.imagenVistaPrevia) expect(h).toContain(`<meta property="og:image" content="${urlBaseDeMarca(m) ?? ''}${m.imagenVistaPrevia}" />`)
      // Lo demás, igual: la misma app.
      expect(h).toContain('<script type="module" src="/src/main.tsx"></script>')
    })
  }

  it('si index.html pierde una meta que se cambia, el build falla (no sale una vista previa con «Folvy»)', () => {
    expect(() => indexDeMarca(INDEX.replace(/<meta name="description"[^>]*>/, ''), MARCAS.contabilidad, null)).toThrow(/la descripción/)
  })

  it('Folvy no tiene index propio: el de siempre sigue diciendo lo de siempre', () => {
    expect(INDEX).toContain('<title>Folvy</title>')
    expect(INDEX).not.toContain('og:')
    expect(MARCAS.folvy.descripcion).toBe(INDEX.match(/<meta name="description" content="([^"]*)"/)?.[1])
  })
})

describe('vercel.json sirve el index de la marca', () => {
  const reglas = VERCEL.rewrites
  const ultima = reglas[reglas.length - 1]

  it('lo de siempre sigue al final: todo lo demás a /index.html', () => {
    expect(ultima).toEqual({ source: '/(.*)', destination: '/index.html' })
  })

  for (const m of Object.values(MARCAS).filter((x) => x.id !== 'folvy')) {
    const destino = `/marcas/${m.id}/index.html`
    it(`${m.id}: con ?marca=${m.id}, nunca en producción (*.folvy.app ni folvy-app.vercel.app)`, () => {
      const r = reglas.find((x) => x.destination === destino && JSON.stringify(x.has).includes('"query"'))
      expect(r).toBeTruthy()
      expect(r?.has).toEqual([{ type: 'query', key: 'marca', value: m.id }])
      const fuera = (r?.missing as Array<{ value: string }>).map((x) => new RegExp(`^${x.value}$`))
      for (const host of ['app.folvy.app', 'foodint.folvy.app', 'folvy-app.vercel.app']) expect(fuera.some((re) => re.test(host)), host).toBe(true)
      for (const host of ['folvy-app-git-conta-c06-sola-foodint.vercel.app', 'localhost']) expect(fuera.some((re) => re.test(host)), host).toBe(false)
      expect(reglas.indexOf(r!)).toBeLessThan(reglas.length - 1)
    })
    for (const d of m.dominios) {
      it(`${m.id}: su dominio ${d} sirve su index`, () => {
        expect(reglas.some((x) => x.destination === destino && JSON.stringify(x.has) === JSON.stringify([{ type: 'host', value: d }]))).toBe(true)
      })
    }
  }
})

describe('la dirección a la que se reenvían las facturas', () => {
  it('Folvy: facturas-<empresa>@entrada.folvy.app', () => {
    expect(direccionDeFacturas(MARCAS.folvy, 'Foodint')).toBe('facturas-foodint@entrada.folvy.app')
    expect(direccionDeFacturas(MARCAS.folvy, 'Taberna de Prueba Norte, S.L.')).toBe('facturas-taberna-de-prueba-norte-s-l@entrada.folvy.app')
    expect(direccionDeFacturas(MARCAS.folvy, 'Panadería Luna')).toBe('facturas-panaderia-luna@entrada.folvy.app')
  })
  it('una marca sin dominio de entrada no recibe correo: null, no una dirección de Folvy', () => {
    expect(direccionDeFacturas(MARCAS.contabilidad, 'Foodint')).toBeNull()
  })
  it('un identificador que se queda en nada: null', () => {
    expect(direccionDeFacturas(MARCAS.folvy, ' ·· ')).toBeNull()
  })
})
