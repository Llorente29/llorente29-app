// src/modules/conta/terceros/contextoTercero.ts
//
// C03 · Lo que comparten la portada y las pestañas de la ficha de un tercero.

import { createContext, useContext } from 'react'
import type { FichaTercero, CalculoSocio } from '@/modules/conta/services/tercerosService'
import type { mesDe } from '@/modules/conta/lib/liquidacionSocio'
import type { Papel } from '@/modules/conta/lib/terceros'
import type { CalculoLocal } from '@/modules/conta/lib/liquidacionSocio'
import { aprendidoDeCliente } from '@/modules/conta/lib/aprendidoCliente'

export type ApartadoTercero = 'ficha' | 'datos-fiscales' | 'contactos' | 'cobro' | 'liquidaciones' | 'contabilidad' | 'documentos' | 'historial'

export const NOMBRE_APARTADO_TERCERO: Record<ApartadoTercero, string> = {
  ficha: 'Ficha', 'datos-fiscales': 'Datos fiscales', contactos: 'Contactos', cobro: 'Cobro',
  liquidaciones: 'Liquidaciones', contabilidad: 'Contabilidad', documentos: 'Documentos', historial: 'Historial',
}

/** Las pestañas que tiene este tercero: Liquidaciones, solo plataforma y socio. */
export function apartadosDe(papeles: readonly Papel[]): ApartadoTercero[] {
  const conLiq = papeles.includes('platform') || papeles.includes('brand_partner')
  return (['ficha', 'datos-fiscales', 'contactos', 'cobro', 'liquidaciones', 'contabilidad', 'documentos', 'historial'] as const)
    .filter((a) => a !== 'liquidaciones' || conLiq)
}

export const esApartadoTercero = (x: string | undefined): x is ApartadoTercero =>
  !!x && x in NOMBRE_APARTADO_TERCERO

export interface ContextoTercero {
  ficha: FichaTercero
  mesSocio: { mes: ReturnType<typeof mesDe>; porLocal: (CalculoSocio & { local: string })[] } | null
  accountId: string
  companyId: string | null
  hoy: string
  movil: boolean
  recargar: () => void
  rutaApartado: (a: ApartadoTercero) => string
  /** Lo que se acaba de hacer, con contenido (regla 8). */
  avisar: (texto: string) => void
}

export const TerceroContexto = createContext<ContextoTercero | null>(null)

export function useTercero(): ContextoTercero {
  const v = useContext(TerceroContexto)
  if (!v) throw new Error('useTercero fuera de la ficha del tercero')
  return v
}

/** Los papeles de un tercero, cómodos. */
export function papelesDe(f: FichaTercero) {
  const tiene = (p: Papel) => f.papeles.some((x) => x.role === p)
  return {
    proveedor: tiene('supplier'), cliente: tiene('customer'), plataforma: tiene('platform'), socio: tiene('brand_partner'),
    rolPlataforma: f.papeles.find((x) => x.role === 'platform') ?? null,
    rolSocio: f.papeles.find((x) => x.role === 'brand_partner') ?? null,
  }
}

/** El cálculo del mes de la base, por local, en la forma del núcleo. */
export function calculosDelMes(porLocal: (CalculoSocio & { local: string })[]): CalculoLocal[] {
  return porLocal.map((c) => ({
    localId: c.location_id, local: c.local, compras: c.compras, aportaciones: c.aportaciones,
    marcas: c.marcas.map((m) => ({ marca: m.marca, pct: m.pct, base: m.base })), faltan: c.faltan.map((f) => f.texto), importeBase: c.importe,
  }))
}


export function useAprendido() {
  const { ficha } = useTercero()
  const { rolPlataforma } = papelesDe(ficha)
  const banco = ficha.bancos.find((b) => b.id === ficha.fiscal?.collectionTreasuryId)
  const nombreBanco = banco ? `${banco.name}${banco.iban ? ` ···${banco.iban.slice(-4)}` : ''}` : null
  const vistas = [...ficha.liquidaciones].reverse().map((l) => ({ llegoEl: l.cobradoEn ?? l.fecha, ventas: l.ventas, comision: l.comision, banco: l.cobradoEn ? nombreBanco : null }))
  return aprendidoDeCliente(vistas, {
    ...(rolPlataforma?.commissionPct != null ? { comision: `Comisión ${String(rolPlataforma.commissionPct).replace('.', ',')} % pactada` } : {}),
    ...(nombreBanco ? { banco: `Cobro por transferencia a ${nombreBanco}` } : {}),
  })
}

