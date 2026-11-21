// src/modules/conta/nucleo/recibida/cabecera.ts
//
// K10b · La cabecera de la recibida, como ERP10. Puro.
//   · El tipo de operación por factura: la lista de ERP10. Nace con el de su ficha (lo que la base y la
//     propuesta han usado siempre: país, NIF-IVA, VIES y régimen → claseIva). Cambiarlo en una factura no
//     toca la ficha. Al lado, «De su ficha» o «Cambiado en esta factura».
//   · «Se deduce en»: el trimestre. Si el de su fecha tiene el 303 presentado, el primero abierto, y se dice
//     («El 3T ya está presentado: va al 4T»). Se puede elegir otro abierto, nunca uno presentado (Julio,
//     27/10: el IVA presentado no se toca). Lo manda la fecha del asiento (Julio, 21/11).

import type { ClaseIva } from '@/modules/conta/lib/ivaProveedor'

export type Operacion = 'interior' | 'isp_interior' | 'intra_bienes' | 'intra_servicios' | 'fuera_ue' | 'exenta'

/**
 * Los tipos de operación de ERP10, en su orden. Los mismos valores que supplier_invoice_vat_operation_check (2150).
 * «corto», lo que enseña la casilla: a 1366 mide unos 170 px y los nombres enteros no caben (Julio, 21/11: nombres
 * cortos). El nombre entero, al pasar el ratón y en las razones del asiento.
 */
export const OPERACIONES: readonly { valor: Operacion; texto: string; corto: string }[] = [
  { valor: 'interior', texto: 'Operaciones interiores', corto: 'Interiores' },
  { valor: 'isp_interior', texto: 'Inversión del sujeto pasivo', corto: 'ISP interior' },
  { valor: 'intra_bienes', texto: 'Adquisición intracomunitaria de bienes', corto: 'Intracom. bienes' },
  { valor: 'intra_servicios', texto: 'Adquisición intracomunitaria de servicios', corto: 'Intracom. servicios' },
  { valor: 'fuera_ue', texto: 'Fuera de la UE (inversión del sujeto pasivo)', corto: 'Fuera UE (ISP)' },
  { valor: 'exenta', texto: 'Exenta o no sujeta', corto: 'Exenta o no sujeta' },
]

export const esOperacion = (x: unknown): x is Operacion => typeof x === 'string' && OPERACIONES.some((o) => o.valor === x)
export const textoDeOperacion = (o: Operacion | null): string => (o ? OPERACIONES.find((x) => x.valor === o)?.texto ?? o : '')
export const cortoDeOperacion = (o: Operacion | null): string => (o ? OPERACIONES.find((x) => x.valor === o)?.corto ?? o : '')

/**
 * El tipo de operación que le da su ficha. La intracomunitaria, de bienes (los dos van con el mismo tipo de
 * IVA: «Compra en otro país de la UE»). Uno de la UE sin NIF-IVA no tiene: su IVA es el de su país, al gasto.
 */
export function operacionDeLaClase(c: ClaseIva | null): Operacion | null {
  switch (c) {
    case 'nacional': return 'interior'
    case 'isp_nacional': return 'isp_interior'
    case 'intracomunitaria': return 'intra_bienes'
    case 'isp_extranjero': return 'fuera_ue'
    default: return null
  }
}

/** La clase de IVA con la que se propone el asiento: la del tipo de la factura si lo tiene; si no, la de su ficha. «exenta», el IVA de su factura. */
export function claseParaElAsiento(deLaFactura: Operacion | null, deLaFicha: ClaseIva): ClaseIva {
  switch (deLaFactura) {
    case 'interior': case 'exenta': return 'nacional'
    case 'isp_interior': return 'isp_nacional'
    case 'intra_bienes': case 'intra_servicios': return 'intracomunitaria'
    case 'fuera_ue': return 'isp_extranjero'
    default: return deLaFicha
  }
}

