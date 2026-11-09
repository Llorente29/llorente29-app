// src/modules/conta/cuenta/useProductoSolo.ts
//
// ¿Se enseña contabilidad como producto vendido solo? (C06). Sí si se entra
// con una marca propia (dominio, o ?marca= fuera de producción), o si la cuenta
// es solo de contabilidad. Entonces: menú sin lo que dice «aún no», su Inicio,
// sin «Volver a…» y sin la barra de la IA mientras solo conteste «Muy pronto».

import { MARCA } from './marca'
import { useCuentaConta } from './contratoCuenta'
import { useEnClienteDelDespacho } from '@/modules/multitenancy/hooks/useDespacho'

export function useProductoSolo(): boolean {
  const { soloContabilidad } = useCuentaConta()
  // G05: la gestoría dentro de un cliente (aunque sea de Folvy) ve Sumied solo.
  const enCliente = useEnClienteDelDespacho()
  return MARCA.soloContabilidad || soloContabilidad || enCliente
}
