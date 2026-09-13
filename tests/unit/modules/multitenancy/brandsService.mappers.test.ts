// tests/unit/modules/multitenancy/brandsService.mappers.test.ts
//
// Los mapeos de `brand`: de la BBDD al dominio y de vuelta.
//
// ── POR QUÉ SE REESCRIBE ENTERO (13/09) ────────────────────────────────────
//
// Llevaba días en rojo y tres partes lo llamaron «deuda conocida». Al mirarlo
// de verdad no era una prueba desactualizada de adorno: **la tabla se movió y
// la prueba se quedó donde estaba**, y de paso escondía dos cosas peores que
// el rojo.
//
// Lo que decía la prueba vieja, contra lo que dice `information_schema`:
//
//   · `commission_pct` / `commissionPct`: NO EXISTE en `brand`. La comisión
//     vive en `brand_channel_rate`, `channel_rate` y
//     `channel_settlement_order`. El mapper ya no la emite, y hace bien.
//   · `shop_url`, `qr_caption`, `cuisine_code`: EXISTEN los tres y admiten
//     nulo. La fila de la prueba no los traía, así que el mapper los devolvía
//     `undefined` — no porque convirtiera nada, sino porque la fila inventada
//     no tenía esas claves. En producción los `select` son `select('*')`, o
//     sea que llegan siempre, y llegan a `null`.
//   · `ownership_type: 'cedida'`: **ese valor no existe**. La tabla solo tiene
//     `own` (18) y `licensed` (18), y el tipo `BrandOwnershipType` tampoco lo
//     admite. Aquella prueba estaba EN VERDE afirmando algo imposible: pasaba
//     porque el mapper hace un `as` y un `as` no comprueba nada. Verde y sin
//     valor, que es peor que roja — una roja al menos se ve.
//
// De ahí la regla que se aplica aquí: **la fila de la prueba se copia de la
// tabla**, no se escribe de memoria (regla 31). La de abajo es Smash Brothers
// Burgers tal y como está hoy en Foodint, con sus tres campos rellenos.
//
// Y se añade lo que faltaba y era lo importante: **el mapeo de ESCRITURA**. El
// de lectura no puede contestar la única pregunta que le hace daño a un
// cliente —«¿se puede borrar un campo, de verdad?»— porque si al guardar un
// `null` se convierte en «no toques esto», el campo no se limpia: se OMITE, y
// el valor viejo sobrevive a la limpieza sin que nadie lo vea.

import { describe, it, expect } from 'vitest'
import {
  rowToBrand, brandUpdateToRow, brandInsertToRow,
} from '@/modules/multitenancy/services/brandsService'
import type { RowBrand, BrandUpdate } from '@/types/multitenancy'

/**
 * FILA REAL. `select to_jsonb(b) from brand b where shop_url is not null`
 * sobre Foodint, 13/09. Los nombres y los valores son los de producción; solo
 * se acorta la URL del logo, que no aporta nada y ocupa una pantalla.
 */
const FILA_REAL = {
  id: '43d305cd-6b48-4a8d-b292-7d3aa09e9657',
  account_id: '51ad1792-6629-4ef7-833a-b57b09a86710',
  name: 'Smash Brothers Burgers',
  slug: 'smash-brothers-burgers',
  ownership_type: 'own',
  color: null,
  logo_url: 'https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/public/brand-logos/logo.png',
  shop_url: 'https://foodint.folvy.app/',
  qr_caption: 'Hazte un Multi',
  cuisine_code: 'burgers',
  notes: null,
  is_active: true,
  archived_at: null,
  created_at: '2026-06-12T07:58:41.048430+00:00',
  updated_at: '2026-09-01T06:44:06.223075+00:00',
  created_by: null,
  created_by_name: null,
} as unknown as RowBrand

function fila(cambios: Partial<Record<string, unknown>> = {}): RowBrand {
  return { ...FILA_REAL, ...cambios } as unknown as RowBrand
}

describe('rowToBrand · de la tabla al dominio', () => {
  it('mapea la fila real entera, y NO se inventa una comisión que ya no vive aquí', () => {
    expect(rowToBrand(fila())).toEqual({
      id: '43d305cd-6b48-4a8d-b292-7d3aa09e9657',
      accountId: '51ad1792-6629-4ef7-833a-b57b09a86710',
      name: 'Smash Brothers Burgers',
      slug: 'smash-brothers-burgers',
      ownershipType: 'own',
      color: null,
      logoUrl: 'https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/public/brand-logos/logo.png',
      shopUrl: 'https://foodint.folvy.app/',
      qrCaption: 'Hazte un Multi',
      cuisineCode: 'burgers',
      notes: null,
      isActive: true,
      archivedAt: null,
      createdAt: '2026-06-12T07:58:41.048430+00:00',
      updatedAt: '2026-09-01T06:44:06.223075+00:00',
      createdBy: null,
      createdByName: null,
    })
  })

  it('un null de la tabla llega como null, nunca como undefined ni como «null»', () => {
    // La distinción no es cosmética: aguas abajo, `undefined` significa «no
    // toques este campo» y `null` significa «déjalo vacío». Confundirlos es
    // justo cómo un valor viejo sobrevive a un borrado.
    const b = rowToBrand(fila({
      color: null, logo_url: null, shop_url: null, qr_caption: null,
      cuisine_code: null, notes: null, archived_at: null,
      created_by: null, created_by_name: null,
    }))
    for (const [clave, valor] of Object.entries(b)) {
      expect(valor, `${clave} no puede ser undefined`).not.toBeUndefined()
      expect(valor, `${clave} no puede ser la cadena "null"`).not.toBe('null')
    }
    expect(b.shopUrl).toBeNull()
    expect(b.qrCaption).toBeNull()
    expect(b.cuisineCode).toBeNull()
  })

  it('los dos únicos ownership_type que existen en la tabla, y no un tercero', () => {
    // 18 `own` y 18 `licensed`, medidos. La prueba vieja afirmaba `'cedida'`,
    // que no está ni en la tabla ni en el tipo, y pasaba igual porque el
    // mapper hace un `as`. Un `as` no comprueba: solo calla al compilador.
    expect(rowToBrand(fila({ ownership_type: 'own' })).ownershipType).toBe('own')
    expect(rowToBrand(fila({ ownership_type: 'licensed' })).ownershipType).toBe('licensed')
  })

  it('archivada: is_active false con su fecha', () => {
    const b = rowToBrand(fila({ is_active: false, archived_at: '2026-05-16T09:00:00Z' }))
    expect(b.isActive).toBe(false)
    expect(b.archivedAt).toBe('2026-05-16T09:00:00Z')
  })
})

