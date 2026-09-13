// tests/unit/modules/social/laTarjetaDeError.test.tsx
//
// La tarjeta de error de las publicaciones, en sus cuatro casos.
//
// EL VOLCADO DE ABAJO ES REAL (regla 31): es lo que estaba en
// `social_post.last_error` y lo que Julio veía en su pantalla, copiado tal
// cual. No es un ejemplo inventado — y por eso las guardas de más abajo, que
// comprueban que ESE texto no se pinta sin pedirlo, valen algo.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  laTarjetaDe, losBotones, textoDelDetalle, loDeLosIntentos,
  type ClaseDeFallo,
} from '@/modules/social/lib/laTarjetaDeError'

/** Tal cual estaba en la base. Con su fbtrace_id. */
const VOLCADO_REAL = 'IG publish: {"message":"Media ID is not available","type":"OAuthException",'
  + '"code":9007,"error_subcode":2207027,"is_transient":false,"error_user_title":"Cannot Publish",'
  + '"error_user_msg":"The media is not ready for publishing, please wait for a moment",'
  + '"fbtrace_id":"ALRlpRLSwaI4ndtlU9LeWVv"}'

const LAS_CUATRO: ClaseDeFallo[] = ['esperando', 'llave_caducada', 'imagen_no_descargable', 'rechazado']

