// src/modules/conta/lib/validacionesFicha.ts
//
// Lo que se comprueba al guardar la ficha. Encargo C01 §5.7.
//
// Dos tipos de resultado, y no es lo mismo:
//   · error  → bloquea el guardado (NIF repetido en la cuenta; intracomunitario
//              sin NIF-IVA UE; NIF o IBAN que no pasan su algoritmo);
//   · aviso  → se enseña y deja guardar (autónomo sin retención; plazo de pago
//              de más de 60 días, Ley 3/2004).

import type { FichaProveedor } from '@/modules/conta/types'
import { nifClave, validarNifEs } from '@/modules/conta/lib/nif'
import { textoNifRepetido } from '@/modules/conta/lib/altaProveedor'
import { validarIban } from '@/modules/conta/lib/iban'
import { validarFormatoVatEu } from '@/modules/conta/lib/vatEu'
import { avisoPlazo } from '@/modules/conta/lib/morosidad'

/**
 * Estructura del BIC (ISO 9362): 4 letras de banco, 2 de país, 2 de
 * localidad y, opcionalmente, 3 de oficina.
 */
const BIC = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/

export interface ProblemaFicha {
  campo: keyof FichaProveedor
  mensaje: string
}

export interface ResultadoValidacion {
  errores: ProblemaFicha[]
  avisos: ProblemaFicha[]
}

/** Otros proveedores de la MISMA cuenta, para el NIF repetido. */
export interface OtroProveedor { id: string; name: string; taxId: string | null }

/** X25 · El otro proveedor de la cuenta con el mismo NIF (comparado como la base: nifClave), para «Abrirlo»; o null. */
export function nifRepetidoDe(f: Pick<FichaProveedor, 'id' | 'taxId'>, otrosDeLaCuenta: readonly OtroProveedor[]): OtroProveedor | null {
  const mio = nifClave(f.taxId)
  return mio ? otrosDeLaCuenta.find((o) => o.id !== f.id && nifClave(o.taxId) === mio) ?? null : null
}

export function validarFicha(f: FichaProveedor, otrosDeLaCuenta: OtroProveedor[]): ResultadoValidacion {
  const errores: ProblemaFicha[] = []
  const avisos: ProblemaFicha[] = []
  const nif = f.taxId?.trim() ? f.taxId.trim() : null

  if (nif && f.taxIdType === 'nif_es') {
    const r = validarNifEs(nif)
    if (!r.ok) errores.push({ campo: 'taxId', mensaje: r.motivo })
  }
  if (nif && f.taxIdType === 'vat_eu') {
    const r = validarFormatoVatEu(nif)
    if (!r.ok) errores.push({ campo: 'taxId', mensaje: r.motivo })
  }

  if (nif) {
    // X25 · Con la clave de la base (la del índice único del X24) y la frase del alta: «Ya tienes a … con este NIF».
    const repe = nifRepetidoDe(f, otrosDeLaCuenta)
    if (repe) errores.push({ campo: 'taxId', mensaje: textoNifRepetido(repe.name) })
  }

  if (f.vatRegime === 'intracomunitario' && (f.taxIdType !== 'vat_eu' || !nif)) {
    errores.push({ campo: 'taxId', mensaje: 'Un proveedor intracomunitario necesita su NIF-IVA europeo (con las letras del país delante).' })
  }

  if (f.iban) {
    const r = validarIban(f.iban)
    if (!r.ok) errores.push({ campo: 'iban', mensaje: r.motivo })
    // Comparación con Holded: el BIC es obligatorio para un IBAN de fuera de
    // España (un pago SEPA a otro país lo pide); con uno español, opcional.
    else if (!r.normalizado.startsWith('ES') && !f.bic?.trim()) {
      errores.push({ campo: 'bic', mensaje: 'Este IBAN no es español: hace falta su BIC (el código del banco, de 8 u 11 letras y números).' })
    }
  }

  if (f.bic?.trim() && !BIC.test(f.bic.trim().toUpperCase())) {
    errores.push({ campo: 'bic', mensaje: 'Este BIC no es correcto: tiene 8 u 11 letras y números (por ejemplo, CAIXESBBXXX).' })
  }

  if (f.earlyPaymentDiscountPct !== null && (f.earlyPaymentDiscountPct < 0 || f.earlyPaymentDiscountPct > 100)) {
    errores.push({ campo: 'earlyPaymentDiscountPct', mensaje: 'El descuento por pronto pago va de 0 a 100 %.' })
  }

  // Ley 3/2004, art. 4.3: más de 60 días entre empresas. Se guarda, pero se avisa (respuesta 2 del C00).
  const plazoLargo = f.paymentTermsDays !== null ? avisoPlazo([f.paymentTermsDays]) : null
  if (plazoLargo) avisos.push({ campo: 'paymentTermsDays', mensaje: `${plazoLargo}.` })

  if (f.entityKind === 'self_employed' && f.irpfWithholdingPct === null) {
    avisos.push({ campo: 'irpfWithholdingPct', mensaje: 'Es autónomo y no tiene retención anotada. Si te factura con retención de IRPF, apúntala.' })
  }

  return { errores, avisos }
}
