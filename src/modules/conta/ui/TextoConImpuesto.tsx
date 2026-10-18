// src/modules/conta/ui/TextoConImpuesto.tsx
//
// S01e · Un texto escrito para el IVA, con el impuesto de la empresa activa:
// en Canarias, «IGIC»; en Ceuta y Melilla, «IPSI» (lib/impuestoIndirecto).

import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useImpuestoEmpresa } from '@/modules/conta/hooks/useImpuestoEmpresa'
import { conImpuesto } from '@/modules/conta/lib/impuestoIndirecto'

export function TextoConImpuesto({ texto }: { texto: string }) {
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const p = useImpuestoEmpresa(accountId, activa?.id)
  return <>{conImpuesto(texto, p)}</>
}
