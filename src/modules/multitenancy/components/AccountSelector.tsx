// src/modules/multitenancy/components/AccountSelector.tsx
//
// Dropdown para cambiar la cuenta activa. Patrón hermano de LocationSelector
// y BrandFilterSelector.
//
// COMPORTAMIENTO:
//   - Si el user tiene ≤1 cuenta accesible → componente oculto (no hay nada
//     que elegir, evita ocupar espacio en el header).
//   - Si tiene 2+ cuentas → botón compacto con nombre de la cuenta activa y
//     chevron; al clicar abre un dropdown con la lista.
//   - Marca con ✓ la cuenta activa.
//   - Cuentas internas (is_internal=true) muestran badge gris "Interno".
//   - Click en otra cuenta → setActiveAccountId(id). AppContext reactivo: el
//     resto de la app re-renderiza con datos de la nueva cuenta.
//
// PERSISTENCIA: vía localStorage (gestionado por AppContext.setActiveAccountId).
//
// BLOQUE D-0 MINI (17/05/2026): dropdown sobre localStorage, sin URL slug.
// La URL con slug por cuenta es Bloque C completo. Mini D-0 desbloquea
// testing visual entre cuentas sin esperar a Bloque C.

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useActiveAccount } from '../hooks/useActiveAccount'

interface AccountSelectorProps {
  /** Clases extra que se concatenan al className por defecto. */
  className?: string
}

export default function AccountSelector({ className = '' }: AccountSelectorProps) {
  const { accounts, activeAccount, activeAccountId, setActiveAccountId } = useActiveAccount()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Cerrar dropdown al hacer clic fuera.
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Ocultar si no hay ≥2 cuentas (nada que elegir).
  if (accounts.length <= 1) {
    return null
  }

  function handleSelect(id: string) {
    if (id !== activeAccountId) {
      setActiveAccountId(id)
    }
    setOpen(false)
  }

  // Texto del botón: nombre de cuenta activa, o "Selecciona cuenta" si null.
  const buttonLabel = activeAccount?.name ?? 'Selecciona cuenta'

  return (
    <div ref={containerRef} className={'relative ' + className}>
      <button
        type="button"
        aria-label="Cuenta activa"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Cambiar de cuenta"
        onClick={() => setOpen((prev) => !prev)}
        className={
          'border border-border-default rounded-md px-2 py-1 text-xs ' +
          'bg-card text-text-primary cursor-pointer ' +
          'focus:outline-none focus:ring-1 focus:ring-accent ' +
          'max-w-[180px] truncate ' +
          'inline-flex items-center gap-1'
        }
      >
        <span className="truncate">{buttonLabel}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          aria-hidden="true"
          className="shrink-0"
        >
          <path d="M1 3l4 4 4-4z" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Cuentas accesibles"
          className={
            'absolute right-0 mt-1 min-w-[220px] max-h-[300px] overflow-y-auto ' +
            'bg-card border border-border-default rounded-md shadow-lg z-40 ' +
            'py-1'
          }
        >
          {accounts.map((a) => {
            const isActive = a.id === activeAccountId
            return (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(a.id)}
                className={
                  'w-full text-left px-3 py-1.5 text-xs ' +
                  'hover:bg-page text-text-primary ' +
                  'inline-flex items-center gap-2 ' +
                  (isActive ? 'font-semibold' : '')
                }
              >
                {isActive ? (
                  <Check size={12} className="shrink-0 text-accent" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span className="truncate flex-1">{a.name}</span>
                {a.isInternal && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-page text-text-secondary shrink-0"
                    title="Cuenta interna del producto"
                  >
                    Interno
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
