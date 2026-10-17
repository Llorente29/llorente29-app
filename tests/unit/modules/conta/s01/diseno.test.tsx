// tests/unit/modules/conta/s01/diseno.test.tsx
//
// S01 · El sistema de diseño: lo que pintan los componentes (con
// renderToStaticMarkup, los de verdad) y los contrastes de cada marca, medidos
// contra los ficheros de verdad (tokens.css y temas.ts), no contra números
// copiados aquí (regla 31). Y que Folvy no cambia: los alias del marco dan los
// mismos valores de N30 que antes del S01.

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  Boton, BotonEnlace, Campo, Chip, Cifra, Cinta, GrupoCinta, ICONOS, Icono, Selector, Tarjeta, TarjetaCifra, Texto,
  expandirSubcuenta, importeDeTexto, opcionesConGuardado, textoCifra, textoDeImporte, tonoDeEstado, type NombreIcono,
} from '@/modules/conta/diseno'
import { TEMAS_DISENO, variablesDeMarca } from '@/modules/conta/diseno/temas'
import { cssDelTema } from '@/marca/tema'
import { MARCAS } from '../../../../../supabase/functions/_shared/marcas'

const html = (n: React.ReactElement) => renderToStaticMarkup(n)
const TOKENS = readFileSync('src/modules/conta/diseno/tokens.css', 'utf8')
const MARCO = readFileSync('src/modules/conta/estilo/marco.css', 'utf8')

/** Los valores de serie de tokens.css: `--s-x: valor;` del primer bloque (no el de la densidad cómoda). */
const BLOQUE_SERIE = TOKENS.slice(TOKENS.indexOf('.cx, .cx-colores, .cxm {'), TOKENS.indexOf('\n}\n'))
const deSerie: Record<string, string> = Object.fromEntries(
  Array.from(BLOQUE_SERIE.matchAll(/(--s-[a-z0-9-]+):\s*([^;]+);/g)).map((m) => [m[1], m[2].trim()]),
)

const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

describe('los contrastes, marca a marca', () => {
  const marcas: [string, Record<string, string>][] = [
    ['de serie (Folvy y la marca de pruebas)', deSerie],
    ['Sumied', { ...deSerie, ...variablesDeMarca(MARCAS.sumied) }],
  ]
  for (const [nombre, v] of marcas) {
    describe(nombre, () => {
      it('texto, apoyo y acción sobre la superficie y el fondo: ≥ 4,5:1', () => {
        for (const fondo of [v['--s-superficie'], v['--s-fondo'], v['--s-suave']]) {
          for (const t of ['--s-tinta', '--s-apoyo', '--s-accion']) expect(contraste(v[t], fondo), `${t} sobre ${fondo}`).toBeGreaterThanOrEqual(4.5)
        }
      })
      it('los chips: su texto sobre su fondo ≥ 4,5:1', () => {
        for (const [t, f] of [['--s-ok', '--s-ok-fondo'], ['--s-duda', '--s-duda-fondo'], ['--s-falta', '--s-falta-fondo'], ['--s-accion', '--s-accion-suave'], ['--s-tinta', '--s-neutro-fondo']]) {
          expect(contraste(v[t], v[f]), `${t} sobre ${f}`).toBeGreaterThanOrEqual(4.5)
        }
      })
      it('el borde de los controles: ≥ 3:1 sobre la superficie y el fondo (C06 R4, WCAG 1.4.11)', () => {
        for (const f of ['--s-superficie', '--s-fondo']) expect(contraste(v['--s-borde-control'], v[f])).toBeGreaterThanOrEqual(3)
      })
      it('la barra: su texto y el activo ≥ 4,5:1', () => {
        expect(contraste(v['--s-barra-texto'], v['--s-barra'])).toBeGreaterThanOrEqual(4.5)
        expect(contraste(v['--s-barra-activo-texto'], v['--s-barra-activo'])).toBeGreaterThanOrEqual(4.5)
      })
      it('texto blanco en el botón principal ≥ 4,5:1', () => {
        expect(contraste(v['--s-sobre-accion'], v['--s-accion'])).toBeGreaterThanOrEqual(4.5)
      })
    })
  }
  it('cada borde en su sitio: los controles con el de control; tarjetas, tablas, cinta y botones con el decorativo', () => {
    const css = readFileSync('src/modules/conta/diseno/diseno.css', 'utf8')
    const regla = (sel: string) => { const i = css.indexOf(`${sel} {`); return css.slice(i, css.indexOf('}', i)) }
    expect(regla('.s-control')).toContain('var(--s-borde-control)')
    for (const sel of ['.s-tarjeta', '.s-tabla td', '.s-cinta', '.s-boton-secundario']) expect(regla(sel), sel).toContain('var(--s-borde-decorativo)')
  })
  it('la prueba puede fallar: el borde de la maqueta (#DCE5F0) no llega a 3:1, por eso solo decora', () => {
    expect(contraste('#DCE5F0', '#FFFFFF')).toBeLessThan(3)
  })
})

