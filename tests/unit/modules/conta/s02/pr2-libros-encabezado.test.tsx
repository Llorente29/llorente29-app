// tests/unit/modules/conta/s02/pr2-libros-encabezado.test.tsx
//
// S02 · PR 2 · Libros y listados en el patrón: el encabezado de cada libro.
//   · «Ver: <libro>. Cambiar» sigue saliendo cuando la página pinta su propio
//     encabezado (antes lo pintaba la fila de serie del marco), y los libros
//     no se repiten en «Más acciones»;
//   · cada libro mudado pinta EncabezadoLibro y no su Migas + h2 de antes.
// El catálogo es el de verdad (esqueleto/ordenes.ts, resuelto como lo resuelve
// el marco), no una lista escrita aquí (regla 31).

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { rutaLibros } from '@/config/navegacion'
import { cintaDe } from '@/modules/conta/esqueleto/ordenes'
import { resolverGrupos } from '@/modules/conta/marco/resolverGrupos'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { MarcoContexto, type Marco } from '@/modules/conta/marco/nuevo/contexto'
import { repartoDelLibro, fraseDelPeriodo } from '@/modules/conta/libros/encabezado'
import { EncabezadoLibro } from '@/modules/conta/libros/EncabezadoLibro'

const CTX: Parameters<typeof cintaDe>[2] = { hosteleria: false, diez: false, interruptores: new Set() }
const nada = () => undefined

/** El catálogo de una página de Libros, resuelto como lo resuelve Marco.tsx para esa dirección. */
function catalogo(pestana: string, pathname: string): GrupoDeAcciones[] {
  return resolverGrupos(cintaDe('contabilidad', pestana, CTX), { datos: null, entradas: null, pathname, search: '', abrirBuscador: nada })
}

function marcoCon(acciones: GrupoDeAcciones[]): Marco {
  return {
    densidad: 'comoda', documentoOculto: false, ocultarDocumento: nada, huecoAcciones: null, huecoPeriodo: null, ponerDatosCinta: nada,
    ponerEntradasCinta: nada, hosteleria: false, analitica: null, nivel: 'experto', ponerConPropias: nada, accionesDelCatalogo: acciones,
    ejercicios: [], diez: false, abrirBuscador: nada, colorEmpresa: null,
  } as unknown as Marco
}

describe('repartoDelLibro · el catálogo de Libros y listados', () => {
  const mayor = rutaLibros('mayor', 'libro-mayor')
  it('todo es «Ver»: un solo selector con el libro que se está viendo, y nada para «Más acciones»', () => {
    const r = repartoDelLibro(catalogo('listados', mayor))
    expect(r.selectores.map((s) => s.titulo)).toEqual(['Ver'])
    expect(r.selectores[0].actual?.etiqueta).toBe('Libro mayor')
    // Todos los libros de la pestaña están dentro del selector, ni uno menos (regla 7).
    const dentro = r.selectores[0].opciones.flatMap((g) => g.acciones.map((a) => a.id))
    const todos = cintaDe('contabilidad', 'listados', CTX).flatMap((g) => g.ordenes.map((o) => o.id))
    expect(dentro).toEqual(todos)
    expect(r.resto).toEqual([])
  })
  it('en Cierre y Registro, el actual es el de su dirección', () => {
    const r = repartoDelLibro(catalogo('cierre', rutaLibros('anuales', 'mapeo')))
    expect(r.selectores[0].actual?.etiqueta).toMatch(/alimentan/i)
  })
  it('la prueba puede fallar: un grupo que no es `ver` va a «Más acciones», no al selector', () => {
    const r = repartoDelLibro([...catalogo('listados', mayor), { titulo: 'Otra cosa', acciones: [{ id: 'x', etiqueta: 'Hacer algo', grupo: 'Otra cosa', alPulsar: nada }] }])
    expect(r.resto.map((g) => g.titulo)).toEqual(['Otra cosa'])
    expect(r.selectores[0].opciones.map((g) => g.titulo)).not.toContain('Otra cosa')
  })
})

describe('EncabezadoLibro · pintado de verdad', () => {
  const pintar = (pathname: string, acciones: GrupoDeAcciones[], mas?: GrupoDeAcciones[]) => renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <MarcoContexto.Provider value={marcoCon(acciones)}>
        <EncabezadoLibro titulo="Libro mayor" frase="Del 01/01/2026 al 31/12/2026." masAcciones={mas} />
      </MarcoContexto.Provider>
    </MemoryRouter>,
  )
  const mayor = rutaLibros('mayor', 'libro-mayor')
  it('el título del libro es el h1 visible, con «Ver: Libro mayor. Cambiar» en el encabezado', () => {
    const h = pintar(mayor, catalogo('listados', mayor))
    expect(h).toMatch(/<h1 class="s-titulo-pagina">Libro mayor<\/h1>/)
    expect(h).toContain('aria-label="Ver: Libro mayor. Cambiar"')
    expect(h).toContain('Del 01/01/2026 al 31/12/2026.')
  })
  it('los libros no salen también en «Más acciones»: con el catálogo todo `ver`, no hay «Más acciones»', () => {
    expect(pintar(mayor, catalogo('listados', mayor))).not.toContain('Más acciones')
  })
  it('lo de la página sí va a «Más acciones», y el selector se queda', () => {
    const h = pintar(mayor, catalogo('listados', mayor), [{ titulo: 'Estados', acciones: [{ id: 'm', etiqueta: 'Qué cuentas alimentan cada línea', a: '/x', grupo: 'Estados' }] }])
    expect(h).toContain('Más acciones')
    expect(h).toContain('aria-label="Ver: Libro mayor. Cambiar"')
  })
  it('fuera del marco no hay catálogo ni selector, y el encabezado se pinta igual', () => {
    const h = renderToStaticMarkup(<MemoryRouter initialEntries={[mayor]}><EncabezadoLibro titulo="Libro mayor" /></MemoryRouter>)
    expect(h).toContain('Libro mayor</h1>')
    expect(h).not.toContain('Ver:')
  })
})

describe('los libros mudados: EncabezadoLibro, sin su Migas + h2 de antes', () => {
  // Cierre.tsx es de otro encargo (y el libro diario vive en libro/): no se mudan aquí.
  const MUDADOS = ['Estados', 'LibroMayor', 'SumasSaldos', 'RegistroIva', 'OtrosLibros', 'DiarioResumido', 'Anuales', 'PendientesDiez']
  for (const f of MUDADOS) {
    it(f, () => {
      const src = readFileSync(`src/modules/conta/libros/${f}.tsx`, 'utf8')
      expect(src).toContain('<EncabezadoLibro')
      expect(src).not.toMatch(/<Migas\b/)
      expect(src).not.toContain('cxl-seccion')
    })
  }
  it('LibrosPage no pinta su h1 oculto sobre un libro que ya trae el suyo', () => {
    const src = readFileSync('src/modules/conta/libros/LibrosPage.tsx', 'utf8')
    expect(src).toMatch(/!CON_ENCABEZADO\.has\(accion\.id\) && <h1 className="cx-oculto">/)
  })
  it('la frase del periodo', () => {
    expect(fraseDelPeriodo('2026-01-01', '2026-09-30')).toBe('Del 01/01/2026 al 30/09/2026')
  })
})
