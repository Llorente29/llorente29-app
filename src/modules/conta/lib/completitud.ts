// src/modules/conta/lib/completitud.ts
//
// «Ficha al X %» y lo que falta, con su enlace. Encargo C01 §5.5.
//
// Pesos del encargo. Dos de ellos sólo se cuentan cuando aplican:
//   · IBAN validado (10)            → sólo si se paga por transferencia o
//                                     domiciliación;
//   · certificado del banco (5)     → sólo si hay IBAN.
// Cuando no aplican, su peso se reparte entre los demás en proporción: el %
// sale de lo hecho sobre lo aplicable. Así una ficha de un proveedor que se
// paga en efectivo puede llegar al 100 % sin IBAN.

import type { ContactoProveedor, FichaProveedor } from '@/modules/conta/types'

export type PestanaFicha = 'resumen' | 'fiscal' | 'contactos' | 'pago' | 'contabilidad' | 'documentos' | 'historial'

export interface Falta {
  clave: string
  /** En minúscula y en lenguaje normal: va detrás de «Falta: ». */
  texto: string
  /** Adónde lleva el enlace: la pestaña y el campo que hay que rellenar. */
  destino: { pestana: PestanaFicha; campo: string }
  peso: number
}

export interface Completitud {
  pct: number
  faltan: Falta[]
}

export interface EntradaCompletitud {
  ficha: FichaProveedor
  contactos: ContactoProveedor[]
  tieneCertificadoBanco: boolean
}

export function direccionFiscalCompleta(f: FichaProveedor): boolean {
  return [f.fiscalStreet, f.fiscalPostalCode, f.fiscalCity, f.fiscalProvince]
    .every((x) => x !== null && x.trim() !== '')
}

/** El NIF cuenta como validado si se comprobó (algoritmo o VIES). Uno extranjero, con tenerlo. */
export function nifValidado(f: FichaProveedor): boolean {
  if (!f.taxId || f.taxId.trim() === '') return false
  if (f.taxIdType === 'foreign') return true
  return f.taxIdVerifiedAt !== null && f.taxIdCheckStatus === 'valid'
}

export function pideIban(f: FichaProveedor): boolean {
  return f.paymentMethod === 'transfer' || f.paymentMethod === 'direct_debit'
}

export function calcularCompletitud({ ficha: f, contactos, tieneCertificadoBanco }: EntradaCompletitud): Completitud {
  const tieneIban = !!f.iban
  const items: Array<{ hecho: boolean; aplica: boolean; falta: Falta }> = [
    { hecho: nifValidado(f), aplica: true,
      falta: { clave: 'nif', texto: 'NIF comprobado', destino: { pestana: 'fiscal', campo: 'taxId' }, peso: 20 } },
    { hecho: !!f.legalName?.trim(), aplica: true,
      falta: { clave: 'razon_social', texto: 'razón social', destino: { pestana: 'fiscal', campo: 'legalName' }, peso: 10 } },
    { hecho: direccionFiscalCompleta(f), aplica: true,
      falta: { clave: 'direccion', texto: 'dirección fiscal', destino: { pestana: 'fiscal', campo: 'fiscalStreet' }, peso: 10 } },
    { hecho: f.vatRegime !== null, aplica: true,
      falta: { clave: 'regimen_iva', texto: 'régimen de IVA', destino: { pestana: 'fiscal', campo: 'vatRegime' }, peso: 10 } },
    { hecho: f.expenseCategoryId !== null, aplica: true,
      falta: { clave: 'tipo_gasto', texto: 'tipo de gasto', destino: { pestana: 'contabilidad', campo: 'expenseCategoryId' }, peso: 10 } },
    { hecho: f.paymentMethod !== null && f.paymentTermsDays !== null, aplica: true,
      falta: { clave: 'forma_pago', texto: 'forma y plazo de pago', destino: { pestana: 'pago', campo: 'paymentMethod' }, peso: 10 } },
    { hecho: tieneIban && f.ibanVerifiedAt !== null, aplica: pideIban(f),
      falta: { clave: 'iban', texto: 'IBAN comprobado', destino: { pestana: 'pago', campo: 'iban' }, peso: 10 } },
    { hecho: contactos.some((c) => c.role === 'orders'), aplica: true,
      falta: { clave: 'contacto_pedidos', texto: 'contacto de pedidos', destino: { pestana: 'contactos', campo: 'orders' }, peso: 10 } },
    { hecho: contactos.some((c) => c.role === 'admin'), aplica: true,
      falta: { clave: 'contacto_admin', texto: 'contacto de administración', destino: { pestana: 'contactos', campo: 'admin' }, peso: 5 } },
    { hecho: tieneCertificadoBanco, aplica: tieneIban,
      falta: { clave: 'certificado_banco', texto: 'certificado del banco', destino: { pestana: 'documentos', campo: 'bank_ownership_certificate' }, peso: 5 } },
  ]
  const aplicables = items.filter((i) => i.aplica)
  const total = aplicables.reduce((s, i) => s + i.falta.peso, 0)
  const hecho = aplicables.filter((i) => i.hecho).reduce((s, i) => s + i.falta.peso, 0)
  // Se redondea hacia abajo: «100 %» sólo cuando no falta nada de verdad.
  const pct = total === 0 ? 0 : Math.floor((hecho * 100) / total)
  return { pct, faltan: aplicables.filter((i) => !i.hecho).map((i) => i.falta) }
}
