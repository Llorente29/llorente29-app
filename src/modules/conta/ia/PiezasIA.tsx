// src/modules/conta/ia/PiezasIA.tsx
//
// Lo de la IA en «Tu empresa» (encargo §6.2 y §6.3):
//   · Sugerencias: qué propone, por qué y dos respuestas. Aceptar aplica el
//     cambio (y queda en el registro); rechazar la cierra y no vuelve por el
//     mismo motivo.
//   · Registro: qué hizo la IA, sobre qué, por qué, cuándo y para quién; se
//     deshace desde aquí. Nadie lo escribe a mano.
// Cada respuesta confirma con contenido o enseña el fallo (regla 8).

import { BloqueIA } from '@/modules/conta/ui/piezas'
import { hechoAlAceptar, queHizo, sePuedeDeshacer, type Registro, type Sugerencia } from '@/modules/conta/ia/tipos'
import { deshacer, responderSugerencia } from '@/modules/conta/services/iaService'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { MARCA } from '../cuenta/marca'

// La hora de Madrid (regla 4): done_at está en UTC.
const FECHA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' })
const HORA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })
const hora = (iso: string) => `${FECHA.format(new Date(iso))} a las ${HORA.format(new Date(iso))}`

export function Sugerencias({ sugerencias, alCambiar }: { sugerencias: Sugerencia[]; alCambiar: () => void }) {
  const h = useHacer(alCambiar)
  if (sugerencias.length === 0 && !h.hecho && !h.fallo) return null
  return (
    <div className="cx-sugerencias">
      {sugerencias.map((s) => (
        <BloqueIA key={s.id} titulo={s.title} porque={s.why} acciones={(
          <>
            <button type="button" className="cx-boton" disabled={h.guardando}
              onClick={() => { let anadidos: string[] = []; void h.hacer(async () => { anadidos = await responderSugerencia(s.id, true) }, () => hechoAlAceptar(s, anadidos)) }}>
              Sí, añádelo
            </button>
            <button type="button" className="cx-boton-sec" disabled={h.guardando}
              onClick={() => void h.hacer(async () => { await responderSugerencia(s.id, false) }, 'Vale, no lo añado. No te lo vuelvo a proponer por lo mismo.')}>
              No, gracias
            </button>
          </>
        )} />
      ))}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </div>
  )
}

/** enElPlan: cuántos cambios hay en el historial del plan, que va debajo (S01e: no decir «nada» con algo hecho). */
export function RegistroIA({ registro, alCambiar, movil, enElPlan = 0 }: { registro: Registro[]; alCambiar: () => void; movil: boolean; enElPlan?: number }) {
  const h = useHacer(alCambiar)
  return (
    <TarjetaApartado titulo={`Lo que ha hecho ${MARCA.nombre}`} movil={movil}>
      {registro.length === 0 ? (
        <p className="cx-vacio">
          {enElPlan > 0
            ? `En los datos de tu empresa no ha cambiado nada por su cuenta. Lo que ha hecho en tu plan contable está debajo, en su historial.`
            : 'Aún no ha hecho nada por su cuenta. Cuando lo haga, lo verás aquí con su porqué, y lo podrás deshacer.'}
        </p>
      ) : (
        <ul className="cx-registro" aria-label={`Lo que ha hecho ${MARCA.nombre}`}>
          {registro.map((r) => {
            const d = sePuedeDeshacer(r)
            return (
              <li key={r.id} className={r.undoneAt ? 'cx-registro-deshecho' : undefined}>
                <div className="cx-fila-texto">
                  <span className="cx-fila-titulo">{queHizo(r)}</span>
                  <span className="cx-fila-apoyo">Por qué: {r.reason}</span>
                  <span className="cx-fila-apoyo">{hora(r.doneAt)}{r.doneForName ? ` · lo hizo para ${r.doneForName}` : ''}</span>
                </div>
                {d.ok ? (
                  <button type="button" className="cx-boton-sec" disabled={h.guardando} aria-label={`Deshacer: ${queHizo(r)}`}
                    onClick={() => void h.hacer(() => deshacer(r.id), `Deshecho: ${queHizo(r).charAt(0).toLowerCase()}${queHizo(r).slice(1)}.`)}>
                    Deshacer
                  </button>
                ) : <span className="cx-chip">{d.motivo}</span>}
              </li>
            )
          })}
        </ul>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}
