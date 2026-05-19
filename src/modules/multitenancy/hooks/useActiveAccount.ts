// src/modules/multitenancy/hooks/useActiveAccount.ts
//
// Hook de conveniencia sobre AppContext para componentes que solo necesitan
// la cuenta activa. Evita importar `useApp` y desestructurar 7 campos cuando
// solo te interesan los 5 relacionados con multi-tenant.
//
// API:
//   useActiveAccount()                  → estado de cuenta activa
//   useActiveAccount().requireActiveAccountId()
//                                        → garantía no-null (lanza si lo es)
//
// Uso típico en render (null es válido durante carga):
//   const { activeAccount, accountsLoading } = useActiveAccount()
//   if (accountsLoading) return <Spinner/>
//   if (!activeAccount) return <NoAccountScreen/>
//   return <Dashboard account={activeAccount}/>
//
// Uso típico en handlers (null es bug):
//   const { requireActiveAccountId } = useActiveAccount()
//   const handleSave = () => {
//     const accountId = requireActiveAccountId()
//     await saveBrand({ accountId, ... })
//   }
//
// NO duplica estado: solo lee del context. Cualquier `setActiveAccountId`
// que se llame desde aquí afecta a TODA la app.

import { useApp } from '../../../context/AppContext'
import type { Account } from '../../../types/multitenancy'

export interface UseActiveAccountResult {
  /** UUID de la cuenta activa. null durante carga inicial o si el user no tiene cuentas. */
  activeAccountId: string | null
  /** Objeto Account completo. null si activeAccountId es null o aún no se ha resuelto en accounts. */
  activeAccount: Account | null
  /** Lista de cuentas a las que pertenece el user. [] durante carga inicial o user sin cuentas. */
  accounts: Account[]
  /** True mientras se cargan las cuentas tras detectar authUserId. */
  accountsLoading: boolean
  /** Cambia la cuenta activa (persiste en localStorage). */
  setActiveAccountId: (id: string) => void
  /**
   * Devuelve activeAccountId, garantizando que no es null. Lanza Error si lo es.
   * Usar en handlers/callbacks donde "no hay cuenta activa" es un bug
   * programático (componente debería haber renderizado fallback antes).
   */
  requireActiveAccountId: () => string
}

export function useActiveAccount(): UseActiveAccountResult {
  const {
    activeAccountId,
    activeAccount,
    accounts,
    accountsLoading,
    setActiveAccountId,
  } = useApp()

  const requireActiveAccountId = (): string => {
    if (!activeAccountId) {
      throw new Error(
        'useActiveAccount.requireActiveAccountId(): no hay cuenta activa. ' +
          'Espera a accountsLoading=false y verifica que el user tiene cuentas asignadas.'
      )
    }
    return activeAccountId
  }

  return {
    activeAccountId,
    activeAccount,
    accounts,
    accountsLoading,
    setActiveAccountId,
    requireActiveAccountId,
  }
}
