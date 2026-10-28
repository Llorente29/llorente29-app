// src/components/personal/FueraDelRadioBloque.tsx
//
// L1a · PR 1 (27/10/2026). «Para revisar», arriba en Control horario: los
// fichajes de los últimos 7 días que cayeron fuera del radio de su local.
// Fuera del radio no se bloquea por defecto (decisión de Julio): se guarda, se
// marca y se avisa al encargado aquí. Están todos (regla 7): el número es
// cuántos hay. Si no hay ninguno, no se pinta nada.
import { useEffect, useState } from 'react'
import { MapPinOff } from 'lucide-react'
import { Card } from '../ui'
import {
  leerFueraDelRadio, metros, DIAS_FUERA_DEL_RADIO, type FueraDelRadio,
} from '../../services/fueraDelRadioService'

const TIPO: Record<string, string> = { entrada: 'Entrada', salida: 'Salida', pausa_inicio: 'Pausa', pausa_fin: 'Vuelta de la pausa' }

function diaYHora(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  personas: { id: string; name: string }[]
  locales: { id: string; name: string }[]
}

export default function FueraDelRadioBloque({ personas, locales }: Props) {
  const [dato, setDato] = useState<FueraDelRadio | null>(null)
  const [error, setError] = useState('')
  const clave = personas.map(p => p.id).sort().join(',')

  useEffect(() => {
    let vivo = true
    leerFueraDelRadio(clave ? clave.split(',') : [])
      .then(d => { if (vivo) { setDato(d); setError('') } })
      .catch(e => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [clave])

  if (error) {
    return <Card className="p-4 border-danger/40"><p className="text-sm text-danger">{error}</p></Card>
  }
  if (!dato || !dato.disponible || dato.fichajes.length === 0) return null

  const nombre = new Map(personas.map(p => [p.id, p.name]))
  const local = new Map(locales.map(l => [l.id, l.name]))
  const n = dato.fichajes.length
  return (
    <div data-prueba="fuera-del-radio">
      <Card className="border-warning/40">
        <div className="p-4 border-b border-border-default bg-warning-bg rounded-t-xl flex items-center gap-2">
          <MapPinOff size={16} className="text-warning" />
          <h3 className="font-semibold text-sm text-warning">
            Para revisar: {n} fichaje{n > 1 ? 's' : ''} fuera del radio en los últimos {DIAS_FUERA_DEL_RADIO} días
          </h3>
        </div>
        <div className="divide-y divide-border-default">
          {dato.fichajes.map(f => (
            <div key={f.id} className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm text-text-primary">
                <span className="font-medium">{nombre.get(f.employeeId) ?? 'Persona'}</span>
                <span className="text-text-secondary"> · {TIPO[f.tipo] ?? f.tipo} del {diaYHora(f.hora)}</span>
              </p>
              <p className="text-sm text-text-secondary">
                a {metros(f.distanciaM)} de {(f.locationId && local.get(f.locationId)) || 'su local'}
              </p>
            </div>
          ))}
        </div>
        <p className="px-4 py-2 text-xs text-text-secondary border-t border-border-default">
          Se guardaron con su distancia: nadie se quedó sin fichar. Si alguno está mal, corrígelo con su motivo.
        </p>
      </Card>
    </div>
  )
}
