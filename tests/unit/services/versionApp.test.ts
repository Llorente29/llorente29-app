import { describe, it, expect, beforeEach } from 'vitest'
import { hayVersionNueva, leeVersionPublicada } from '@/services/versionApp'
import {
  declaraTrabajoEnCurso, hayTrabajoEnCurso, detalleTrabajoEnCurso, _vaciaRegistro,
} from '@/services/trabajoEnCurso'
import { calculaBuildId, calculaEntorno } from '../../../build/folvyVersionPlugin'

describe('hayVersionNueva', () => {
  it('detecta que lo publicado no es lo que se ejecuta', () => {
    expect(hayVersionNueva('202608310500-aaaaaaaa', { buildId: '202609010700-bbbbbbbb' })).toBe(true)
  })
  it('la misma build no avisa', () => {
    expect(hayVersionNueva('202609010700-bbbbbbbb', { buildId: '202609010700-bbbbbbbb' })).toBe(false)
  })

  // FALLA CERRADO HACIA EL SILENCIO. Un aviso que sale sin estar seguro enseña
  // a ignorarlo, y entonces no sirve el día que sea verdad.
  it('sin saber qué build se ejecuta (dev), no avisa', () => {
    expect(hayVersionNueva(null, { buildId: 'x' })).toBe(false)
  })
  it('sin poder leer lo publicado, no avisa', () => {
    expect(hayVersionNueva('a', null)).toBe(false)
  })
  it('un version.json sin buildId no avisa', () => {
    expect(hayVersionNueva('a', { buildId: '' })).toBe(false)
  })
})

describe('leeVersionPublicada', () => {
  it('lee el buildId y pide SIN CACHÉ', async () => {
    let vistoInit: RequestInit | undefined
    const fake = (async (_u: string, init?: RequestInit) => {
      vistoInit = init
      return { ok: true, json: async () => ({ buildId: 'b1', builtAt: '2026-09-01T05:00:00Z' }) }
    }) as unknown as typeof fetch
    const v = await leeVersionPublicada(fake)
    expect(v).toEqual({ buildId: 'b1', builtAt: '2026-09-01T05:00:00Z' })
    // Sin no-store el navegador devolvería la copia con la que se cargó la
    // pestaña y el vigía no vería NUNCA un cambio: el mismo fallo que viene a
    // detectar, un piso más abajo.
    expect(vistoInit?.cache).toBe('no-store')
  })
  it('un 404 (aún sin desplegar) devuelve null, no revienta', async () => {
    const fake = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
    expect(await leeVersionPublicada(fake)).toBeNull()
  })
  it('sin red devuelve null', async () => {
    const fake = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await leeVersionPublicada(fake)).toBeNull()
  })
  it('una respuesta con basura devuelve null', async () => {
    const fake = (async () => ({ ok: true, json: async () => ({ buildId: 42 }) })) as unknown as typeof fetch
    expect(await leeVersionPublicada(fake)).toBeNull()
  })
})

describe('trabajoEnCurso — «nunca en mitad de un pedido»', () => {
  beforeEach(() => _vaciaRegistro())

  it('sin nada declarado, se puede recargar', () => {
    expect(hayTrabajoEnCurso()).toBe(false)
  })
  it('con pedidos abiertos, no', () => {
    declaraTrabajoEnCurso('orders:alcala', 3)
    expect(hayTrabajoEnCurso()).toBe(true)
  })
  it('al cerrarse el último, vuelve a poderse', () => {
    declaraTrabajoEnCurso('orders:alcala', 1)
    declaraTrabajoEnCurso('orders:alcala', 0)
    expect(hayTrabajoEnCurso()).toBe(false)
  })

  // El motivo de que sea por CLAVE: dos pantallas montadas a la vez.
  it('una pantalla libre NO borra el trabajo de otra', () => {
    declaraTrabajoEnCurso('orders:alcala', 2)
    declaraTrabajoEnCurso('orders:carabanchel', 0)
    expect(hayTrabajoEnCurso()).toBe(true)
    expect(detalleTrabajoEnCurso()).toEqual([{ clave: 'orders:alcala', cuantas: 2 }])
  })
  it('un negativo se trata como cero, no como trabajo', () => {
    declaraTrabajoEnCurso('raro', -1)
    expect(hayTrabajoEnCurso()).toBe(false)
  })
})

