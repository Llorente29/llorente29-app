// src/modules/conta/cuenta/useProductoSolo.ts
//
// ¿Se enseña contabilidad como producto vendido solo? (C06). Sí si se entra
// con una marca propia (dominio, o ?marca= fuera de producción), o si la cuenta
// es solo de contabilidad. Entonces: menú sin lo que dice «aún no», su Inicio,
// sin «Volver a…» y sin la barra de la IA mientras solo conteste «Muy pronto».

import { MARCA } from './marca'
import { useCuentaConta } from './contratoCuenta'

export function useProductoSolo(): boolean {
  const { soloContabilidad } = useCuentaConta()
  return MARCA.soloContabilidad || soloContabilidad
}
