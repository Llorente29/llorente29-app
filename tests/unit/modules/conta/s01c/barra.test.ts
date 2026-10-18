// tests/unit/modules/conta/s01c/barra.test.ts
//
// S01c · El chip de la barra cuadra con el Inicio (Julio, 18/10): el de Inicio
// es la suma de los chips del «Te toca hoy», con la misma vara; cada producto
// lleva lo suyo; lo que no se ha podido contar no suma ni dice 0.

import { describe, expect, it } from 'vitest'
import { cuentasDeLaBarra, frasePendientes } from '@/modules/conta/esqueleto/cuentasBarra'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { MARCAS } from '../../../../../supabase/functions/_shared/marcas'

describe('S01c · el chip de la barra', () => {
  // Lo que se midió en staging con la cuenta A (auditoría S01b): 5 · 17 · 9 · 11 · 0.
  const contadas = { compras: 5, recibidas: 17, libros: 9, bancos: 11, terceros: 0 }

  it('Inicio suma lo mismo que los chips del «Te toca hoy»', () => {
    const chips = chipsDelInicio(contadas)
    const enInicio = chips.reduce((s, c) => s + (typeof c.numero === 'number' ? c.numero : 0), 0)
    expect(cuentasDeLaBarra(contadas).inicio).toBe(enInicio)
    expect(enInicio).toBe(42)
  })

  it('cada producto, lo suyo: Compras lleva sus papeles y las recibidas para revisar', () => {
    expect(cuentasDeLaBarra(contadas)).toEqual({ inicio: 42, contabilidad: 9, compras: 22, bancos: 11, contactos: 0 })
  })

  it('lo que no se ha podido contar no suma ni sale 0; sin nada contado, null', () => {
    expect(cuentasDeLaBarra({ compras: 3, recibidas: null, libros: null })).toMatchObject({ inicio: 3, compras: 3, contabilidad: null })
    expect(cuentasDeLaBarra({})).toMatchObject({ inicio: null, compras: null, bancos: null })
  })

  it('lo que dice al lector', () => {
    expect(frasePendientes(1)).toBe('1 por revisar')
    expect(frasePendientes(95)).toBe('95 por revisar')
  })
})

describe('S01c · el logo de la identidad del 14/10', () => {
  it('Sumied lleva sus tres ficheros; Folvy y la de pruebas, ninguno (el símbolo y el nombre)', () => {
    expect(MARCAS.sumied).toMatchObject({
      logo: '/marcas/sumied/sumied-simbolo.svg',
      logoHorizontal: '/marcas/sumied/sumied-logo-horizontal.svg',
      logoHorizontalBlanco: '/marcas/sumied/sumied-logo-horizontal-blanco.svg',
    })
    for (const id of ['folvy', 'contabilidad'] as const) expect(MARCAS[id]).toMatchObject({ logoHorizontal: null, logoHorizontalBlanco: null })
  })
})