describe('calculaBuildId', () => {
  it('lleva el minuto, para que dos builds seguidas no colisionen', () => {
    const id = calculaBuildId(new Date('2026-09-01T07:15:00Z'))
    expect(id.startsWith('202609010715-')).toBe(true)
  })
  it('cambia al cambiar el minuto', () => {
    const a = calculaBuildId(new Date('2026-09-01T07:15:00Z'))
    const b = calculaBuildId(new Date('2026-09-01T07:16:00Z'))
    expect(a).not.toBe(b)
  })
})

describe('calculaEntorno — «esto no es producción»', () => {
  it('reconoce una preview de Vercel con su rama', () => {
    expect(calculaEntorno({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat-hubrise-fase3-ui' }))
      .toEqual({ entorno: 'preview', rama: 'feat-hubrise-fase3-ui' })
  })
  it('reconoce producción', () => {
    expect(calculaEntorno({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }))
      .toEqual({ entorno: 'production', rama: 'main' })
  })

  // FALLA HACIA AVISAR, al revés que el aviso de versión nueva. Aquí el error
  // caro es callarse: una preview sin etiqueta es alguien operando el negocio
  // sin saberlo. Una etiqueta de más es una franja fea cinco minutos.
  it('sin VERCEL_ENV no se da por producción: es «local»', () => {
    expect(calculaEntorno({}).entorno).toBe('local')
  })
  it('un valor raro tampoco cuela como producción', () => {
    expect(calculaEntorno({ VERCEL_ENV: 'PRODUCTION' }).entorno).toBe('local')
    expect(calculaEntorno({ VERCEL_ENV: 'staging' }).entorno).toBe('local')
  })
  it('una preview sin rama sigue siendo preview', () => {
    expect(calculaEntorno({ VERCEL_ENV: 'preview' })).toEqual({ entorno: 'preview', rama: null })
  })
})

// 01/09, la tarde del mismo día. El bundle OTA de las tablets lo construye
// GitHub Actions, donde no hay VERCEL_ENV: caía en 'local' y Pase (12:16) y
// camichi4 (09:16) pintaron «BUILD LOCAL» siendo producción pura. El arreglo
// no ablanda el fallback: hace que quien construye lo DECLARE.
describe('calculaEntorno — quien construye fuera de Vercel lo declara', () => {
  it('GitHub Actions en main declara producción y no pinta franja', () => {
    expect(calculaEntorno({ FOLVY_ENTORNO: 'production', FOLVY_RAMA: 'main' }))
      .toEqual({ entorno: 'production', rama: 'main' })
  })

  it('un dispatch desde una rama deja la variable vacía y SIGUE etiquetando', () => {
    // Es la red de seguridad de publicar una rama al bucket de las tres
    // tablets: sale etiquetado y se ve en las tres a la vez.
    expect(calculaEntorno({ FOLVY_ENTORNO: '', FOLVY_RAMA: 'claude/lo-que-sea' }))
      .toEqual({ entorno: 'local', rama: 'claude/lo-que-sea' })
  })

  it('un valor raro declarado tampoco cuela como producción', () => {
    expect(calculaEntorno({ FOLVY_ENTORNO: 'PRODUCTION' }).entorno).toBe('local')
    expect(calculaEntorno({ FOLVY_ENTORNO: 'prod' }).entorno).toBe('local')
    expect(calculaEntorno({ FOLVY_ENTORNO: 'staging' }).entorno).toBe('local')
  })

  // EL INCIDENTE ORIGINAL, AL REVÉS. Julio operó el negocio desde una preview
  // sin saberlo. Ninguna variable puede devolvernos ahí: dentro de Vercel,
  // Vercel tiene la última palabra sobre sus propias builds.
  it('una PREVIEW de Vercel no se puede reetiquetar como producción', () => {
    expect(calculaEntorno({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'feat-hubrise-fase3-ui',
      FOLVY_ENTORNO: 'production',
    })).toEqual({ entorno: 'preview', rama: 'feat-hubrise-fase3-ui' })
  })

  it('un development de Vercel tampoco, ni con la declaración puesta', () => {
    expect(calculaEntorno({ VERCEL_ENV: 'development', FOLVY_ENTORNO: 'production' }).entorno)
      .toBe('local')
  })

  it('la rama de Vercel manda sobre la declarada', () => {
    expect(calculaEntorno({
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      FOLVY_RAMA: 'otra',
    }).rama).toBe('main')
  })
})