describe('las marcas', () => {
  it('Sumied: la barra azul noche y los estados de las maquetas; Folvy y la de pruebas, sin tema', () => {
    expect(TEMAS_DISENO.sumied).toMatchObject({ barra: '#0B1F3B', fondo: '#F4F7FB', ok: '#0B6B58', duda: '#7A4A00', falta: '#8A1F12' })
    // Julio, S01 respuestas 1 y 2: el control a 3:1; lo que decora, el de la maqueta; acción y apoyo, los de la identidad.
    expect(TEMAS_DISENO.sumied).toMatchObject({ bordeControl: '#7F8FA6', bordeDecorativo: '#DCE5F0' })
    expect(MARCAS.sumied.tema).toMatchObject({ accion: '#1E63C9', apoyo: '#4A5B73' })
    expect(variablesDeMarca(MARCAS.folvy)).toBeNull()
    expect(variablesDeMarca(MARCAS.contabilidad)).toBeNull()
  })
  it('el tema de Sumied escribe los --s-* en .cx, .cx-colores y .cxm, con la identidad de marcas.ts', () => {
    const css = cssDelTema(MARCAS.sumied)!
    const desde = css.indexOf('html[data-marca="sumied"] .cxm {')
    const bloque = css.slice(desde, css.indexOf('}', desde))
    expect(css).toContain('html[data-marca="sumied"] .cx, html[data-marca="sumied"] .cx-colores, html[data-marca="sumied"] .cxm {')
    expect(bloque).toContain(`--s-accion: ${MARCAS.sumied.tema!.accion};`)
    expect(bloque).toContain("--s-letra: 'Inter Variable'")
    expect(bloque).toContain('--s-barra: #0B1F3B;')
    expect(bloque).not.toMatch(/--cxm-/)
  })
  it('Folvy no cambia: cada --cxm-* del marco es alias de un --s-* cuyo valor de serie es el de N30', () => {
    const N30: Record<string, string> = {
      '--cxm-texto': '#0E1A2B', '--cxm-apoyo': '#5B6678', '--cxm-fondo': '#EEF1F5', '--cxm-superficie': '#FFFFFF', '--cxm-suave': '#F7F9FC',
      '--cxm-borde': '#DDE3EB', '--cxm-azul': '#2F5BFF', '--cxm-azul-encima': '#1F45D6', '--cxm-verde': '#0B7A55', '--cxm-verde-fondo': '#E3FBF2',
      '--cxm-ambar': '#7A4A00', '--cxm-ambar-fondo': '#FFE7B8', '--cxm-propuesto': '#EEF3FF', '--cxm-propuesto-borde': '#B9C9FF',
      '--cxm-documento': '#E9EDF3', '--cxm-rojo': '#A3201A', '--cxm-radio-boton': '6px', '--cxm-radio-campo': '5px', '--cxm-radio-bloque': '8px',
      '--cxm-fila': '28px', '--cxm-hueco': '8px',
    }
    for (const [cxm, valor] of Object.entries(N30)) {
      const alias = new RegExp(`${cxm}:\\s*var\\((--s-[a-z0-9-]+)\\)`).exec(MARCO)
      expect(alias, cxm).not.toBeNull()
      expect(deSerie[alias![1]], `${cxm} → ${alias![1]}`).toBe(valor)
    }
  })
})

describe('Boton', () => {
  it('principal con su tecla: clase, tecla dibujada y aria-keyshortcuts', () => {
    const h = html(<Boton variante="principal" tecla="↵" atajo="Enter">Validar y siguiente</Boton>)
    expect(h).toContain('class="s-boton s-boton-principal"')
    expect(h).toContain('aria-keyshortcuts="Enter"')
    expect(h).toContain('<kbd class="s-tecla" aria-hidden="true">↵</kbd>')
    expect(h).toContain('type="button"')
  })
  it('de serie es secundario; el contador va en su píldora y el icono delante', () => {
    const h = html(<Boton icono="revisar" contador={12}>Para revisar</Boton>)
    expect(h).toMatch(/^<button[^>]*class="s-boton s-boton-secundario"/)
    expect(h.indexOf('<svg')).toBeLessThan(h.indexOf('Para revisar'))
    expect(h).toContain('<span class="s-boton-contador s-cifra" data-tono="duda">12</span>')
    // Lo que solo informa («Expedidas 12»), en neutro.
    expect(html(<Boton contador={12} contadorTono="neutro">Expedidas</Boton>)).toContain('data-tono="neutro">12</span>')
  })
  it('BotonEnlace con aviso, apagado y su dato: punto ámbar, gris y el dato al pasar el ratón y para el lector', () => {
    const h = html(<MemoryRouter><BotonEnlace a="/conta/x" aviso apagado titulo="Recibidas: 2 sin NIF">Recibidas</BotonEnlace></MemoryRouter>)
    expect(h).toContain('class="s-boton s-boton-secundario s-boton-aviso s-boton-apagado"')
    expect(h).toContain('title="Recibidas: 2 sin NIF"')
    expect(h).toContain('aria-description="Recibidas: 2 sin NIF"')
  })
  it('BotonEnlace navega y marca la pantalla en la que se está', () => {
    const h = html(<MemoryRouter><BotonEnlace a="/conta/asientos" actual>Libro diario</BotonEnlace></MemoryRouter>)
    expect(h).toMatch(/^<a [^>]*href="\/conta\/asientos"/)
    expect(h).toContain('aria-current="page"')
  })
})

