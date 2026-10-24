// tests/unit/modules/conta/s01c/recibidasOrden.test.ts
//
// S01c · «Recibida» abre la primera para revisar y la ficha cuenta «1 de N»:
// las dos listas tienen que salir en el mismo orden aunque la base devuelva
// las que llegaron a la vez en otro orden (pasó en la e2e: «4 de 17»).

import { describe, expect, it } from 'vitest'
import { facturasEnOrden, type FilaDocumento } from '@/modules/conta/documentos/documentos'

const fila = (id: string, llego: string, estado = 'para_mirar', tipo = 'factura') => ({ id, llego, estado, tipo }) as unknown as FilaDocumento

describe('S01c · las recibidas en el orden en que se recorren', () => {
  const a = fila('a', '2026-10-17T10:00:00Z')
  const b = fila('b', '2026-10-17T10:00:00Z')
  const c = fila('c', '2026-10-18T09:00:00Z')
  const apuntada = fila('d', '2026-10-18T11:00:00Z', 'apuntada')
  const llegada = fila('e', '2026-10-18T12:00:00Z', 'para_mirar', 'llegada')

  it('la última que llegó primero; con la misma llegada, el id decide', () => {
    expect(facturasEnOrden([a, b, c, apuntada, llegada], 'para-mirar')).toEqual(['c', 'a', 'b'])
  })
  it('da igual el orden en que lo devuelva la base', () => {
    expect(facturasEnOrden([b, c, a], 'para-mirar')).toEqual(facturasEnOrden([a, b, c], 'para-mirar'))
  })
})