describe('🔴 lo que ve el dueño del negocio, en palabras de la casa', () => {
  it('todavía no está lista: no es una avería, y lo dice sin alarma', () => {
    const t = laTarjetaDe('esperando')
    expect(t.titulo).toBe('Instagram aún estaba preparando la foto.')
    expect(t.queHacer).toBe('Se reintenta solo en unos minutos.')
    expect(t.esUnFallo).toBe(false)
    expect(t.tono).toBe('calma')
  })

  it('la llave caducada manda a UN solo sitio, no a tres', () => {
    const t = laTarjetaDe('llave_caducada')
    expect(t.titulo).toBe('La conexión con Instagram ha caducado.')
    expect(t.queHacer).toBe('Hay que renovarla.')
    expect(t.aDonde).not.toBeNull()
    expect(t.aDonde!.ruta).toBe('/social/ajustes')
  })

  it('la imagen que no se puede descargar dice qué hacer con ella', () => {
    const t = laTarjetaDe('imagen_no_descargable')
    expect(t.titulo).toBe('Instagram no ha podido descargar la imagen.')
    expect(t.queHacer).toContain('regenerar la imagen')
  })

  it('y cualquier otro es corto y honesto, sin inventarse la causa', () => {
    expect(laTarjetaDe('rechazado').titulo).toBe('Instagram ha rechazado la publicación.')
    expect(laTarjetaDe('otro').titulo).toBe('La publicación no ha salido.')
    // Una publicación vieja, de antes de que existiera la clave, no se queda muda.
    expect(laTarjetaDe(null).titulo).toBe('La publicación no ha salido.')
  })

  it('🔴 ninguna frase enseña jerga de Meta ni un identificador', () => {
    for (const c of [...LAS_CUATRO, 'otro' as ClaseDeFallo, null]) {
      const t = laTarjetaDe(c)
      const todo = `${t.titulo} ${t.queHacer} ${t.aDonde?.texto ?? ''}`
      expect(todo).not.toMatch(/OAuthException|fbtrace|error_subcode|media id|2207027|9007/i)
      expect(todo).not.toMatch(/[{}"[\]]/)
      // Y todas dicen algo: ninguna se queda en blanco.
      expect(t.titulo.length).toBeGreaterThan(10)
    }
  })
})

describe('🔴 los tres botones no pesan lo mismo', () => {
  it('reintentar es lo normal y descartar la excepción', () => {
    const b = losBotones('rechazado')
    expect(b.map((x) => x.id)).toEqual(['reintentar', 'editar', 'descartar'])
    expect(b[0].peso).toBe('principal')
    expect(b[2].peso).toBe('discreto')
  })

  it('y cuando sólo hay que esperar no se ofrece ninguno', () => {
    // Ofrecer «Reintentar» invita a pelearse con algo que se arregla solo, y
    // ofrecer «Descartar» es justo cómo se perdieron las nueve.
    expect(losBotones('esperando')).toEqual([])
  })
})

describe('los intentos, que hoy no se dicen en ningún sitio', () => {
  it('dice cuántos quedan, en plural y en singular', () => {
    expect(loDeLosIntentos(1)).toBe('Intentado 1 veces. Quedan 4 intentos automáticos.')
    expect(loDeLosIntentos(4)).toBe('Intentado 4 veces. Queda 1 intento automático.')
  })
  it('y cuando se acabaron, lo dice en vez de dejar la fila quieta y muda', () => {
    expect(loDeLosIntentos(5)).toContain('ya no se reintenta solo')
  })
  it('sin intentos no se inventa una línea', () => {
    expect(loDeLosIntentos(0)).toBeNull()
  })
})

// ── Las guardas ────────────────────────────────────────────────────────────

function Tarjeta({ clase, abierto }: { clase: ClaseDeFallo; abierto: boolean }) {
  const t = laTarjetaDe(clase)
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t.titulo}</p>
      {t.queHacer && <p style={{ margin: '4px 0 0', fontSize: 12.5 }}>{t.queHacer}</p>}
      {t.esUnFallo && <p style={{ fontSize: 11.5 }}>{loDeLosIntentos(2)}</p>}
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {t.aDonde && <a href={t.aDonde.ruta}>{t.aDonde.texto}</a>}
        <button type="button">{textoDelDetalle(abierto)}</button>
      </div>
      {abierto && <pre style={{ fontSize: 11 }}>{VOLCADO_REAL}</pre>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {losBotones(clase).map((b) => <button key={b.id} type="button" data-peso={b.peso}>{b.texto}</button>)}
      </div>
    </div>
  )
}

const CERRADAS = LAS_CUATRO.map((c) => renderToStaticMarkup(<Tarjeta clase={c} abierto={false} />)).join('\n')
const ABIERTA = renderToStaticMarkup(<Tarjeta clase="rechazado" abierto />)

describe('🔴 el volcado de Meta NO se pinta sin pedirlo', () => {
  it('con la tarjeta cerrada, ese texto no está en la pantalla', () => {
    expect(CERRADAS).not.toContain('fbtrace_id')
    expect(CERRADAS).not.toContain('OAuthException')
    expect(CERRADAS).not.toContain('2207027')
    expect(CERRADAS).not.toContain('Media ID is not available')
  })

  it('y al pedirlo aparece entero, porque tiene que existir para quien lo arregla', () => {
    expect(ABIERTA).toContain('fbtrace_id')
    expect(ABIERTA).toContain('2207027')
    expect(ABIERTA).toContain('Ocultar detalle')
  })

  it('las cuatro tarjetas se pintan y se dejan en dist para mirarlas', () => {
    expect(CERRADAS.length).toBeGreaterThan(500)
    const dist = resolve(__dirname, '../../../../dist')
    if (existsSync(dist)) {
      writeFileSync(resolve(dist, 'captura_social_errores.html'),
        `<div style="width:720px;padding:24px;font-family:system-ui">${CERRADAS}${ABIERTA}</div>`)
    }
  })
})

describe('🔴 la pantalla de verdad usa esta lib, no sus propias frases', () => {
  const pagina = readFileSync(
    resolve(__dirname, '../../../../src/modules/social/pages/SocialQueuePage.tsx'), 'utf8')

  it('llama a las cuatro funciones y no pinta `last_error` a pelo', () => {
    for (const f of ['laTarjetaDe', 'losBotones', 'textoDelDetalle', 'loDeLosIntentos']) {
      expect(pagina, `la pantalla no llama a ${f}`).toContain(f)
    }
    // La línea vieja: `Error al publicar: {row.last_error}`.
    expect(pagina).not.toContain('Error al publicar:')
  })

  it('y el volcado sólo se pinta cuando el detalle está abierto', () => {
    expect(pagina).toContain('abierto && detalle')
  })
})
