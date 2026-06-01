// src/components/Drawer.tsx
//
// Drawer (panel deslizante) reutilizable — patrón primary-detail: la LISTA queda
// detrás visible y el DETALLE entra por la derecha sobre ella, sin reemplazar la
// pantalla. Estándar de mercado (entra por la derecha, overlay tenue, cierre por
// X/Esc/clic fuera, scroll interno con cabecera fija). En móvil ocupa todo el ancho.
//
// Vive a nivel de página vía fixed inset-0 (como los modales del proyecto): NO
// toca Shell ni routing. Reutilizable: hoy lo usa Proveedores; luego Ingredientes.
//
// Uso:
//   <Drawer open={selectedId !== null} title="Makro" onClose={() => setSelectedId(null)}>
//     <SupplierDetail … />
//   </Drawer>

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  /** Nodo opcional a la derecha del título (acciones de cabecera). */
  headerRight?: React.ReactNode
  children: React.ReactNode
}

export default function Drawer({ open, onClose, title, headerRight, children }: DrawerProps) {
  // mounted controla la presencia en el DOM; visible controla la animación.
  // Al abrir: montar y, en el siguiente frame, deslizar a visible.
  // Al cerrar: quitar visible (desliza fuera) y desmontar tras la transición.
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const id = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(id)
    }
    setVisible(false)
    const t = setTimeout(() => setMounted(false), 200) // coincide con duration-200
    return () => clearTimeout(t)
  }, [open])

  // Cierre con Esc mientras está abierto.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Bloqueo del scroll del body mientras está abierto.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" aria-hidden={!open}>
      {/* Overlay tenue: la lista se intuye detrás. Clic = cerrar. */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/20 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel: derecha, ancho en escritorio, pantalla completa en móvil. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative h-full w-full sm:max-w-3xl bg-page shadow-xl flex flex-col transform transition-transform duration-200 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Cabecera fija */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-default bg-card flex-shrink-0">
          <h2 className="text-lg font-display font-medium text-text-primary truncate">{title}</h2>
          <div className="flex items-center gap-2 flex-shrink-0">
            {headerRight}
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onClose}
              className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-page transition-base"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Cuerpo con scroll interno */}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