// ── 🔴 LA PREGUNTA QUE HACE DAÑO ───────────────────────────────────────────
describe('🔴 brandUpdateToRow · ¿se puede BORRAR un campo, de verdad?', () => {
  it('sí: un null explícito viaja como null y limpia la columna', () => {
    const parche: BrandUpdate = {
      shopUrl: null, qrCaption: null, cuisineCode: null,
      color: null, logoUrl: null, notes: null,
    }
    const row = brandUpdateToRow(parche)
    // Presentes Y a null. Que la clave EXISTA es la mitad que importa: una
    // clave ausente no borra nada, deja el valor viejo donde estaba.
    for (const col of ['shop_url', 'qr_caption', 'cuisine_code', 'color', 'logo_url', 'notes']) {
      expect(Object.prototype.hasOwnProperty.call(row, col), `${col} no viaja`).toBe(true)
      expect((row as Record<string, unknown>)[col], `${col} no viaja a null`).toBeNull()
    }
  })

  it('y lo que no se toca NO viaja: un parche vacío no escribe ninguna columna', () => {
    expect(Object.keys(brandUpdateToRow({}))).toHaveLength(0)
  })

  it('undefined significa «no lo toques», y por eso nunca puede colarse solo', () => {
    // Es el contrato del parche, y es correcto. El peligro no es este `if`:
    // es que aguas arriba alguien mande `undefined` creyendo que borra. Por
    // eso el formulario de marca convierte '' en null ANTES de armar el
    // parche, y por eso esta pareja de pruebas va junta.
    const row = brandUpdateToRow({ shopUrl: undefined, name: 'Smash Brothers Burgers' })
    expect(Object.prototype.hasOwnProperty.call(row, 'shop_url')).toBe(false)
    expect(row.name).toBe('Smash Brothers Burgers')
  })

  it('la cadena entera del formulario: vaciar la casilla limpia la columna', () => {
    // La misma cuenta que hace `BrandDataTab` al guardar: '' → null → parche.
    // Sin esto, las dos mitades pueden ser correctas por separado y la
    // pantalla seguir sin borrar nada.
    const guardada = rowToBrand(fila())
    const enPantalla = { shopUrl: '', qrCaption: '  ', cuisineCode: '' }
    const parche: BrandUpdate = {}
    const limpia = (s: string) => (s.trim() === '' ? null : s.trim())
    if (limpia(enPantalla.shopUrl) !== guardada.shopUrl) parche.shopUrl = limpia(enPantalla.shopUrl)
    if (limpia(enPantalla.qrCaption) !== guardada.qrCaption) parche.qrCaption = limpia(enPantalla.qrCaption)
    if (limpia(enPantalla.cuisineCode) !== guardada.cuisineCode) parche.cuisineCode = limpia(enPantalla.cuisineCode)

    const row = brandUpdateToRow(parche)
    expect(row.shop_url).toBeNull()
    expect(row.qr_caption).toBeNull()
    expect(row.cuisine_code).toBeNull()
  })
})

// ── Lo que el alta NO deja poner, dicho en vez de callado ──────────────────
describe('brandInsertToRow · lo que se puede poner al crear una marca', () => {
  it('al crear NO se pueden poner tienda, cartel del QR ni tipo de cocina', () => {
    // No es un fallo escondido: `BrandInsert` tampoco los declara, así que el
    // compilador ya lo impide y el alta no ofrece esas casillas. Se escribe
    // aquí para que sea una DECISIÓN visible y no un olvido: quien añada esos
    // campos al alta y no toque este mapeo verá saltar esta prueba en vez de
    // preguntarse por qué se pierde lo que escribió.
    const row = brandInsertToRow({ accountId: 'a', name: 'Nueva', slug: 'nueva' })
    expect(Object.prototype.hasOwnProperty.call(row, 'shop_url')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(row, 'qr_caption')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(row, 'cuisine_code')).toBe(false)
    // Y los valores por defecto que sí pone.
    expect(row.ownership_type).toBe('own')
    expect(row.is_active).toBe(true)
  })
})