describe('Icono', () => {
  it('cada nombre pinta un svg decorativo, a 16 px y con el trazo fijo', () => {
    for (const n of Object.keys(ICONOS) as NombreIcono[]) {
      const h = html(<Icono nombre={n} />)
      expect(h, n).toMatch(/^<svg/)
      expect(h, n).toContain('aria-hidden="true"')
      expect(h, n).toContain('width="16"')
      expect(h, n).toContain('stroke-width="1.75"')
    }
  })
})

describe('Chip', () => {
  it('cada tono lleva su data-tono; los estados de antes caen en el suyo', () => {
    expect(html(<Chip tono="falta">Falta el documento</Chip>)).toBe('<span class="s-chip" data-tono="falta">Falta el documento</span>')
    expect(['verde', 'ambar', 'azul', 'neutro', 'gris', 'rojo'].map((t) => tonoDeEstado(t as 'verde'))).toEqual(['seguro', 'duda', 'accion', 'neutro', 'neutro', 'falta'])
  })
})

describe('Cifra', () => {
  it('como en las maquetas: punto de miles, coma, céntimos y el menos de verdad', () => {
    expect(textoCifra(1240.5)).toBe('1.240,50 €')
    expect(textoCifra(-121)).toBe('−121,00 €')
    expect(textoCifra(18420, { exacta: false })).toBe('18.420 €')
    expect(textoCifra(438.99, { lado: 'D' })).toBe('438,99 D')
  })
  it('null no es cero', () => {
    expect(textoCifra(null)).toBe('—')
    expect(html(<Cifra valor={null} vacio="sin dato" />)).toBe('<span class="s-cifra">sin dato</span>')
  })
})

describe('Campo', () => {
  it('la etiqueta apunta al control y el fallo lo describe, como alerta', () => {
    const h = html(<Campo etiqueta="NIF" id="campo-nif" error="Falta el NIF">{(p) => <Texto {...p} valor="" alCambiar={() => {}} />}</Campo>)
    expect(h).toContain('<label class="s-campo-etiqueta" for="campo-nif">NIF</label>')
    expect(h).toContain('aria-invalid="true"')
    expect(h).toContain('aria-describedby="campo-nif-nota"')
    expect(h).toContain('<div id="campo-nif-nota" class="s-campo-nota" role="alert">Falta el NIF</div>')
    expect(h).toContain('data-estado="falta"')
  })
  it('sin nada debajo no hay aria-describedby que apunte a la nada', () => {
    const h = html(<Campo etiqueta="Proveedor" id="p">{(p) => <Texto {...p} valor="x" alCambiar={() => {}} />}</Campo>)
    expect(h).not.toContain('aria-describedby')
  })
  it('regla 30: lo guardado que ya no se ofrece sale, y lo dice', () => {
    const op = [{ valor: 'L1', texto: 'Local 1' }]
    expect(opcionesConGuardado('L9', op, 'Local 9')).toEqual([{ valor: 'L9', texto: 'Local 9 (ya no se ofrece)' }, ...op])
    expect(opcionesConGuardado('L1', op)).toEqual(op)
    expect(opcionesConGuardado('', op)).toEqual(op)
    expect(html(<Selector id="l" valor="L9" alCambiar={() => {}} opciones={op} />)).toContain('<option value="L9" selected="">L9 (ya no se ofrece)</option>')
  })
})

