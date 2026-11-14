// src/modules/conta/lib/pdfDeLaRecibida.ts
//
// S01p·22 · Qué ofrece «Más acciones» de una factura recibida con su PDF:
//   · sin apuntar: «Cambiar el PDF» si tiene uno, «Subir el PDF» si no (se guarda con «Guardar cambios»);
//   · apuntada (asiento validado) y SIN PDF: «Subir el PDF», que se pone al momento y no cambia el
//     asiento (conta_recibida_papel_poner, 0831);
//   · apuntada CON PDF, o descartada: nada (cambiar el PDF de una apuntada pide anular su asiento).
// Mientras no se sabe si tiene PDF (aún se está leyendo), nada.

export type AccionPdf = { que: 'cambiar' | 'subir' | 'subir_apuntada'; etiqueta: string } | null

export function accionPdf(f: { validada: boolean; descartada: boolean; papelLeido: boolean; tienePapel: boolean }): AccionPdf {
  if (f.descartada) return null
  if (!f.validada) return f.tienePapel ? { que: 'cambiar', etiqueta: 'Cambiar el PDF' } : { que: 'subir', etiqueta: 'Subir el PDF' }
  if (f.papelLeido && !f.tienePapel) return { que: 'subir_apuntada', etiqueta: 'Subir el PDF' }
  return null
}
