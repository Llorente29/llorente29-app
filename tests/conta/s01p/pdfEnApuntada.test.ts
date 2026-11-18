// tests/conta/s01p/pdfEnApuntada.test.ts
//
// S01p·22 · «Subir el PDF» en «Más acciones» de una recibida: también en una ya apuntada que no lo
// tiene (como la GLOVOAPP I170326000585810 de Foodint, asiento 2/3438); «Cambiar el PDF» de una
// apuntada, no, como hasta ahora.
import { describe, expect, it } from 'vitest'
import { accionPdf } from '@/modules/conta/lib/pdfDeLaRecibida'

const f = (o: Partial<Parameters<typeof accionPdf>[0]>) => accionPdf({ validada: false, descartada: false, papelLeido: true, tienePapel: false, ...o })

describe('S01p·22 · el PDF de una recibida', () => {
  it('sin apuntar: subir si no tiene, cambiar si tiene (como antes)', () => {
    expect(f({})).toEqual({ que: 'subir', etiqueta: 'Subir el PDF' })
    expect(f({ tienePapel: true })).toEqual({ que: 'cambiar', etiqueta: 'Cambiar el PDF' })
  })
  it('apuntada y sin PDF: «Subir el PDF», que se pone al momento', () => {
    expect(f({ validada: true })).toEqual({ que: 'subir_apuntada', etiqueta: 'Subir el PDF' })
  })
  it('apuntada con PDF: no se cambia (pide anular su asiento), como hasta ahora', () => {
    expect(f({ validada: true, tienePapel: true })).toBeNull()
  })
  it('descartada, o sin saber aún si tiene PDF, nada', () => {
    expect(f({ descartada: true })).toBeNull()
    expect(f({ validada: true, papelLeido: false })).toBeNull()
  })
})