describe('valores de los campos', () => {
  it('la subcuenta con punto, contra el plan de verdad (la serie del BOE): cada cuenta de 2 a 4 dígitos + «.1»', () => {
    const serie = JSON.parse(readFileSync('supabase/conta/pgc/serie.json', 'utf8')) as { cuentas: { code: string }[] }
    const codigos = [...new Set(serie.cuentas.map((c) => c.code).filter((c) => /^\d{2,4}$/.test(c)))]
    expect(codigos.length).toBeGreaterThan(500)
    for (const c of codigos) {
      const x = expandirSubcuenta(`${c}.1`)
      expect(x, c).toHaveLength(8)
      expect(x.startsWith(c) && x.endsWith('1') && /^\d+$/.test(x), c).toBe(true)
    }
  })
  it('la subcuenta: con dos dígitos, sin punto, o si no cabe, como en Diez y A3', () => {
    expect(expandirSubcuenta('43.12')).toBe('43000012')
    expect(expandirSubcuenta(' 40.31 ')).toBe('40000031')
    expect(expandirSubcuenta('43.')).toBe('43000000')
    expect(expandirSubcuenta('43000012')).toBe('43000012')
    expect(expandirSubcuenta('4300.00012')).toBe('4300.00012')
    expect(expandirSubcuenta('62.9', 10)).toBe('6200000009')
  })
  it('el importe: lo escrito de varias formas, y cómo queda al salir', () => {
    expect(importeDeTexto('1.234,56')).toBe(1234.56)
    expect(importeDeTexto('1234.56')).toBe(1234.56)
    expect(importeDeTexto('−12,5')).toBe(-12.5)
    expect(importeDeTexto('doce')).toBeNull()
    expect(textoDeImporte(438.99)).toBe('438,99')
    expect(textoDeImporte(1815)).toBe('1.815,00')
  })
})

describe('Tarjeta y Cinta', () => {
  it('la tarjeta se nombra por su título; el tono va en data-tono', () => {
    const h = html(<Tarjeta titulo="Retención del alquiler" tono="duda">x</Tarjeta>)
    expect(h).toMatch(/^<section class="s-tarjeta" data-tono="duda" aria-labelledby="([^"]+)"><div class="s-tarjeta-cabeza"><div class="s-tarjeta-titulos"><h2 id="\1"/)
    expect(html(<TarjetaCifra etiqueta="Banco hoy">1</TarjetaCifra>)).toContain('Banco hoy</h3>')
  })
  it('la cinta: barra de herramientas con sus grupos nombrados, y «Ocultar»', () => {
    const h = html(<Cinta etiqueta="Acciones de Asientos" oculta={false} alCambiarOculta={() => {}}><GrupoCinta titulo="Nuevo"><Boton>Expedida</Boton></GrupoCinta></Cinta>)
    expect(h).toContain('role="toolbar" aria-label="Acciones de Asientos"')
    expect(h).toMatch(/role="group" aria-labelledby="([^"]+)"><span id="\1" class="s-cinta-grupo-titulo">Nuevo<\/span>/)
    expect(h).toContain('aria-expanded="true"')
  })
  it('oculta, no desaparece: queda «Mostrar la cinta» (regla 7)', () => {
    const h = html(<Cinta etiqueta="Acciones" oculta alCambiarOculta={() => {}}><GrupoCinta titulo="Nuevo"><Boton>Expedida</Boton></GrupoCinta></Cinta>)
    expect(h).toContain('Mostrar la cinta')
    expect(h).toContain('aria-expanded="false"')
    expect(h).not.toContain('Expedida')
  })
})

describe('el botón del usuario mide lo mismo en los tres niveles (el nivel no mueve nada)', () => {
  it('lleva los tres nombres en la misma celda; solo el actual se ve y se lee', async () => {
    const { MenuUsuario } = await import('@/modules/conta/esqueleto/MenuUsuario')
    const { DE_SERIE, NIVELES, NOMBRE_NIVEL } = await import('@/modules/conta/esqueleto/preferencias')
    for (const nivel of NIVELES) {
      const html = renderToStaticMarkup(
        <MemoryRouter><MenuUsuario nombre="Julio" prefs={{ ...DE_SERIE, nivel }} solo={false} movil={false} cambiar={() => {}} /></MemoryRouter>,
      )
      const celda = html.match(/<strong class="s-usuario-nivel">(.*?)<\/strong>/)![1]
      for (const n of NIVELES) expect(celda).toContain(`>${NOMBRE_NIVEL[n]}<`)
      expect(celda.match(/data-actual="true"/g)).toHaveLength(1)
      expect(celda).toContain(`aria-hidden="false" data-actual="true">${NOMBRE_NIVEL[nivel]}<`)
    }
    const css = readFileSync('src/modules/conta/esqueleto/esqueleto.css', 'utf8')
    expect(css).toMatch(/\.s-usuario-nivel > span \{ grid-area: 1 \/ 1; visibility: hidden; \}/)
  })
})
