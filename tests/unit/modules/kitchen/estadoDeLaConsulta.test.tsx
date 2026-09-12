// Las dos reglas del estado de una consulta (Julio, 12/09 14:45), fijadas.
//
//   1. El vacío se pinta SÓLO cuando el dato es vacío, y entonces no se pinta
//      nada más debajo.
//   2. Un error NO se pinta como vacío: si la consulta falla, lo dice y lo
//      dice con su motivo.
//
// LA SEGUNDA YA ESTABA (es B79, de junio). La primera no: el componente no
// sabía si había filas, así que si no cargaba y no había error pintaba el
// cartel de vacío SIEMPRE. Las cuatro pantallas que lo usaban acertaban porque
// lo envolvían en un ternario; el tablero 1 lo pintó suelto y la pantalla salió
// diciendo «no ha devuelto ninguna fila» con 65 preguntas debajo.
//
// Por eso `hayFilas` es obligatoria y por eso esto se prueba: la disciplina de
// quien llama no es una garantía, y la siguiente pantalla la escribe otro.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'

const VACIO = 'no ha devuelto ninguna fila'

describe('regla 1 · el vacío sólo cuando el dato es vacío', () => {
  it('CON filas no pinta nada, ni cartel ni caja', () => {
    const html = renderToStaticMarkup(
      <EstadoDeLaConsulta hayFilas queSePregunto="las preguntas de esta cuenta" />,
    )
    expect(html).toBe('')
  })

  it('SIN filas dice qué se preguntó, no qué se concluye del negocio', () => {
    const html = renderToStaticMarkup(
      <EstadoDeLaConsulta hayFilas={false} queSePregunto="las preguntas de esta cuenta" />,
    )
    expect(html).toContain(VACIO)
    expect(html).toContain('las preguntas de esta cuenta')
  })

  it('y el matiz sólo acompaña al vacío, nunca a la lista llena', () => {
    const conMatiz = renderToStaticMarkup(
      <EstadoDeLaConsulta hayFilas={false} queSePregunto="x" matiz="la marca tiene 23 productos" />,
    )
    expect(conMatiz).toContain('la marca tiene 23 productos')
    expect(renderToStaticMarkup(
      <EstadoDeLaConsulta hayFilas queSePregunto="x" matiz="la marca tiene 23 productos" />,
    )).toBe('')
  })
})

describe('regla 2 · un error no se disfraza de vacío', () => {
  it('dice que falló, con su motivo, y que eso NO es «no hay datos»', () => {
    const html = renderToStaticMarkup(
      <EstadoDeLaConsulta
        hayFilas={false}
        error="permission denied for function modificadores_lista_preguntas"
        queSePregunto="las preguntas de esta cuenta"
      />,
    )
    expect(html).toContain('No se ha podido cargar')
    expect(html).toContain('permission denied for function')
    expect(html).not.toContain(VACIO)
  })

  it('un fallo CON filas viejas en pantalla sigue siendo un fallo y se cuenta', () => {
    // El orden importa: `hayFilas` no puede callar un error. Si se leyera
    // primero, una pantalla con datos de hace un minuto se tragaría el fallo
    // de la recarga y nadie sabría que lo que mira está caducado.
    const html = renderToStaticMarkup(
      <EstadoDeLaConsulta hayFilas error="network timeout" queSePregunto="x" />,
    )
    expect(html).toContain('network timeout')
    expect(html).not.toBe('')
  })

  it('y cargando no dice ni vacío ni error', () => {
    const html = renderToStaticMarkup(
      <EstadoDeLaConsulta hayFilas={false} cargando textoCargando="Leyendo…" queSePregunto="x" />,
    )
    expect(html).toContain('Leyendo…')
    expect(html).not.toContain(VACIO)
    expect(html).not.toContain('No se ha podido cargar')
  })
})

// ── Y que ninguna pantalla lo pinte suelto ─────────────────────────────────
// `hayFilas` obligatoria ya impide el fallo silencioso: sin contestarla no
// compila. Esto vigila la otra mitad —que el estado y el contenido no se
// pinten a la vez— leyendo las páginas: cada uso tiene que estar dentro de una
// condición, no suelto entre dos bloques de contenido.
describe('ninguna pantalla pinta el estado al lado del contenido', () => {
  const PAGINAS = [
    'KitchenMenuEngineeringPage', 'KitchenDashboardPage', 'KitchenProfitabilityPage',
    'KitchenExtrasPage', 'KitchenModificadoresPage',
  ]

  it.each(PAGINAS)('%s lo envuelve en una condición', (pagina) => {
    const src = readFileSync(
      resolve(__dirname, `../../../../src/modules/kitchen/pages/${pagina}.tsx`), 'utf8',
    )
    const i = src.indexOf('<EstadoDeLaConsulta')
    expect(i).toBeGreaterThan(-1)
    // Lo que hay justo antes tiene que ser una condición abierta: `? (` de un
    // ternario. Pintarlo suelto deja un `/>` o un `}` ahí, que es el fallo.
    const antes = src.slice(0, i).trimEnd()
    expect(antes.endsWith('? (')).toBe(true)
  })

  it('y todas contestan a hayFilas', () => {
    for (const pagina of PAGINAS) {
      const src = readFileSync(
        resolve(__dirname, `../../../../src/modules/kitchen/pages/${pagina}.tsx`), 'utf8',
      )
      const bloque = src.slice(src.indexOf('<EstadoDeLaConsulta'))
      expect(bloque.slice(0, bloque.indexOf('/>'))).toContain('hayFilas=')
    }
  })
})
