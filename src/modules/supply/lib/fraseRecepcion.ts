// src/modules/supply/lib/fraseRecepcion.ts
//
// La frase de la pantalla «Recibido» (Compras · N21): la primera oración en
// negrita, como la maqueta («**Es un albarán.** La oficina esperará
// la factura.»).

export function partirFrase(frase: string): [string, string] {
  const i = frase.indexOf('. ')
  return i < 0 ? [frase, ''] : [frase.slice(0, i + 1), frase.slice(i + 2)]
}
