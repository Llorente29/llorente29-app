// tests/conta/x14/negativosSalidaErp10.test.ts
//
// X14 · 2 (Julio, 25/11): la salida a ERP10 de un asiento con un importe en negativo va a K, después del X33. Hasta
// entonces, HOY SE PARA, con su frase, por la conexión (asientoErp10) y por el fichero (leerAsiento). Esta prueba lo deja
// escrito: cuando K la abra, esta prueba es la que cambia (claude/pendiente_negativos_un_solo_modelo.md).

import { describe, expect, it } from 'vitest'
import { asientoErp10 } from '../../../supabase/functions/_shared/erp10Escribir'
import { leerAsiento } from '../../../supabase/functions/_shared/erp10Ficheros'

const FRASE = 'Lleva un importe en negativo, y ERP10 los quiere en positivo. Métela a mano en ERP10.'

describe('X14 · 2 · un asiento en negativo no sale a ERP10 (todavía)', () => {
  it('por la conexión: su porqué', () => {
    expect(asientoErp10({ entryId: 'e1', numero: '4/1', fecha: '2026-11-12', apuntes: [
      { cuenta: '62800000', nombre: 'Inventada', concepto: 'Inventado', debe: -7000, haber: 0 },
      { cuenta: '57200001', nombre: 'Inventada', concepto: 'Inventado', debe: 0, haber: -7000 },
    ] })).toEqual({ porque: FRASE })
  })
  it('por el fichero: su porqué', () => {
    expect(leerAsiento({ entryId: 'e1', serie: 4, numero: 1, fecha: '2026-11-12', concepto: 'Inventado', lineas: [
      { cuenta: '62800000', nombre: 'Inventada', concepto: null, debe: -70, haber: 0 },
      { cuenta: '57200001', nombre: 'Inventada', concepto: null, debe: 0, haber: -70 },
    ] } as Parameters<typeof leerAsiento>[0])).toMatchObject({ entryId: 'e1', porque: FRASE })
  })
})
