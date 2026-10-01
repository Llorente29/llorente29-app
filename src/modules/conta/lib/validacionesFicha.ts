// src/modules/conta/lib/validacionesFicha.ts
//
// Lo que se comprueba al guardar la ficha. Encargo C01 §5.7.
//
// Dos tipos de resultado, y no es lo mismo:
//   · error  → bloquea el guardado (NIF repetido en la cuenta; intracomunitario
//              sin NIF-IVA UE; NIF o IBAN que no pasan su algoritmo);
//   · aviso  → se enseña y deja guardar (autónomo sin retención).

import type { FichaProveedor } from '@/modules/conta/types'
import { normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'
import { validarIban } from '@/modules/conta/lib/iban'
import { validarFormatoVatEu } from '@/modules/conta/lib/vatEu'

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
    const mio = normalizarNif(nif)
    const repe = otrosDeLaCuenta.find((o) => o.id !== f.id && o.taxId && normalizarNif(o.taxId) === mio)
    if (repe) errores.push({ campo: 'taxId', mensaje: `Ese NIF ya lo tiene otro proveedor: ${repe.name}.` })
  }

  if (f.vatRegime === 'intracomunitario' && (f.taxIdType !== 'vat_eu' || !nif)) {
    errores.push({ campo: 'taxId', mensaje: 'Un proveedor intracomunitario necesita su NIF-IVA europeo (con las letras del país delante).' })
  }

  if (f.iban) {
    const r = validarIban(f.iban)
    if (!r.ok) errores.push({ campo: 'iban', mensaje: r.motivo })
  }

  if (f.entityKind === 'self_employed' && f.irpfWithholdingPct === null) {
    avisos.push({ campo: 'irpfWithholdingPct', mensaje: 'Es autónomo y no tiene retención anotada. Si te factura con retención de IRPF, apúntala.' })
  }

  return { errores, avisos }
}
