// src/modules/conta/lib/aprendizaje.ts
//
// C01b §4 · «Lo que he aprendido de este proveedor». Folvy guarda, por
// proveedor, lo que la persona ha confirmado repetidamente al apuntar sus
// facturas (tipo de gasto, IVA, retención, forma y plazo de pago, IBAN
// comprobado) y lo propone en las siguientes. NUNCA contabiliza nada sin
// confirmación: aprender es proponer, no aplicar.
//
// La regla:
//   · Se aprende un valor cuando las ÚLTIMAS 3 confirmaciones de ese dato dicen
//     lo mismo (VECES_PARA_APRENDER). Si la última cambia, se desaprende hasta
//     que la nueva junte otras 3: lo último que hizo la persona manda.
//   · El porqué dice de dónde sale: «Lo confirmaste tú N veces» si fue la
//     persona; «Así vienen todas sus facturas» si TODAS las facturas lo traían
//     escrito y nadie lo cambió nunca; «Así vienen sus últimas N facturas» si
//     lo traían las últimas, pero antes fue distinto.
//   · Lo que la persona fija a mano con «Cambiar» gana a lo aprendido y no se
//     desaprende solo.

export type CampoAprendido = 'expense_category' | 'tax_rates' | 'withholding' | 'payment' | 'iban'

export const VECES_PARA_APRENDER = 3

export interface Confirmacion {
  campo: CampoAprendido
  /** Valor canónico para comparar (un id, una lista ordenada de ids, «transfer|30»…). */
  valor: string
  /** Cómo se lee: «60000000 · Compras de mercaderías», «IVA al 10 % y al 21 %»… */
  etiqueta: string
  /** ISO. */
  at: string
  /** 'persona': lo confirmó alguien; 'factura': venía así en la factura y nadie lo tocó. */
  origen: 'persona' | 'factura'
}

export interface FijadoAMano {
  campo: CampoAprendido
  valor: string
  etiqueta: string
  at: string
  porNombre: string | null
}

export interface Aprendido {
  campo: CampoAprendido
  valor: string
  etiqueta: string
  porque: string
  veces: number
  desde: string
  hasta: string
  aMano: boolean
}

const ORDEN: CampoAprendido[] = ['expense_category', 'tax_rates', 'withholding', 'payment', 'iban']

export function aprender(confirmaciones: readonly Confirmacion[], fijados: readonly FijadoAMano[] = []): Aprendido[] {
  const res: Aprendido[] = []
  for (const campo of ORDEN) {
    const fijado = fijados.filter((f) => f.campo === campo).sort((a, b) => b.at.localeCompare(a.at))[0]
    if (fijado) {
      res.push({
        campo, valor: fijado.valor, etiqueta: fijado.etiqueta, veces: 0, desde: fijado.at, hasta: fijado.at, aMano: true,
        porque: fijado.porNombre ? `Lo fijó ${fijado.porNombre} a mano` : 'Lo fijaste tú a mano',
      })
      continue
    }
    const del = confirmaciones.filter((c) => c.campo === campo).slice().sort((a, b) => b.at.localeCompare(a.at))
    if (del.length === 0) continue
    const racha: Confirmacion[] = []
    for (const c of del) {
      if (c.valor !== del[0].valor) break
      racha.push(c)
    }
    if (racha.length < VECES_PARA_APRENDER) continue
    const rachaDeFactura = racha.every((c) => c.origen === 'factura')
    const todasDeFactura = rachaDeFactura && racha.length === del.length
    const dePersona = racha.filter((c) => c.origen === 'persona').length
    res.push({
      campo,
      valor: racha[0].valor,
      etiqueta: racha[0].etiqueta,
      veces: racha.length,
      desde: racha[racha.length - 1].at,
      hasta: racha[0].at,
      aMano: false,
      porque: todasDeFactura
        ? 'Así vienen todas sus facturas'
        : rachaDeFactura
          ? `Así vienen sus últimas ${racha.length} facturas`
          : `Lo confirmaste tú ${dePersona} ${dePersona === 1 ? 'vez' : 'veces'}`,
    })
  }
  return res
}

/** Lo que se propone para la factura siguiente: SIEMPRE con confirmación pendiente. */
export function propuestaParaFactura(aprendidos: readonly Aprendido[]): { campo: CampoAprendido; valor: string; etiqueta: string; porque: string; necesitaConfirmacion: true }[] {
  return aprendidos.map((a) => ({ campo: a.campo, valor: a.valor, etiqueta: a.etiqueta, porque: a.porque, necesitaConfirmacion: true as const }))
}
