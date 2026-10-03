// src/modules/conta/tablas/usadas.ts
//
// «Los que usas» (encargo C00 §4.3): una fila se considera usada si algún
// proveedor, documento o ajuste de la empresa la referencia, o si corresponde
// a su territorio y actividad.
//
// Respuesta 1 de Julio, D5: la pantalla enseña TODAS las filas. Lo usado sale
// arriba («Los que usas») y lo demás debajo («Los demás»), con la separación a
// la vista y sin aviso al pie. Esto decide el ORDEN y la ETIQUETA de cada fila,
// nunca si existe (regla 7 de CLAUDE.md).
//
// Puro: el contexto lo lee el servicio.

import type { ClaveTabla, Concepto, FilaGeneral } from '@/modules/conta/tablas/registro'
import { valeHoy } from '@/modules/conta/tablas/registro'

/** Lo que importa de un proveedor para saber qué usa (supplier, de la cuenta). */
export interface ProveedorParaUso {
  usualVatRates: number[]
  irpfPct: number | null
  paymentMethod: string | null
  paymentTermsDays: number | null
  paymentFixedDays: number[]
  expenseCategoryId: string | null
  countryCode: string | null
  currency: string | null
}

export interface ContextoUso {
  /** company_tax_profile.tax_territory; null si la empresa aún no lo tiene. */
  territorio: string | null
  /** company_tax_profile.tax_forms: los modelos que presenta. */
  modelos: string[]
  /** company.fiscal_country. */
  pais: string | null
  proveedores: ProveedorParaUso[]
  hoy: string
  /** company_tax_profile.account_digits: la longitud de las cuentas de apunte (respuesta 3, punto 3). */
  digitos: number
}

export interface Uso {
  usada: boolean
  /** «38 proveedores», «Tu territorio», «La añadiste tú»… o «—». */
  donde: string
}

const proveedores = (n: number) => `${n} ${n === 1 ? 'proveedor' : 'proveedores'}`
const NADA: Uso = { usada: false, donde: '—' }
const igual = (a: number, b: number) => Math.abs(a - b) < 0.005

function conProveedores(n: number, otro: Uso | null): Uso {
  if (n > 0) return { usada: true, donde: proveedores(n) }
  return otro ?? NADA
}

export function usoDeFila(tabla: ClaveTabla, f: FilaGeneral, ctx: ContextoUso): Uso {
  if (!f.serie && tabla !== 'paises-y-monedas') {
    // Lo propio de la empresa lo ha puesto ella: se usa.
    if (tabla === 'bancos-y-cajas') return { usada: true, donde: 'Tuyo' }
    if (tabla === 'numeracion') return { usada: true, donde: 'Tuya' }
  }
  const dato = (c: string) => f.datos[c]
  switch (tabla) {
    case 'impuestos': {
      const rate = Number(dato('rate'))
      const trato = String(dato('treatment'))
      // usual_vat_rates de la ficha del C01 son porcentajes sueltos: se cuentan
      // contra los impuestos normales (con impuesto o exentos) que valen hoy y
      // son del territorio de la empresa, no contra las compras en la UE ni la
      // inversión del sujeto pasivo, que llevan el mismo 21 %.
      const comparable = (trato === 'taxed' || trato === 'exempt') && valeHoy(f, ctx.hoy)
        && (ctx.territorio === null || dato('territory') === ctx.territorio)
      const n = comparable ? ctx.proveedores.filter((p) => p.usualVatRates.some((r) => igual(r, rate))).length : 0
      const territorio = trato === 'taxed' && valeHoy(f, ctx.hoy) && ctx.territorio !== null && dato('territory') === ctx.territorio
      return conProveedores(n, territorio ? { usada: true, donde: 'Tu territorio' } : propia(f))
    }
    case 'retenciones': {
      const rate = Number(dato('rate'))
      const n = valeHoy(f, ctx.hoy) ? ctx.proveedores.filter((p) => p.irpfPct !== null && igual(p.irpfPct, rate)).length : 0
      const modelo = String(dato('filed_in'))
      return conProveedores(n, ctx.modelos.includes(modelo) ? { usada: true, donde: `Presentas el ${modelo}` } : propia(f))
    }
    case 'formas-de-pago': {
      const n = ctx.proveedores.filter((p) => p.paymentMethod === dato('kind')).length
      return conProveedores(n, propia(f))
    }
    case 'plazos-de-pago': {
      const dias = (Array.isArray(dato('days')) ? dato('days') as unknown[] : []).map(Number)
      const fijos = (Array.isArray(dato('fixed_days')) ? dato('fixed_days') as unknown[] : []).map(Number).sort((a, b) => a - b)
      const n = dias.length !== 1 ? 0 : ctx.proveedores.filter((p) =>
        p.paymentTermsDays === dias[0]
        && [...p.paymentFixedDays].sort((a, b) => a - b).join(',') === fijos.join(',')).length
      return conProveedores(n, propia(f))
    }
    case 'tipos-de-gasto': {
      const n = ctx.proveedores.filter((p) => p.expenseCategoryId === f.id).length
      return conProveedores(n, propia(f))
    }
    case 'textos-de-apuntes':
      // Toda empresa recibe facturas y paga: los textos de serie le tocan a todas.
      return f.serie ? { usada: true, donde: 'Tus apuntes' } : { usada: true, donde: 'Lo añadiste tú' }
    case 'paises-y-monedas': {
      if (f.tablaBd === 'country') {
        const n = ctx.proveedores.filter((p) => p.countryCode === f.code).length
        return conProveedores(n, f.code === ctx.pais ? { usada: true, donde: 'Tu país' } : null)
      }
      const n = ctx.proveedores.filter((p) => p.currency === f.code).length
      return conProveedores(n, f.code === 'EUR' ? { usada: true, donde: 'Tu moneda' } : null)
    }
    default:
      return propia(f) ?? NADA
  }
}

function propia(f: FilaGeneral): Uso | null {
  return f.serie ? null : { usada: true, donde: 'Lo añadiste tú' }
}

export interface ConceptoConUso extends Concepto { uso: Uso; oculta: boolean }

export interface Reparto {
  usas: ConceptoConUso[]
  demas: ConceptoConUso[]
}

/**
 * Reparte TODAS las filas en dos montones, sin quitar ninguna. Una fila de
 * serie oculta por la empresa (no sale en sus desplegables) va a «Los demás»
 * con su etiqueta, nunca desaparece.
 */
export function repartir(tabla: ClaveTabla, conceptos: Concepto[], ctx: ContextoUso,
  orden: (a: Concepto, b: Concepto) => number): Reparto {
  const con = [...conceptos].sort(orden).map((c) => {
    const oculta = c.fila.ajuste?.hidden === true
    return { ...c, uso: usoDeFila(tabla, c.fila, ctx), oculta }
  })
  return {
    usas: con.filter((c) => c.uso.usada && !c.oculta),
    demas: con.filter((c) => !c.uso.usada || c.oculta),
  }
}
