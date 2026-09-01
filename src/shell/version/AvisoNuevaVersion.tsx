// src/shell/version/AvisoNuevaVersion.tsx
//
// El aviso de oficina: hay versión nueva, y la persona decide cuándo.
//
// NO se recarga solo aquí a propósito. En una pantalla de oficina puede haber
// alguien a mitad de un albarán o de un cuadrante, y recargarle por debajo le
// borra el trabajo — que es peor que la versión vieja.
//
// Y no es un banner rojo: no ha fallado nada. Es una nota discreta que se
// queda hasta que se pulsa, porque no tiene prisa pero tampoco se va sola.

import { RefreshCw } from 'lucide-react'
import { useNuevaVersion } from './useNuevaVersion'

export default function AvisoNuevaVersion() {
  const { hayNueva, recargar } = useNuevaVersion()
  if (!hayNueva) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-accent/30 bg-card shadow-lg p-3 flex items-start gap-3">
      <RefreshCw size={16} className="text-accent shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="text-text-primary font-medium">Hay una versión nueva de Folvy</p>
        <p className="text-text-secondary text-xs mt-0.5">
          Lo que tengas a medias no se pierde al recargar, pero termina antes si estás escribiendo.
        </p>
        <button
          type="button"
          onClick={recargar}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90 transition-base"
        >
          <RefreshCw size={13} /> Recargar ahora
        </button>
      </div>
    </div>
  )
}
