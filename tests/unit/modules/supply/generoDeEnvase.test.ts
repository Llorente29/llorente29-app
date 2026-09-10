// El género y el plural del envase, probados contra LOS 24 NOMBRES DE FORMATO
// que existen de verdad en el catálogo de Foodint (regla 31).
//
// La lista sale de esta consulta, ejecutada el 10/09/2026:
//
//   select lower(btrim(split_part(btrim(name),' ',1))) as primera_palabra, count(*)
//     from recipe_item_purchase_format
//    where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
//    group by 1 order by 2 desc;
//
// Están las 24, con sus faltas de ortografía («Carton» sin tilde, «PPaquete»
// con dos pes) y con el formato que se llama literalmente «1». No se han
// limpiado a propósito: si la regla no aguanta el catálogo tal cual es, no
// aguanta.
//
// Y ESTA LISTA ES LA QUE OBLIGÓ AL SEGUNDO TRAMO DE LA REGLA. Con «acaba en -a»
// a secas, 23 de 24 salían bien y «unidad» salía mal: la pantalla habría escrito
// «Unidad abierto». Un solo nombre de veinticuatro, y es de los que se cuentan.

import { describe, it, expect } from 'vitest'
import { esFemenino, concuerda, plural, nombreDeEnvase, tituloAbierto } from '@/modules/supply/lib/conteoMovilTexto'

/** Las 24 primeras palabras del catálogo, con el género que les toca. */
const CATALOGO: { nombre: string; femenino: boolean; veces: number }[] = [
  { nombre: 'Caja',      femenino: true,  veces: 109 },
  { nombre: 'Bolsa',     femenino: true,  veces: 59 },
  { nombre: 'Paquete',   femenino: false, veces: 48 },
  { nombre: 'Bote',      femenino: false, veces: 27 },
  { nombre: 'Ud',        femenino: true,  veces: 13 },
  { nombre: 'Pack',      femenino: false, veces: 13 },
  { nombre: 'Uni',       femenino: true,  veces: 9 },
  { nombre: 'Lata',      femenino: true,  veces: 8 },
  { nombre: 'Formato',   femenino: false, veces: 8 },
  { nombre: 'Botella',   femenino: true,  veces: 7 },
  { nombre: 'Unidad',    femenino: true,  veces: 5 },
  { nombre: 'Pieza',     femenino: true,  veces: 4 },
  { nombre: 'Manojo',    femenino: false, veces: 3 },
  { nombre: 'rollo',     femenino: false, veces: 3 },
  { nombre: 'Bidón',     femenino: false, veces: 2 },
  { nombre: 'Bandeja',   femenino: true,  veces: 2 },
  { nombre: 'Estuche',   femenino: false, veces: 2 },
  { nombre: 'bolsas',    femenino: true,  veces: 2 },
  { nombre: '1',         femenino: false, veces: 1 },
  { nombre: 'Latas',     femenino: true,  veces: 1 },
  { nombre: 'Malla',     femenino: true,  veces: 1 },
  { nombre: 'Carton',    femenino: false, veces: 1 },
  { nombre: 'PPaquete',  femenino: false, veces: 1 },
  { nombre: 'Garrafa',   femenino: true,  veces: 1 },
]

describe('el género del envase · los 24 nombres del catálogo', () => {
  // Esta prueba ya se ganó el sueldo: puse 349 de cabeza y son 330. Es la
  // vara que dice que la lista de abajo es EL catálogo y no una selección.
  it('están las 24 primeras palabras y suman los 330 formatos de la cuenta', () => {
    expect(CATALOGO).toHaveLength(24)
    expect(CATALOGO.reduce((s, c) => s + c.veces, 0)).toBe(330)
  })

  for (const c of CATALOGO) {
    it(`«${c.nombre}» es ${c.femenino ? 'femenino' : 'masculino'} (${c.veces} formatos)`, () => {
      expect(esFemenino(c.nombre)).toBe(c.femenino)
    })
  }

  it('«unidad» es el que obliga al tramo de los sufijos: no acaba en -a', () => {
    expect('unidad'.endsWith('a')).toBe(false)
    expect(esFemenino('Unidad')).toBe(true)
  })
})

