// src/modules/conta/gestoria/q10/pdf.ts
//
// Q10 · El PDF de una factura de la cuota del mes, con el modelo «Sumied» (la
// maqueta aprobada del 09/11, _shared/facturaSumiedPdf.ts): el mismo que sale
// de un recibo, con una sola línea (la suscripción de GoCardless), sin
// Verifactu (estas dos empresas no lo usan) y la franja de «Pagada el…» con el día real
// del cobro. Puro: no lee nada.

import { cuentaEnmascarada, fechaLarga, type DatosFacturaSumied } from '../../../../../supabase/functions/_shared/facturaSumiedPdf'
import { nombreDelMesQ10, type BorradorQ10 } from './facturasDelMes'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())

/** Lo que hace falta de la empresa emisora (company) para la cabecera. */
export function emisorQ10(emp: Fila, logo: DatosFacturaSumied['emisor']['logo'] = null): DatosFacturaSumied['emisor'] {
  const calle = [s(emp.fiscal_street_type), s(emp.fiscal_street), s(emp.fiscal_number), s(emp.fiscal_extra)].filter(Boolean).join(' ')
  const direccion = [calle, [s(emp.fiscal_postal_code), s(emp.fiscal_city)].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  const contacto = [s(emp.email), s(emp.phone)].filter(Boolean).join(' · ')
  return { nombre: s(emp.trade_name) ?? s(emp.legal_name) ?? '', nif: s(emp.tax_id) ?? '', lineas: [direccion, contacto].filter(Boolean), logo }
}

export interface OpcionesPdfQ10 {
  emisor: DatosFacturaSumied['emisor']
  /** El número, o null mientras es un borrador («Borrador»). */
  numero: string | null
  /** AAAA-MM-DD: el día en que se emite. */
  fecha: string
  /** Los últimos dígitos y el país de la cuenta del mandato, si se saben. */
  cuenta: { pais: string | null; final: string | null } | null
  demo?: boolean
}

export function datosPdfQ10(b: BorradorQ10, mes: string, o: OpcionesPdfQ10): DatosFacturaSumied {
  const periodo = nombreDelMesQ10(mes)
  return {
    emisor: o.emisor,
    numero: o.numero ?? 'Borrador',
    fecha: o.fecha,
    pagadaEl: b.cobro.fecha,
    periodo: `Cuota de ${periodo}`,
    cliente: { nombre: b.ficha.nombre, nif: b.ficha.nif ?? '', codigo: null, direccion: b.ficha.direccion },
    // Como la factura de un recibo (facturaSumiedDatos): «Cargada el 4 de noviembre · pagada». La cuota y el día del cobro van en la línea.
    pago: { forma: 'Domiciliación SEPA', cuenta: cuentaEnmascarada(o.cuenta?.pais ?? null, o.cuenta?.final ?? null), texto: `Cargada el ${fechaLarga(b.cobro.fecha, false)} · pagada` },
    lineas: [{ concepto: b.concepto, explicacion: b.texto, cantidad: 1, precioCent: b.baseCent, importeCent: b.baseCent, trabajadores: null, trabajadoresEn: null }],
    porTipo: [{ tipo: 21, baseCent: b.baseCent, ivaCent: b.ivaCent }],
    baseCent: b.baseCent,
    ivaCent: b.ivaCent,
    retencion: b.retencion,
    totalCent: b.totalCent,
    verifactu: 'no',
    demo: o.demo ?? false,
  }
}