/** Lo que se dice al lado del tipo de operación. */
export function origenOperacion(deLaFactura: Operacion | null, deLaFicha: Operacion | null): 'De su ficha' | 'Cambiado en esta factura' | null {
  if (!deLaFactura) return deLaFicha ? 'De su ficha' : null
  return deLaFactura === deLaFicha ? 'De su ficha' : 'Cambiado en esta factura'
}

// ── El trimestre ──────────────────────────────────────────────────────────────

export interface Trimestre {
  /** Su primer día, «2026-10-01». */
  inicio: string
  /** «4T de 2026». */
  texto: string
  /** «4T». */
  corto: string
  presentado: boolean
}

const claveT = (anio: number, t: number) => `${anio}-${t}T`

function trimestre(anio: number, t: number, presentados: ReadonlySet<string>): Trimestre {
  return { inicio: `${anio}-${String((t - 1) * 3 + 1).padStart(2, '0')}-01`, texto: `${t}T de ${anio}`, corto: `${t}T`, presentado: presentados.has(claveT(anio, t)) }
}

/** El trimestre de una fecha ISO. */
export function trimestreDeFecha(fecha: string, presentados: ReadonlySet<string> = new Set()): Trimestre | null {
  if (!/^\d{4}-\d{2}/.test(fecha)) return null
  return trimestre(Number(fecha.slice(0, 4)), Math.floor((Number(fecha.slice(5, 7)) - 1) / 3) + 1, presentados)
}

/** Los que se pueden mirar: el de su fecha y los cuatro siguientes, con los presentados marcados (no se eligen). */
export function trimestresParaElegir(fecha: string, presentados: ReadonlySet<string>): Trimestre[] {
  const t0 = trimestreDeFecha(fecha)
  if (!t0) return []
  const anio = Number(t0.inicio.slice(0, 4)); const t = Number(t0.corto[0])
  return Array.from({ length: 5 }, (_, i) => trimestre(anio + Math.floor((t - 1 + i) / 4), ((t - 1 + i) % 4) + 1, presentados))
}

export interface TrimestrePropuesto {
  trimestre: Trimestre | null
  /** Lo dice la franja ámbar, si va a otro: «El 3T ya está presentado: va al 4T». */
  aviso: string | null
  /** ¿Elegido en esta factura (deduct_from)? */
  elegido: boolean
}

/** El trimestre en que se deduce: el elegido; si no, el de su fecha, o el primero abierto si el suyo está presentado. */
export function trimestrePropuesto(x: { fecha: string; deduceEn: string | null; presentados: ReadonlySet<string> }): TrimestrePropuesto {
  const lista = trimestresParaElegir(x.fecha, x.presentados)
  if (!lista.length) return { trimestre: null, aviso: null, elegido: false }
  if (x.deduceEn) {
    const e = trimestreDeFecha(x.deduceEn, x.presentados)
    if (e && !e.presentado) return { trimestre: e, aviso: null, elegido: true }
  }
  const suyo = lista[0]
  if (!suyo.presentado) return { trimestre: suyo, aviso: null, elegido: false }
  const abierto = lista.find((t) => !t.presentado) ?? null
  return {
    trimestre: abierto,
    aviso: abierto ? `El ${suyo.corto} ya está presentado: va al ${abierto.corto}.` : `El ${suyo.corto} ya está presentado y no hay un trimestre abierto después.`,
    elegido: false,
  }
}

/** Los 303 presentados, como «2026-3T». Un 303 mensual cuenta para su trimestre si los tres meses lo están. */
export function presentadosDe(declaraciones: readonly { ejercicio: number; periodo: string }[]): Set<string> {
  const s = new Set<string>()
  const meses = new Map<string, Set<string>>()
  for (const d of declaraciones) {
    if (/^[1-4]T$/.test(d.periodo)) s.add(claveT(d.ejercicio, Number(d.periodo[0])))
    else if (/^(0[1-9]|1[0-2])$/.test(d.periodo)) {
      const k = claveT(d.ejercicio, Math.floor((Number(d.periodo) - 1) / 3) + 1)
      meses.set(k, (meses.get(k) ?? new Set()).add(d.periodo))
    }
  }
  for (const [k, m] of meses) if (m.size === 3) s.add(k)
  return s
}
