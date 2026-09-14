// tests/unit/modules/social/elCedazoDeLaLlave.test.ts
//
// EL CEDAZO QUE QUITA LA LLAVE ANTES DE ESCRIBIRLA.
//
// La función vive en la edge function, que corre en Deno y no entra en estas
// pruebas. Así que en vez de copiarla aquí —que sería tener dos definiciones
// de lo mismo, justo lo que llevamos todo el día quitando— la prueba LEE EL
// FICHERO DE VERDAD, le quita las anotaciones de tipo y ejecuta ESA.
//
// Si alguien la cambia y la rompe, esto salta. Si alguien la borra, esto no
// encuentra nada y salta también.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FUENTE = resolve(__dirname, '../../../../supabase/functions/social-publish/index.ts')

function elCedazoDeVerdad(): (s: string) => string {
  const src = readFileSync(FUENTE, 'utf8')
  const m = src.match(/function sinSecretos[\s\S]*?\n}/)
  if (!m) throw new Error('no encuentro `sinSecretos` en la edge function: ¿la han borrado?')
  const sinTipos = m[0].replace(/: string/g, '').replace('function sinSecretos', 'function')
  return eval(`(${sinTipos})`) as (s: string) => string
}

const cedazo = elCedazoDeVerdad()

/** Con la forma de los de Meta, pero inventados: aquí no entra una llave real. */
const LLAVE_IG = 'IGAAaBbCcDdEeFfGgHhIiJjKkLl123456789'
const LLAVE_EAA = 'EAAbBcCdDeEfFgGhHiIjJkKlLmM12345678'

describe('🔴 la llave no llega nunca a `last_error`', () => {
  it('la quita de una dirección web', () => {
    const s = cedazo(`IG estado: error para (https://graph.instagram.com/v23.0/178?fields=status_code&access_token=${LLAVE_IG})`)
    expect(s).not.toContain(LLAVE_IG)
    expect(s).toContain('access_token=[QUITADO]')
    // Y el mensaje sigue siendo legible: el paréntesis no se lo lleva por delante.
    expect(s).toContain(')')
  })

  it('la quita de un JSON', () => {
    const s = cedazo(`{"error":{"message":"bad"},"access_token":"${LLAVE_EAA}"}`)
    expect(s).not.toContain(LLAVE_EAA)
    expect(s).toContain('"access_token":"[QUITADO]"')
  })

  it('la quita de una cabecera Bearer', () => {
    const s = cedazo(`Authorization: Bearer ${LLAVE_IG} fallo`)
    expect(s).not.toContain(LLAVE_IG)
    expect(s).toContain('Bearer [QUITADO]')
  })

  it('y la quita AUNQUE VAYA SUELTA, sin etiqueta que la anuncie', () => {
    // Ésta es la red de debajo: corta por la FORMA del token, no por dónde
    // aparece. Es la que cubre el sitio que nadie ha pensado todavía.
    for (const llave of [LLAVE_IG, LLAVE_EAA]) {
      const s = cedazo(`se cayo con ${llave} dentro`)
      expect(s).not.toContain(llave)
      expect(s).toContain('[LLAVE QUITADA]')
    }
  })
})

describe('y NO estropea los mensajes que sí hay que leer', () => {
  it('el volcado real de Meta pasa entero', () => {
    // El de las 10 caídas del 2207027, tal cual estaba en la base.
    const real = 'IG publish: {"message":"Media ID is not available","type":"OAuthException",'
      + '"code":9007,"error_subcode":2207027,"error_user_title":"Cannot Publish",'
      + '"fbtrace_id":"ALRlpRLSwaI4ndtlU9LeWVv"}'
    expect(cedazo(real)).toBe(real)
  })

  it('y un texto en castellano no se toca', () => {
    const t = 'Instagram seguía preparando la foto tras 6 consultas en 28 s.'
    expect(cedazo(t)).toBe(t)
  })
})

describe('🔴 el cedazo está puesto en las puertas, no sólo escrito', () => {
  const src = readFileSync(FUENTE, 'utf8')

  it('toda escritura de `last_error` con texto VARIABLE pasa por él', () => {
    // Tres formas de escribir ahí y sólo tres son aceptables:
    //   · `null`                      — se está limpiando, no hay texto.
    //   · un literal fijo, sin `${}`  — lo escribimos nosotros, no hay llave.
    //   · `sinSecretos(...)`          — texto variable, cedazo obligatorio.
    // Cualquier otra cosa es una puerta nueva que se ha olvidado del cedazo, y
    // tiene que hacer saltar esto. (La primera versión de esta guarda daba por
    // mala la línea del rescate — un literal fijo — porque exigía que la línea
    // acabase en comilla y acaba en coma. Medido y corregido.)
    const escrituras = src.match(/last_error:[^\n]*/g) ?? []
    expect(escrituras.length).toBeGreaterThan(2)

    for (const linea of escrituras) {
      const esNull = /last_error:\s*null/.test(linea)
      const esLiteralFijo = /last_error:\s*"[^"]*"/.test(linea) && !linea.includes('${')
      const llevaCedazo = linea.includes('sinSecretos(')
      expect(
        esNull || esLiteralFijo || llevaCedazo,
        `esta escritura de last_error no pasa por el cedazo: ${linea.trim()}`,
      ).toBe(true)
    }
  })

  it('y la llave ya no viaja en la dirección', () => {
    expect(src).not.toContain('access_token=${encodeURIComponent(token)}')
    expect(src).toContain('Authorization: `Bearer ${token}`')
  })
})
