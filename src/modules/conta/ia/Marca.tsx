// src/modules/conta/ia/Marca.tsx
//
// La marca «IA» (o «Importado») de un dato de la empresa, con su motivo al
// tocarla (encargo §6.1). Sale solo si el dato SIGUE valiendo lo que puso la
// IA: si la persona lo cambió, no hay marca.

import { MarcaIA } from '@/modules/conta/ui/piezas'
import { marcaDe, type Origen } from '@/modules/conta/ia/tipos'

/** La primera de las marcas de una lista de campos (p. ej. los de la dirección). */
export function Marca({ origenes, tabla, fila, campos }: {
  origenes: Origen[]; tabla: string; fila: string; campos: [campo: string, valorActual: unknown][]
}) {
  for (const [campo, valor] of campos) {
    const o = marcaDe(origenes, tabla, fila, campo, valor)
    if (o) return <MarcaIA motivo={o.reason} importado={o.source === 'import'} />
  }
  return null
}
