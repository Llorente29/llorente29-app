// src/modules/kitchen/components/PriceGridErrorBoundary.tsx
//
// Cortafuegos de VISTA para la rejilla de precios.
//
// POR QUÉ EXISTE: la rejilla salió a producción sin haberse podido abrir en un
// navegador — este contenedor no tiene forma de autenticarse en la app, así que
// la pantalla está verificada por tipos, lint, build y pruebas de sus funciones
// puras con datos reales, pero NO por un render de verdad. Sin esto, un fallo de
// render caería en RootErrorBoundary y se llevaría por delante TODA la app: el
// usuario vería la pantalla de "recargar" en vez de poder irse a otra sección.
// Con esto, el destrozo se queda dentro de la rejilla.
//
// Se puede quitar en cuanto la pantalla lleve unos días abierta sin incidencias.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class PriceGridErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PriceGridErrorBoundary] crash de render en la rejilla de precios:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 max-w-2xl">
          <div className="border border-danger/40 bg-danger-bg/40 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-danger mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">La rejilla de precios no ha podido dibujarse.</div>
                <p className="text-sm text-text-secondary mt-1">
                  El resto de Folvy sigue funcionando: puedes irte a otra sección sin recargar.
                  Ningún precio se ha modificado — esta pantalla no escribe nada al abrirse.
                </p>
                <pre className="mt-3 text-[11px] whitespace-pre-wrap text-tinta-70 bg-card border border-border-default rounded p-2 overflow-auto max-h-40">
                  {this.state.error.message}
                </pre>
                <button onClick={() => this.setState({ error: null })}
                  className="mt-3 px-3 py-1.5 rounded-lg border border-linea-fuerte text-sm font-semibold">
                  Reintentar
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
