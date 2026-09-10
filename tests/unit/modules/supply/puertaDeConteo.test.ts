// LA PUERTA, DEL LADO DEL FRONT (incidente del 10/09, 12:34–12:43).
//
// La BBDD rechaza con FV002 cualquier escritura de `counted_qty` que no venga
// sellada por `save_count_line`. Sólo puede toparse con eso un cliente ANTIGUO
// —la versión que define este error, por definición, pasa por la puerta—, así
// que lo único que hay que hacer al recibirlo es recargar.
//
// Lo que se fija aquí es el reparto de códigos, que es lo que decide qué ve
// quien está contando:
//
//   FV002 → AppCaducadaError   → pantalla «hay una versión nueva» + recargar
//   FV001 → AbsurdQuantityError → se queda donde está y corrige la cantidad
//   otro  → Error a secas
//
// Y el ORDEN importa: FV002 se mira ANTES que FV001. Una app vieja contando
// 25 g contra 35 kg dispararía los dos; leer «cantidad fuera de escala» la
// mandaría a corregir un número que no es el problema.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  isSupabaseEnabled: true,
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}))

import {
  saveCountLine, clearCountLine, AppCaducadaError, AbsurdQuantityError,
} from '@/modules/supply/services/countEntryService'

const LINEA = '7bc1d572-34b8-47a6-ba34-60a23f3bdd24'
const ENTRADA = [{ method: 'peso' as const, qty: 750 }]

// El mensaje REAL del disparador, copiado de la migración p11. Si alguien lo
// cambia allí y no aquí, esta prueba no se entera — pero si lo cambia aquí sin
// mirar allí, se ve que está inventándose lo que lee el empleado.
const MENSAJE_FV002 =
  'Esta versión de Folvy es antigua y ya no puede guardar recuentos. Cierra la ' +
  'aplicación y vuelve a abrirla para actualizarla; lo que hayas contado no se ' +
  'ha perdido, vuelve a apuntarlo cuando se actualice.'

beforeEach(() => rpcMock.mockReset())
afterEach(() => vi.restoreAllMocks())

describe('la puerta · FV002 manda actualizar', () => {
  it('saveCountLine con FV002 lanza AppCaducadaError, con el mensaje del disparador', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'FV002', message: MENSAJE_FV002 } })
    await expect(saveCountLine(LINEA, ENTRADA)).rejects.toBeInstanceOf(AppCaducadaError)
    await expect(saveCountLine(LINEA, ENTRADA)).rejects.toThrow(/vuelve a abrirla para actualizarla/)
  })

  it('el mensaje dice QUÉ HACER, no qué ha fallado', () => {
    // Quien lo lee está de pie delante de una cámara. Ni «constraint», ni
    // «trigger», ni «counted_qty».
    expect(MENSAJE_FV002).not.toMatch(/constraint|trigger|counted_qty|FV002|null/i)
    expect(MENSAJE_FV002).toMatch(/Cierra la aplicación y vuelve a abrirla/)
    // Y dice que lo contado no se ha perdido, que es la pregunta que se hace
    // cualquiera al ver un error a mitad de un recuento.
    expect(MENSAJE_FV002).toMatch(/no se ha perdido/)
  })

  it('clearCountLine también lo reconoce: borrar es otra escritura', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'FV002', message: MENSAJE_FV002 } })
    await expect(clearCountLine(LINEA)).rejects.toBeInstanceOf(AppCaducadaError)
  })
})

describe('la puerta · no se come los otros errores', () => {
  it('FV001 sigue siendo la red de cordura, no una app vieja', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'FV001', message: 'Cantidad fuera de escala: …' } })
    await expect(saveCountLine(LINEA, ENTRADA)).rejects.toBeInstanceOf(AbsurdQuantityError)
  })

  it('un error cualquiera no se disfraza de app caducada', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'permiso denegado' } })
    const p = saveCountLine(LINEA, ENTRADA)
    await expect(p).rejects.not.toBeInstanceOf(AppCaducadaError)
    await expect(saveCountLine(LINEA, ENTRADA)).rejects.toThrow(/No se pudo guardar/)
  })

  it('sin error, devuelve el veredicto tal cual', async () => {
    rpcMock.mockResolvedValue({
      data: { verdict: 'recount', counted: 5750, entries: 2, attempt: 1,
              estimated: false, confirmed: false, needs_review: false },
      error: null,
    })
    const r = await saveCountLine(LINEA, ENTRADA)
    expect(r.verdict).toBe('recount')
    expect(r.counted).toBe(5750)
  })
})

describe('un array vacío no llega a la BBDD', () => {
  it('se para en el front y no se confunde con contar cero', async () => {
    await expect(saveCountLine(LINEA, [])).rejects.toThrow(/no es un cero/i)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
