// tests/unit/shell/eventBus.test.ts
//
// Bloque G-2 (Sprint 3, Sesión 14): tests del EventBus del Shell.
//
// Cubre:
//   - subscribe + publish → el handler recibe el payload.
//   - múltiples suscriptores a la misma key → todos reciben.
//   - desuscripción → el handler deja de recibir.
//   - aislamiento por key → un publish no dispara handlers de otra key.
//   - un handler que lanza error no impide a los demás ejecutarse.
//   - subscriberCount y clear.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eventBus } from '../../../src/shell/eventBus'

describe('eventBus', () => {
  beforeEach(() => {
    // El bus es singleton: limpiar entre tests para no arrastrar suscripciones.
    eventBus.clear()
  })

  it('entrega el payload al handler suscrito', () => {
    const received: string[] = []
    eventBus.subscribe<string>('test.event', payload => received.push(payload))

    eventBus.publish('test.event', 'hola')

    expect(received).toEqual(['hola'])
  })

  it('entrega a todos los handlers suscritos a la misma key', () => {
    const a = vi.fn()
    const b = vi.fn()
    eventBus.subscribe('multi.event', a)
    eventBus.subscribe('multi.event', b)

    eventBus.publish('multi.event', { n: 1 })

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledWith({ n: 1 })
  })

  it('deja de entregar tras desuscribir', () => {
    const handler = vi.fn()
    const unsubscribe = eventBus.subscribe('unsub.event', handler)

    eventBus.publish('unsub.event', 1)
    unsubscribe()
    eventBus.publish('unsub.event', 2)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(1)
  })

  it('no dispara handlers de otra key (aislamiento)', () => {
    const handler = vi.fn()
    eventBus.subscribe('key.a', handler)

    eventBus.publish('key.b', 'no debería llegar')

    expect(handler).not.toHaveBeenCalled()
  })

  it('un handler que lanza error no impide ejecutar a los demás', () => {
    const errorHandler = vi.fn(() => { throw new Error('boom') })
    const goodHandler = vi.fn()
    // Silenciar el console.error que el bus emite al capturar el throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    eventBus.subscribe('err.event', errorHandler)
    eventBus.subscribe('err.event', goodHandler)
    eventBus.publish('err.event', null)

    expect(errorHandler).toHaveBeenCalledTimes(1)
    expect(goodHandler).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
  })

  it('subscriberCount cuenta correctamente', () => {
    expect(eventBus.subscriberCount()).toBe(0)
    eventBus.subscribe('a', () => {})
    eventBus.subscribe('a', () => {})
    eventBus.subscribe('b', () => {})

    expect(eventBus.subscriberCount()).toBe(3)
    expect(eventBus.subscriberCount('a')).toBe(2)
    expect(eventBus.subscriberCount('b')).toBe(1)
  })

  it('clear elimina todas las suscripciones', () => {
    eventBus.subscribe('x', () => {})
    eventBus.subscribe('y', () => {})
    expect(eventBus.subscriberCount()).toBe(2)

    eventBus.clear()

    expect(eventBus.subscriberCount()).toBe(0)
  })
})