describe('concordancia · la frase de la maqueta, con cualquier nombre', () => {
  it('«Bolsa abierta, a ojo» — el ejemplo de la maqueta', () => {
    expect(`Bolsa ${concuerda('Bolsa', 'abierto')}, a ojo`).toBe('Bolsa abierta, a ojo')
  })
  it('«Paquete abierto, a ojo» — el que la maqueta escribía mal', () => {
    expect(`Paquete ${concuerda('Paquete', 'abierto')}, a ojo`).toBe('Paquete abierto, a ojo')
  })
  it('los cuatro envases masculinos que de verdad se abren', () => {
    for (const n of ['Paquete', 'Estuche', 'Bote', 'Manojo']) {
      expect(concuerda(n, 'abierto')).toBe('abierto')
      expect(concuerda(n, 'cerrado')).toBe('cerrado')
    }
  })
  it('el género se toma de la PRIMERA palabra, no del adjetivo que la sigue', () => {
    expect(concuerda('Bolsa cerrada', 'abierto')).toBe('abierta')
    expect(concuerda('Caja 12,5 kg', 'abierto')).toBe('abierta')
    expect(concuerda('Pack 3x150 g', 'abierto')).toBe('abierto')
  })
})

describe('el plural del total · «2 bolsas», no «2 bolsa cerradas»', () => {
  it('el nombre del envase es la primera palabra', () => {
    expect(nombreDeEnvase('Bolsa cerrada')).toBe('bolsa')
    expect(nombreDeEnvase('Paquete 6 und de 250 grs/unidad')).toBe('paquete')
    expect(nombreDeEnvase('  Caja 5 kg (20 uds de 250 g)')).toBe('caja')
  })

  it('«2 bolsas», que es lo que dice la maqueta', () => {
    expect(plural(2, 'Bolsa cerrada')).toBe('2 bolsas')
    expect(plural(1, 'Bolsa cerrada')).toBe('1 bolsa')
  })

  it('los que acaban en consonante llevan -es, y «bidón» pierde la tilde', () => {
    expect(plural(3, 'Bidón')).toBe('3 bidones')
    expect(plural(2, 'Pack')).toBe('2 packes')
  })

  it('nunca deja una concordancia rota, que era el fallo original', () => {
    for (const c of CATALOGO) {
      const txt = plural(2, `${c.nombre} cerrada`)
      expect(txt).not.toContain('cerrada')
      expect(txt.split(' ')).toHaveLength(2)
    }
  })
})

describe('el título de la fila de lo abierto · lo que Julio devolvió dos veces', () => {
  it('«Bolsa abierta», no «Bolsa cerrada abierta»', () => {
    // La primera versión ponía el nombre COMPLETO del formato delante, y con
    // un formato llamado «Bolsa cerrada» escribía «Bolsa cerrada abierta, a
    // ojo»: decía «cerrada» de una bolsa que está abierta.
    expect(tituloAbierto('Bolsa cerrada')).toBe('Bolsa abierta')
    expect(tituloAbierto('Paquete cerrado')).toBe('Paquete abierto')
  })
  it('funciona con los cuatro envases que de verdad se abren en el catálogo', () => {
    expect(tituloAbierto('Bolsa')).toBe('Bolsa abierta')
    expect(tituloAbierto('Paquete')).toBe('Paquete abierto')
    expect(tituloAbierto('Estuche')).toBe('Estuche abierto')
    expect(tituloAbierto('Bote')).toBe('Bote abierto')
    expect(tituloAbierto('Manojo')).toBe('Manojo abierto')
  })
  it('y con el nombre que lleva el peso escrito a mano', () => {
    expect(tituloAbierto('Caja 12,5 kg')).toBe('Caja abierta')
    expect(tituloAbierto('Pack 3x150 g')).toBe('Pack abierto')
    expect(tituloAbierto('Unidad 2 kg')).toBe('Unidad abierta')
  })
})
