// src/modules/conta/ajustes/contextoAjustes.ts
//
// Lo que MarcoAjustes reparte a las entradas de Ajustes (C02 §5a), y la línea
// de resumen de cada entrada del índice. Aparte del componente para que el
// recargado en caliente funcione (react-refresh).

import { createContext, useContext } from 'react'
import type { EntradaAjustes } from '@/config/navegacion'
import type { EstadoDatosEmpresa } from '@/modules/conta/empresa/useDatosEmpresa'
import { APARTADOS, type Quien } from '@/modules/conta/empresa/apartados'
import { ejercicioActual, mesesConEstado, resumenMeses, type DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'
import { resumenPlan } from '@/modules/conta/lib/planVista'
import type { DatosPlan } from '@/modules/conta/services/planService'
import { resumenSeries } from '@/modules/conta/tablas/registro'

export interface ContextoAjustes {
  datos: EstadoDatosEmpresa
  plan: { cargando: boolean; error: string | null; datos: DatosPlan | null; recargar: () => void }
  quien: Quien
  movil: boolean
  hoy: string
}

export const CtxAjustes = createContext<ContextoAjustes | null>(null)
export function useAjustes(): ContextoAjustes {
  const c = useContext(CtxAjustes)
  if (!c) throw new Error('useAjustes fuera de MarcoAjustes')
  return c
}

const resumen = (apartado: string, d: DatosEmpresa, hoy: string) => APARTADOS.find((a) => a.id === apartado)?.resumen(d, hoy) ?? ''

/**
 * S01e · El plan, las tablas y la analítica son Contabilidad › Definiciones
 * (la barra de arriba lo dice así): su pantalla se titula como tal, sin el
 * índice de Ajustes al lado. Su título, el que sale una sola vez.
 */
export const TITULO_DEFINICION: Readonly<Record<string, string>> = {
  plan: 'Plan contable', tablas: 'Tablas generales', analitica: 'Analítica',
}
export const esDefinicion = (entrada: string | null): boolean => entrada !== null && entrada in TITULO_DEFINICION

/**
 * La línea de debajo de cada entrada del índice («Pymes · 8 dígitos · 615 cuentas»).
 * `series`: cuántas series de facturas hay, contadas como en su tabla (null: aún no se sabe).
 */
export function resumenEntrada(e: EntradaAjustes, d: DatosEmpresa | null, plan: DatosPlan | null, hoy: string, series: number | null = null): string {
  if (e.hueco) return 'Aún no'
  if (e.id === 'numeracion') return series === null ? '' : resumenSeries(series)
  if (!d) return ''
  switch (e.id) {
    case 'empresa': return resumen('quien-eres', d, hoy)
    case 'impuestos': return resumen('impuestos', d, hoy)
    case 'socios': return resumen('socios', d, hoy)
    case 'ejercicio': {
      const ej = ejercicioActual(d.ejercicios, hoy)
      return ej ? `${ej.code} · ${resumenMeses(mesesConEstado(ej, d.cierres, hoy))}` : 'Sin abrir'
    }
    case 'plan': return plan ? resumenPlan(plan.activo ? { plan: plan.plan, digitos: plan.digitos, cuentas: plan.cuentas.length } : null) : ''
    case 'tablas': return 'Impuestos, plazos, formas de pago…'
    case 'folvy': {
      // También lo que ha hecho en el plan (no decir «Nada todavía» con historial, regla 7).
      const ia = resumen('registro', d, hoy)
      const n = plan?.registro.length ?? 0
      if (!n) return ia
      const delPlan = `${n >= 50 ? 'más de 50' : n} ${n === 1 ? 'cambio' : 'cambios'} en el plan`
      return ia === 'Nada todavía' ? delPlan.charAt(0).toUpperCase() + delPlan.slice(1) : `${ia} · ${delPlan}`
    }
    default: return ''
  }
}

