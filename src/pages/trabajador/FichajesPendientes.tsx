// src/pages/trabajador/FichajesPendientes.tsx
//
// L1a · PR 1 (27/10/2026). Sin cobertura, el fichaje se hace igual: se guarda
// en el móvil con su hora y se manda solo al volver la red. Aquí está el aviso
// que lo cuenta en la portada (quien lo manda, en usarFichajesPendientes.ts): lo que espera y lo que el
// servidor no ha aceptado, con el motivo (regla 8: nada pasa en silencio).
import { CloudOff, AlertTriangle } from 'lucide-react'
import { Card } from '../../components/ui'
import type { useFichajesPendientes } from './usarFichajesPendientes'

function horaYDia(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
}

export function AvisoFichajesPendientes({ pendientes, subidos, descartar }: ReturnType<typeof useFichajesPendientes>) {
  const esperando = pendientes.filter(p => !p.rechazo)
  const rechazados = pendientes.filter(p => p.rechazo)
  if (esperando.length === 0 && rechazados.length === 0 && subidos === 0) return null
  return (
    <div className="px-4 pt-3 max-w-md mx-auto space-y-2" data-prueba="fichajes-pendientes">
      {subidos > 0 && esperando.length === 0 && rechazados.length === 0 && (
        <Card className="p-3 bg-success-bg border-success/30">
          <p className="text-sm text-success font-medium">
            {subidos === 1 ? 'Se ha enviado el fichaje que hiciste sin conexión.' : `Se han enviado los ${subidos} fichajes que hiciste sin conexión.`}
          </p>
        </Card>
      )}
      {esperando.length > 0 && (
        <Card className="p-3 bg-warning-bg border-warning/30">
          <div className="flex gap-2 items-start">
            <CloudOff size={18} className="text-warning shrink-0 mt-0.5" />
            <div className="text-sm text-text-primary">
              <p className="font-semibold">
                {esperando.length === 1 ? '1 fichaje esperando conexión' : `${esperando.length} fichajes esperando conexión`}
              </p>
              <ul className="text-xs text-text-secondary mt-1 space-y-0.5">
                {esperando.map(p => <li key={p.clave}>{p.entry.type === 'entrada' ? 'Entrada' : 'Salida'} del {horaYDia(p.horaDeclarada)}</li>)}
              </ul>
              <p className="text-xs text-text-secondary mt-1">Se envían solos en cuanto haya red, con la hora de tu móvil.</p>
            </div>
          </div>
        </Card>
      )}
      {rechazados.map(p => (
        <Card key={p.clave} className="p-3 bg-danger-bg border-danger/30">
          <div className="flex gap-2 items-start">
            <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
            <div className="text-sm text-text-primary flex-1">
              <p className="font-semibold">
                No se ha podido guardar tu {p.entry.type === 'entrada' ? 'entrada' : 'salida'} del {horaYDia(p.horaDeclarada)}
              </p>
              <p className="text-xs text-text-secondary mt-1">{p.rechazo}</p>
              <p className="text-xs text-text-secondary mt-1">Pide la corrección desde «Mis fichajes», o díselo a tu encargado.</p>
              <button onClick={() => descartar(p.clave)} className="mt-2 text-xs font-semibold text-danger underline">
                Ya lo he pedido: quitar este aviso
              </button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
