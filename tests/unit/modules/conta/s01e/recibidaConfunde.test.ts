// S01e · Asientos › Recibida, lo que se contradecía:
//   · arriba el nombre del PDF y debajo «Esta factura no tiene papel guardado»;
//   · el proveedor «sin NIF» y, en «Lo que he comprobado», «✓ NIF … con forma válida»;
//   · «Sus facturas se apuntan en: sin decidir · aún no hay nada aprendido».

import { describe, expect, it } from 'vitest'
import { apoyoProveedor, comprobacionesSinContradecir, cuentaDeSusFacturas, textoSinPapel } from '@/modules/conta/documentos/RevisarFacturaPage.textos'

describe('el papel dice una sola cosa', () => {
  it('con nombre y sin fichero: llegó, pero no lo encuentro (no «no tiene papel»)', () => {
    const t = textoSinPapel({ archivo: 'invoice_1003_ES_I_1003_26_7.pdf', aMano: false, error: null })
    expect(t).toBe('Llegó «invoice_1003_ES_I_1003_26_7.pdf», pero no encuentro el fichero guardado: no lo puedo enseñar. Pídeselo al proveedor o súbelo otra vez.')
    expect(t).not.toMatch(/no tiene papel/)
  })
  it('escrita a mano: sin papel', () => {
    expect(textoSinPapel({ archivo: null, aMano: true, error: null })).toBe('Sin papel: apuntada a mano.')
  })
  it('con error al abrirlo, lo dice con su nombre', () => {
    expect(textoSinPapel({ archivo: 'a.pdf', aMano: false, error: 'caducado' })).toBe('Llegó «a.pdf», pero no se ha podido abrir: caducado')
  })
})

describe('el NIF: el de su ficha y el de la factura', () => {
  it('lo dice de cada sitio', () => {
    expect(apoyoProveedor('B12345674', null)).toBe('NIF B12345674 · está en tus proveedores')
    expect(apoyoProveedor(null, 'B12345674')).toBe('está en tus proveedores, pero su ficha no tiene NIF · la factura trae el B12345674')
    expect(apoyoProveedor(null, null)).toBe('está en tus proveedores · sin NIF: ni su ficha ni la factura lo traen')
  })

  const com = [
    { id: 'emisor_nif', ok: true, texto: 'NIF o NIE de quien la expide, con forma válida (art. 6.1.d).' },
    { id: 'suma', ok: true, texto: 'Cuadra: bases + IVA = total, al céntimo.' },
  ]
  it('sin NIF en ninguna parte, la comprobación del NIF no sale «✓»', () => {
    const r = comprobacionesSinContradecir(com, false)
    expect(r[0]).toEqual({ id: 'emisor_nif', ok: false, texto: 'No hay NIF del proveedor: ni la factura ni su ficha lo traen. Sin él no se puede deducir su IVA.' })
    expect(r[1]).toBe(com[1])
  })
  it('con NIF (en la ficha o en la factura), se queda como estaba', () => {
    expect(comprobacionesSinContradecir(com, true)).toEqual(com)
  })
})

describe('la cuenta de sus facturas, en palabras', () => {
  it('sin cuenta aprendida no dice «sin decidir · aún no hay nada aprendido»', () => {
    const r = cuentaDeSusFacturas(null)
    expect(r.valor).toBe('Aún sin cuenta fija')
    expect(`${r.valor} ${r.apoyo}`).not.toMatch(/sin decidir|aprendido/)
  })
  it('con cuenta: su nombre y su código, y de dónde sale', () => {
    expect(cuentaDeSusFacturas({ cuenta: '62800000', nombre: 'Suministros', origen: 'la eligió Ana' })).toEqual({ valor: 'Suministros · 62800000', apoyo: 'la eligió Ana' })
  })
})
