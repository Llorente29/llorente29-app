// src/modules/supply/components/AvisoAutoconteosSinAplicar.tsx
//
// QUE UN FALLO DEL AUTOCONTEO NO VUELVA A QUEDAR MUDO (encargo de Julio del
// 21/10, respuesta 4). Del 12/08 al 21/10 el cron de las 03:10 no aplicó un
// solo conteo y nadie lo vio: pg_cron decía «succeeded». Este aviso sale en la
// pantalla de inventario mientras haya un autoconteo sin aplicar —con un fallo
// apuntado, o abierto más de un día—, con el código, el local y el porqué.
//
// Es un aviso que interrumpe, así que aquí sí hay umbral (regla 7): sin nada
// que avisar no sale nada. Cada fila abre su recuento, que se puede aplicar a
// mano desde la pantalla de revisión.
//
// Solo pinta: los datos le llegan por props.

import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { AutoconteoSinAplicar } from '@/modules/supply/lib/autoconteoTexto'

const fechaCorta = (iso: string) => new Intl.DateTimeFormat('es-ES', {
  weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid',
}).format(new Date(iso))

export default function AvisoAutoconteosSinAplicar({
  items, onOpen,
}: { items: AutoconteoSinAplicar[]; onOpen: (countId: string) => void }) {
  if (items.length === 0) return null
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-bg p-3.5" role="alert">
      <div className="flex items-start gap-2">
        <AlertTriangle size={17} className="text-danger shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary">
            {items.length === 1 ? 'Hay un autoconteo sin aplicar' : `Hay ${items.length} autoconteos sin aplicar`}
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            Lo contado está guardado, pero no ha llegado al stock. Ábrelo para ver por qué y aplicarlo.
          </p>
          <ul className="mt-2.5 divide-y divide-danger/15 border-t border-danger/15">
            {items.map(it => (
              <li key={it.countId}>
                <button type="button" onClick={() => onOpen(it.countId)}
                  className="w-full flex items-center gap-3 py-2 text-left hover:opacity-80 transition-base">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text-primary">
                      <span className="font-medium">{it.code ?? 'Autoconteo'}</span>
                      {it.locationName && <span className="text-text-secondary"> · {it.locationName}</span>}
                      <span className="text-text-secondary"> · del {fechaCorta(it.createdAt)}</span>
                      <span className="text-text-tertiary"> · {it.countedLines} contado{it.countedLines === 1 ? '' : 's'}</span>
                    </div>
                    <div className="text-xs text-danger mt-0.5 break-words">
                      {it.error
                        ? <>No se ha podido aplicar{it.failedAt ? ` el ${fechaCorta(it.failedAt)}` : ''}: {it.error}</>
                        : 'Lleva más de un día abierto y no se ha aplicado.'}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-text-tertiary shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
