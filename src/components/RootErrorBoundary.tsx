// src/components/RootErrorBoundary.tsx
//
// Red de seguridad RAÍZ de la app. Envuelve todo el árbol en main.tsx: si CUALQUIER
// componente lanza durante el render (p.ej. un campo nullable inesperado del
// servidor formateado sin guarda, como el crash del KDS), en vez de dejar la
// pantalla EN BLANCO mostramos un fallback con botón "Recargar" y logueamos el
// stack. Elimina la CLASE de bug "un render revienta → app entera caída".
//
// Ojo: las error boundaries de React solo capturan errores de RENDER (no de
// efectos async ni de handlers). Para el crash típico (formateo en el JSX) basta.
// Complementa a las boundaries de vista (RecipeErrorBoundary, DetailErrorBoundary):
// aquéllas aíslan un panel sin recargar; ésta es el último cortafuegos global.

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Rastro en consola para no perder el stack real al diagnosticar.
    console.error('[RootErrorBoundary] crash de render no capturado:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-page p-6">
          <div className="text-center max-w-md">
            <p className="text-2xl font-display font-medium mb-2 text-accent">Folvy</p>
            <p className="text-base font-medium text-text-primary mb-1">
              Algo ha fallado al mostrar esta pantalla
            </p>
            <p className="text-sm text-text-secondary mb-4">
              La app no se ha cerrado. Recarga para volver; si vuelve a pasar, avísanos.
            </p>
            <p className="text-xs text-text-secondary break-words mb-4 font-mono opacity-70">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base"
            >
              Recargar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
