// §3.17.4 · LA MARCA ES DEL MÓDULO, NO DE CADA PANTALLA.
//
// Julio, 06/09 en producción: «elegir Scandal en Rentabilidad → Ingeniería abre
// en Scandal» ✅ … y el 07/09, el botón del Resumen abría Casado en «Ay Mamita
// Bowls». No era un fallo de ese botón: era que sólo tres pantallas leían el
// recuerdo y las demás abrían en `bs[0]`, la primera que devolviera la consulta.
// En Foodint eso es una marca CEDIDA y por alfabeto.
//
// Lo caro no es el clic de más. El selector de marca está en el mismo sitio en
// las catorce pantallas precisamente para que aprender una sea aprender todas
// (principio 3); una que abre en otra marca no se lee como «se me olvidó
// guardarlo»: se lee como «me he equivocado de pantalla», y a partir de ahí la
// persona comprueba la marca en todas, siempre, incluso en las que aciertan.
//
// ES UNA PRUEBA DE FICHERO, no de render: fija una REGLA DE CONSTRUCCIÓN, que es
// lo que se rompe cuando alguien escribe la pantalla número quince.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const PAGINAS = resolve(__dirname, '../../../../src/modules/kitchen/pages')

/**
 * FILTROS, no selectores — y la diferencia es real, no una excusa.
 *
 * Éstas abren en «todas las marcas» y el desplegable ACOTA una lista. Meterles
 * el recuerdo cambiaría lo que la pantalla contesta: quien entra a los informes
 * de disponibilidad quiere ver los de la cuenta, no los de la última marca que
 * tocó en Rentabilidad. El recuerdo es para «¿sobre qué marca trabajo?», no
 * para «¿qué me enseñas?».
 *
 * Cada una lleva escrito por qué está aquí. Si mañana una pasa a abrir en una
 * marca concreta, sale de la lista.
 */
const SON_FILTROS: Record<string, string> = {
  'AvailabilityReportsPage.tsx': "el desplegable nace en '' = todas; es un filtro del informe",
  'SalesExceptionsPage.tsx': "brandFilter nace en 'all' y hay una vista agregada detrás",
  'KitchenAvailabilityPage.tsx': "brandFilter nace en '' y filtra por NOMBRE sobre una lista de la cuenta",
}

/**
 * Lo que delata que una pantalla elige una marca concreta al abrir.
 *
 * La primera versión usaba `[^)]*` y NO cazaba el caso de Precios —
 * `setBrandId((prev) => prev ?? bs[0]?.id ?? null)` — porque el paréntesis de
 * `(prev)` cortaba la búsqueda. Lo destapó la última prueba de este fichero, que
 * está justo para eso: una barrida que no salta con el código que la motivó no
 * prueba nada. Ahora se busca en una ventana de caracteres, paréntesis incluidos.
 */
const ABRE_EN_UNA_MARCA = /set(?:Selected)?Brand(?:Id)?\([\s\S]{0,80}?\b(?:bs|brands|marcas)\b\s*\??\.?\[0\]/

describe('toda pantalla de Kitchen que elige marca usa el recuerdo del módulo', () => {
  const ficheros = readdirSync(PAGINAS).filter((f) => f.endsWith('.tsx'))

  it('ninguna abre en «la primera que devuelva la consulta»', () => {
    const malas: string[] = []
    for (const f of ficheros) {
      const src = readFileSync(resolve(PAGINAS, f), 'utf8')
      if (!ABRE_EN_UNA_MARCA.test(src)) continue
      // `?? bs[0].id` detrás de `marcaConLaQueAbrir` es el último recurso legítimo:
      // una cuenta sin ninguna marca propia tiene que abrir en algo.
      if (!src.includes('marcaConLaQueAbrir')) {
        malas.push(`${f}: elige marca sin pasar por marcaConLaQueAbrir`)
      }
    }
    expect(malas, malas.join('\n')).toEqual([])
  })

  it('la que deja elegir marca, la guarda: si no, el recuerdo no se llena nunca', () => {
    const malas: string[] = []
    for (const f of ficheros) {
      const src = readFileSync(resolve(PAGINAS, f), 'utf8')
      if (!src.includes('marcaConLaQueAbrir')) continue
      if (!src.includes('guardaMarcaRecordada')) {
        malas.push(`${f}: lee el recuerdo y no lo escribe`)
      }
    }
    expect(malas, malas.join('\n')).toEqual([])
  })

  // Las cinco que a día de hoy trabajan SOBRE una marca. Si mañana hay una
  // sexta, la primera prueba la caza sola; ésta deja escrito el estado de hoy
  // para que un cambio se vea en la revisión y no de tapadillo.
  it('hoy son cinco, y son éstas', () => {
    const conRecuerdo = ficheros
      .filter((f) => readFileSync(resolve(PAGINAS, f), 'utf8').includes('marcaConLaQueAbrir'))
      .sort()
    expect(conRecuerdo).toEqual([
      'KitchenCasadoPage.tsx',
      'KitchenMenuEngineeringPage.tsx',
      'KitchenMenuPage.tsx',
      'KitchenProfitabilityPage.tsx',
      'PriceGridPage.tsx',
    ])
  })

  // Y las tres que NO llevan recuerdo a propósito, con el motivo delante: sin
  // esto, «no lo usa» y «no debe usarlo» se parecen demasiado dentro de un año.
  it('las tres que filtran siguen filtrando, y por escrito', () => {
    for (const [f, porQue] of Object.entries(SON_FILTROS)) {
      const src = readFileSync(resolve(PAGINAS, f), 'utf8')
      expect(src, `${f}: ${porQue}`).not.toContain('marcaConLaQueAbrir')
      expect(porQue.length).toBeGreaterThan(20)
    }
  })

  // Que la barrida sirva de algo: tiene que saltar con el código que falló.
  it('el detector reconoce el marcado que abría en la marca equivocada', () => {
    expect(ABRE_EN_UNA_MARCA.test('if (bs.length > 0) setSelectedBrandId(bs[0].id)')).toBe(true)
    expect(ABRE_EN_UNA_MARCA.test('setBrandId((prev) => prev ?? bs[0]?.id ?? null)')).toBe(true)
    expect(ABRE_EN_UNA_MARCA.test("setBrandFilter('')")).toBe(false)
  })
})
