// C01b · Lo puro de la ficha nueva: «Pedírselo por correo», «los más usados
// primero» y el reparto de la dirección «por confirmar». Casos escritos: no
// hay población real de estos tres (los borradores no se guardan, el orden
// depende de cada cuenta y las propuestas de la 0110 se prueban en staging
// contra la semilla, supabase/staging/sql/20261006_c01b_prueba_movimiento.sql).
import { describe, expect, it } from 'vitest'
import { correoPedirDatos } from '@/modules/conta/lib/textosFicha'
import { porUso } from '@/modules/conta/lib/masUsados'
import { repartoPropuesto } from '@/modules/conta/lib/direccion'
import type { ContactoProveedor } from '@/modules/conta/types'

const c = (p: Partial<ContactoProveedor>): ContactoProveedor =>
  ({ id: 'x', supplierId: 's', name: 'Ana', role: 'orders', phone: null, email: null, isPrimary: false, notes: null, ...p })

describe('pedírselo por correo', () => {
  const faltan = [
    { clave: 'contacto_admin', texto: 'contacto de administración' },
    { clave: 'tipo_gasto', texto: 'tipo de gasto' },
    { clave: 'certificado_banco', texto: 'certificado de titularidad bancaria' },
  ]
  it('va al de administración; si no, al principal; si no, a cualquiera con email', () => {
    const admin = c({ id: 'a', role: 'admin', email: 'admin@p.test' })
    const prin = c({ id: 'p', isPrimary: true, email: 'pedidos@p.test' })
    const otro = c({ id: 'o', role: 'sales', email: 'luis@p.test' })
    expect(correoPedirDatos({ name: 'P' }, [otro, prin, admin], faltan, null)?.para).toBe('admin@p.test')
    expect(correoPedirDatos({ name: 'P' }, [otro, prin], faltan, null)?.para).toBe('pedidos@p.test')
    expect(correoPedirDatos({ name: 'P' }, [otro], faltan, null)?.para).toBe('luis@p.test')
    // Nadie con email: el borrador sale sin destinatario, no deja de salir.
    const sin = correoPedirDatos({ name: 'P' }, [c({ phone: '600' })], faltan, null)
    expect(sin?.para).toBeNull()
    expect(sin?.href.startsWith('mailto:?subject=')).toBe(true)
  })
  it('no le pide lo de dentro de casa (el tipo de gasto) y, si no falta nada suyo, no hay botón', () => {
    const r = correoPedirDatos({ name: 'Hermanos Ruiz' }, [], faltan, 'Taberna de Prueba Norte')!
    expect(r.pide).toHaveLength(2)
    expect(decodeURIComponent(r.href)).toContain('Datos para vuestra ficha de proveedor en Taberna de Prueba Norte')
    expect(decodeURIComponent(r.href)).not.toContain('tipo de gasto')
    expect(correoPedirDatos({ name: 'P' }, [], [{ clave: 'tipo_gasto', texto: 'tipo de gasto' }], null)).toBeNull()
  })
})

describe('los más usados primero', () => {
  it('ordena por cuántos proveedores lo usan; a igualdad, el orden de la tabla; nunca quita', () => {
    const ops = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(porUso(ops, (o) => o.id, ['c', 'b', 'c', null, 'zz']).map((o) => o.id)).toEqual(['c', 'b', 'a', 'd'])
    expect(porUso(ops, (o) => o.id, []).map((o) => o.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('dirección por confirmar', () => {
  it('la del C01b ya viene repartida (con la población de la tabla de CP) y se respeta', () => {
    const v = { line: 'Calle Mayor 3, 28100 Alcobendas', street: 'Calle Mayor 3', postal_code: '28100', city: 'Alcobendas', province: 'Madrid' }
    expect(repartoPropuesto(v)).toEqual({ linea: v.line, reparto: { street: 'Calle Mayor 3', postalCode: '28100', city: 'Alcobendas', province: 'Madrid' } })
  })
  it('sin código postal no se inventa dónde acaba la calle', () => {
    const v = { line: 'Calle Mayor 3, Alcobendas', street: 'Calle Mayor 3, Alcobendas', postal_code: null, city: null, province: null }
    expect(repartoPropuesto(v).reparto).toEqual({ street: 'Calle Mayor 3, Alcobendas', postalCode: null, city: null, province: null })
  })
  it('una anterior con solo la línea se reparte con el núcleo', () => {
    expect(repartoPropuesto({ line: 'C/ Ejemplo 12, 28021 Madrid' }).reparto.postalCode).toBe('28021')
  })
})
