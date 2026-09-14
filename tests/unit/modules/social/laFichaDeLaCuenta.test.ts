// La ficha de la cuenta de Instagram. Todo el castellano vive en `lib/` y esto
// lo fija.
//
// LAS FECHAS SON LAS DE LA AVERÍA REAL (regla 31), no ejemplos inventados:
//   · la llave se creó el 05/07/2026 a las 16:17 PDT
//   · Meta dijo que caducó el 03/09/2026 a las 16:12:45 PDT — 60 días clavados
//   · Julio la renovó a mano el 13/09 a las 21:12:27 de Madrid
//   · la siguiente caduca el 12/11/2026 a las 19:12:27 UTC
// Los cinco fallos por llave caducada son del 07 al 12/09.

import { describe, it, expect } from 'vitest'
import {
  enQueEstaLaLlave, comoEstaLaCuenta, elTonoDeLaCuenta, laCuentaAtras,
  elRenglonDeLaCaducidad, loUltimoQueSalio, DIAS_DE_AVISO, DIAS_CRITICOS,
  type CuentaDeRed,
} from '@/modules/social/lib/laFichaDeLaCuenta'

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES')

const C = (o: Partial<CuentaDeRed> = {}): CuentaDeRed => ({
  red: 'instagram',
  enlazada: true,
  enlazadaEl: '2026-07-05',
  llaveNombre: 'ig_token_foodint',
  llaveOkAt: '2026-09-14T07:00:21.178Z',
  llaveFalloAt: null,
  llaveFalloClase: null,
  llaveCaducaEl: '2026-11-12T19:12:27Z',
  diasParaCaducar: 59,
  ultimaPublicacion: '2026-09-14T07:00:21.178Z',
  ...o,
})

describe('en qué está la llave', () => {
  it('publicando cuando lo último que hizo fue funcionar', () => {
    expect(enQueEstaLaLlave(C())).toBe('publicando')
  })

  it('🔴 rota cuando el último fallo es MÁS NUEVO que el último acierto', () => {
    // Justo lo que pasó: publicó bien hasta el 04/09 y a partir de ahí Meta
    // empezó a rechazarla.
    expect(enQueEstaLaLlave(C({
      llaveOkAt: '2026-09-03T20:00:00Z',
      llaveFalloAt: '2026-09-07T10:00:00Z', llaveFalloClase: 'llave_caducada',
    }))).toBe('rota')
  })

  it('y vuelve a «publicando» cuando acierta DESPUÉS, sin borrar el fallo', () => {
    // El fallo se queda escrito a propósito: borrar la prueba de que algo se
    // rompió es lo que hacía A2c, y se pagó una vez.
    const c = C({
      llaveFalloAt: '2026-09-12T10:00:00Z', llaveFalloClase: 'llave_caducada',
      llaveOkAt: '2026-09-14T07:00:21.178Z',
    })
    expect(enQueEstaLaLlave(c)).toBe('publicando')
    expect(c.llaveFalloAt).not.toBeNull()
  })

  it('🔴 sin_estrenar NO es «todo bien»: es que no se sabe', () => {
    const c = C({ llaveOkAt: null, llaveFalloAt: null })
    expect(enQueEstaLaLlave(c)).toBe('sin_estrenar')
    expect(comoEstaLaCuenta(c, fecha)).toContain('es una suposición')
    expect(elTonoDeLaCuenta(c)).toBe('aviso')
  })

  it('sin enlazar se dice, y no se pinta en rojo', () => {
    const c = C({ red: 'tiktok', enlazada: false })
    expect(enQueEstaLaLlave(c)).toBe('sin_enlazar')
    expect(comoEstaLaCuenta(c, fecha)).toContain('a mano')
    expect(elTonoDeLaCuenta(c)).toBe('apagado')
  })
})

describe('lo que dice la ficha', () => {
  it('si no se puede publicar, lo dice lo primero y en rojo', () => {
    const c = C({
      llaveOkAt: '2026-09-03T20:00:00Z',
      llaveFalloAt: '2026-09-07T10:00:00Z', llaveFalloClase: 'llave_caducada',
    })
    expect(comoEstaLaCuenta(c, fecha)).toContain('La llave no vale')
    expect(comoEstaLaCuenta(c, fecha)).toContain('no se publica nada')
    expect(elTonoDeLaCuenta(c)).toBe('malo')
  })

  it('publicando dice DESDE CUÁNDO se sabe, no sólo que sí', () => {
    expect(comoEstaLaCuenta(C(), fecha)).toContain('14/9/2026')
  })

  it('🔴 la cuenta atrás calla mientras falta mucho, y la fecha se dice igual', () => {
    // Regla 7: el umbral decide si esto INTERRUMPE, no si el dato existe.
    const c = C({ diasParaCaducar: 59 })
    expect(laCuentaAtras(c)).toBeNull()
    expect(elRenglonDeLaCaducidad(c, fecha)).toContain('12/11/2026')
    expect(elRenglonDeLaCaducidad(c, fecha)).toContain('faltan 59 días')
  })

  it('avisa a los 14 y aprieta a los 5, los mismos días que el vigía', () => {
    expect(laCuentaAtras(C({ diasParaCaducar: DIAS_DE_AVISO }))!).toContain('esta semana')
    expect(laCuentaAtras(C({ diasParaCaducar: DIAS_CRITICOS }))!).toContain('Renuévala ya')
    expect(laCuentaAtras(C({ diasParaCaducar: 1 }))!).toContain('1 día.')
    expect(laCuentaAtras(C({ diasParaCaducar: 0 }))!).toContain('HOY')
    expect(laCuentaAtras(C({ diasParaCaducar: -3 }))!).toContain('ya ha caducado')
  })

  it('el renglón dice dónde se renueva y con qué nombre', () => {
    const t = elRenglonDeLaCaducidad(C(), fecha)!
    expect(t).toContain('Folvy Social')
    expect(t).toContain('ig_token_foodint')
  })

  it('🔴 y nunca sale la llave, sólo su nombre', () => {
    const c = C()
    const todo = [comoEstaLaCuenta(c, fecha), laCuentaAtras(c) ?? '',
                  elRenglonDeLaCaducidad(c, fecha) ?? '', loUltimoQueSalio(c, fecha) ?? ''].join(' ')
    expect(todo).not.toMatch(/(IG|EAA)[A-Za-z0-9_-]{20,}/)
  })

  it('lo último que salió es la otra mitad de la prueba', () => {
    expect(loUltimoQueSalio(C(), fecha)).toContain('14/9/2026')
    expect(loUltimoQueSalio(C({ ultimaPublicacion: null }), fecha))
      .toBe('Todavía no ha salido ninguna publicación por aquí.')
  })
})
