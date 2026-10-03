// src/modules/conta/empresa/apartados.ts
//
// Los apartados de «Tu empresa», en el orden de las maquetas N2/M2. En el
// ordenador son tarjetas en una sola pantalla; en el móvil, una lista y una
// pantalla por apartado (ajustes/empresa/:apartado). Dos pasos como mucho.

import {
  ejercicioActual, mesesConEstado, resumenMeses, textoIva, type DatosEmpresa,
} from '@/modules/conta/empresa/datosEmpresa'
import { faltan, requisitosParaPresentar } from '@/modules/conta/lib/presentar'

export type ClaveApartado = 'quien-eres' | 'actividad' | 'impuestos' | 'ejercicio' | 'socios' | 'presentar' | 'detalle' | 'registro'

export interface Quien { accountId: string; companyId: string; userId: string | null }

export interface Apartado {
  id: ClaveApartado
  titulo: (d: DatosEmpresa, hoy: string) => string
  /** La línea de apoyo de la lista del móvil. */
  resumen: (d: DatosEmpresa, hoy: string) => string
}

export const APARTADOS: readonly Apartado[] = [
  {
    id: 'quien-eres', titulo: () => 'Quién eres',
    resumen: (d) => [d.empresa.legalName, d.empresa.taxId].filter(Boolean).join(' · ') || 'Sin poner',
  },
  {
    id: 'actividad', titulo: () => 'A qué te dedicas',
    resumen: (d) => {
      const vivas = d.actividades.filter((a) => a.endedOn === null)
      const principal = vivas.find((a) => a.isMain) ?? vivas[0]
      if (!principal) return 'Sin poner'
      return vivas.length > 1 ? `${principal.description} y ${vivas.length - 1} más` : principal.description
    },
  },
  {
    id: 'impuestos', titulo: () => 'Tus impuestos',
    resumen: (d) => {
      if (!d.perfil) return 'Sin poner'
      const t = textoIva(d.perfil, d.regimenes)
      // «General · cada tres meses» → «IVA general · cada tres meses»; el IGIC y el IPSI ya dicen cuál es.
      return d.perfil.taxTerritory === 'peninsula_baleares' ? `IVA ${t.charAt(0).toLowerCase()}${t.slice(1)}` : t
    },
  },
  {
    id: 'ejercicio',
    titulo: (d, hoy) => { const e = ejercicioActual(d.ejercicios, hoy); return e ? `Ejercicio ${e.code}` : 'Ejercicio' },
    resumen: (d, hoy) => {
      const e = ejercicioActual(d.ejercicios, hoy)
      return e ? resumenMeses(mesesConEstado(e, d.cierres, hoy)) : 'Sin abrir'
    },
  },
  {
    id: 'socios', titulo: () => 'Socios y cargos',
    resumen: (d) => {
      if (d.socios === null) return 'Solo lo ve un administrador'
      const n = d.socios.filter((s) => s.endedOn === null).length
      return n === 0 ? 'Sin poner' : `${n} ${n === 1 ? 'persona' : 'personas'}`
    },
  },
  {
    // Respuesta 3, punto 5: lo que piden el 200 y el depósito de cuentas, ya en la ficha.
    id: 'presentar', titulo: () => 'Para presentar el 200 y depositar las cuentas',
    resumen: (d, hoy) => {
      if (d.empresa.entityKind !== 'company') return 'Solo para sociedades'
      const n = faltan(requisitosParaPresentar(d, hoy)).length
      return n === 0 ? 'Está todo' : n === 1 ? 'Falta 1 cosa' : `Faltan ${n} cosas`
    },
  },
  { id: 'detalle', titulo: () => 'Detalle contable', resumen: () => 'Viene puesto; lo normal es no tocarlo' },
  {
    id: 'registro', titulo: () => 'Lo que ha hecho Folvy',
    resumen: (d) => {
      const vivas = d.ia.registro.filter((r) => !r.undoneAt).length
      return vivas === 0 ? 'Nada todavía' : `${vivas} ${vivas === 1 ? 'cosa' : 'cosas'}; se pueden deshacer`
    },
  },
]

export const apartado = (id: string | undefined): Apartado | null => APARTADOS.find((a) => a.id === id) ?? null
