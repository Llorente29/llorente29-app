// src/modules/conta/empresa/contexto.ts
//
// La empresa activa del módulo. Una cuenta puede llevar varias empresas, cada
// una con su contabilidad (encargo C00 §3): todo lo que se ve cuelga de la
// empresa elegida arriba del menú («Cambiar de empresa»).

import { createContext, useContext } from 'react'

export interface EmpresaResumen {
  id: string
  /** Nombre con el que se la conoce (comercial) o, si no hay, la razón social. */
  nombre: string
  razonSocial: string | null
  nif: string | null
  /** El alta está terminada. Si no, el menú lleva a seguirla. */
  completa: boolean
}

export interface EstadoEmpresas {
  cargando: boolean
  error: string | null
  empresas: EmpresaResumen[]
  activa: EmpresaResumen | null
  elegir: (id: string) => void
  recargar: () => void
}

export const EmpresasContexto = createContext<EstadoEmpresas | null>(null)

export function useEmpresas(): EstadoEmpresas {
  const v = useContext(EmpresasContexto)
  if (!v) throw new Error('useEmpresas fuera de EmpresasProveedor')
  return v
}

/** Clave del almacén local donde se recuerda la empresa elegida, por cuenta. */
export function claveEmpresaElegida(accountId: string): string {
  return `folvy.conta.empresa.${accountId}`
}

/** Cuál queda activa: la recordada si sigue existiendo; si no, la primera. */
export function empresaQueQuedaActiva(empresas: EmpresaResumen[], recordada: string | null): EmpresaResumen | null {
  return empresas.find((e) => e.id === recordada) ?? empresas[0] ?? null
}
