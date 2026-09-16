// src/modules/pase/components/CerrarAMano.tsx
//
// CERRAR A MANO · 17/09/2026, decisión de Julio.
//
// La excepción, no un paso. El cliente no abre, el rider se queda sin batería,
// se entregó y nadie lo marcó: pedidos que se quedan vivos en la pantalla para
// siempre porque el aviso que los cerraría no va a llegar nunca.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ SE ELIGE EL PEDIDO DE UNA LISTA Y NO SE CIERRA DESDE LA TARJETA
//
// El encargo preguntaba cuál de las dos formas cabe mejor. La respuesta no es
// de gusto: **desde la tarjeta no puede ser**, y lo dice la propia maqueta.
//
//   · Regla 3 de la hoja: NINGUNA acción que cambie el estado del pedido, salvo
//     reimprimir. Tocar la tarjeta abre la hoja; si dentro de la hoja hubiera un
//     «cerrar», sería exactamente lo que esa regla prohíbe, y en una pantalla
//     que se abre con la bolsa en una mano.
//   · Y lo que hay que cerrar a mano SUELE NO ESTAR EN PANTALLA: una bolsa del
//     grupo 2 que se fue sola a los 30 minutos, o un reparto nuestro que lleva
//     hora y media en «En ruta». Si sólo se pudiera cerrar lo que se toca, lo
//     que más falta hace cerrar sería justo lo que no se puede.
//
// Por eso: pie → lista → motivo → cerrar. Y la lista enseña TAMBIÉN lo que ya no
// está en ninguna zona, que es el caso que motiva el botón.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL CAMINO DE ESCRITURA ES EL ÚNICO QUE HAY: `order_status = 'completed'`, que
// dispara `trg_sale_close_on_complete` → `close_sale`. No se abre un segundo
// camino de cierre. Lo único nuevo es DÓNDE se guarda el motivo, y eso va con su
// SQL delante antes de aplicarse (ver el parte del 17/09).

import { useState } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import type { TarjetaDelPase } from '../services/paseService'
import { loQuePasa, losMinutos } from '../lib/lasTresZonas'
import { MOTIVOS, loQueFalta, type ClaveMotivo } from '../lib/elCierreAMano'

function Fila({ t, elegido, onElegir }: {
  t: TarjetaDelPase; elegido: boolean; onElegir: () => void
}) {
  return (
    <button onClick={onElegir}
            className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3
                        ${elegido ? 'border-accent bg-accent/10' : 'border-default bg-card'}`}>
      <span className="text-[13px] text-text-tertiary tabular-nums shrink-0 w-[92px]">
        {t.codigo ?? '—'}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14.5px] font-extrabold truncate">{t.marca ?? 'Sin marca'}</b>
        <span className="block text-[12px] text-text-secondary truncate">
          {loQuePasa(t, losMinutos(t))}
        </span>
      </span>
      {elegido && <Check size={18} strokeWidth={3} className="text-accent shrink-0" />}
    </button>
  )
}

export default function CerrarAMano({ pedidos, onCerrar, onConfirmar }: {
  /** Todo lo que sigue vivo, incluido lo que ya no se pinta en ninguna zona. */
  pedidos: TarjetaDelPase[]
  onCerrar: () => void
  /** Devuelve la frase de confirmación, con contenido (regla 8). */
  onConfirmar: (saleId: string, motivo: ClaveMotivo, texto: string) => Promise<string>
}) {
  const [elegido, setElegido] = useState<string | null>(null)
  const [motivo, setMotivo] = useState<ClaveMotivo | null>(null)
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // El botón NO se pulsa hasta que hay pedido Y motivo, y si el motivo es
  // «Otro», hasta que hay texto. No se deshabilita en silencio: debajo se dice
  // qué falta, porque un botón gris que no explica nada se lee como una avería.
  const falta = loQueFalta(elegido, motivo, texto)

  const pulsar = async () => {
    if (falta || !elegido || !motivo) return
    setOcupado(true); setError(null)
    try {
      setHecho(await onConfirmar(elegido, motivo, texto.trim()))
    } catch (e) {
      setError(`No se ha podido cerrar: ${(e as Error).message}. El pedido sigue abierto.`)
    } finally { setOcupado(false) }
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button aria-label="Cerrar" onClick={onCerrar} className="absolute inset-0 bg-black/55" />

      <section className="relative rounded-t-2xl bg-card border-t border-default shadow-2xl
                          flex flex-col min-h-0" style={{ maxHeight: '86%' }}>
        <header className="flex items-center gap-2.5 px-3 py-2.5 border-b border-default shrink-0">
          <AlertTriangle size={18} className="text-warning shrink-0" />
          <b className="text-[16px] font-extrabold">Cerrar a mano</b>
          <span className="text-[12px] text-text-secondary min-w-0 truncate">
            · sólo cuando el pedido no se va a cerrar solo
          </span>
          <button onClick={onCerrar}
                  className="ml-auto shrink-0 min-h-[46px] min-w-[104px] px-3 rounded-xl
                             border border-linea-fuerte bg-card text-text-secondary
                             text-[14.5px] font-extrabold flex items-center justify-center gap-1.5">
            <X size={18} strokeWidth={3} /> Cerrar
          </button>
        </header>

        {hecho ? (
          // Regla 8: confirma con CONTENIDO. «Hecho» no dice nada.
          <div className="px-3 py-6 flex flex-col items-center gap-3">
            <Check size={30} strokeWidth={3} className="text-success" />
            <p className="text-[15px] font-bold text-center">{hecho}</p>
            <button onClick={onCerrar}
                    className="min-h-[48px] px-5 rounded-xl bg-accent text-text-on-accent
                               text-[15px] font-extrabold">
              Volver al pase
            </button>
          </div>
        ) : (
          <div className="overflow-y-auto min-h-0 px-3 py-3 grid gap-3 sm:grid-cols-2 items-start">
            <div className="min-w-0">
              <p className="text-[12.5px] text-text-tertiary mb-1.5">1 · Qué pedido</p>
              <div className="flex flex-col gap-1.5">
                {pedidos.length === 0 && (
                  <p className="text-[13px] text-text-secondary">
                    Ahora mismo no hay ningún pedido vivo que cerrar.
                  </p>
                )}
                {pedidos.map(t => (
                  <Fila key={t.sale_id} t={t} elegido={elegido === t.sale_id}
                        onElegir={() => setElegido(t.sale_id)} />
                ))}
              </div>
            </div>

            <div className="min-w-0 flex flex-col gap-3">
              <div>
                <p className="text-[12.5px] text-text-tertiary mb-1.5">2 · Por qué</p>
                <div className="grid gap-1.5">
                  {MOTIVOS.map(m => (
                    <button key={m.clave} onClick={() => setMotivo(m.clave)}
                            className={`w-full min-h-[50px] rounded-xl border-2 px-3 text-[15px]
                                        font-extrabold text-left
                                        ${motivo === m.clave
                                          ? 'border-accent bg-accent/10 text-text-primary'
                                          : 'border-default bg-card text-text-secondary'}`}>
                      {m.rotulo}
                    </button>
                  ))}
                </div>
                {motivo === 'otro' && (
                  <input value={texto} onChange={e => setTexto(e.target.value)}
                         placeholder="¿Qué ha pasado?" autoFocus
                         className="mt-1.5 w-full min-h-[48px] rounded-xl border border-linea-fuerte
                                    bg-page px-3 text-[15px]" />
                )}
              </div>

              <div>
                <button onClick={() => void pulsar()} disabled={!!falta || ocupado}
                        className="w-full min-h-[56px] rounded-xl bg-danger text-white
                                   text-[16.5px] font-extrabold disabled:opacity-40">
                  {ocupado ? '…' : 'Cerrar el pedido'}
                </button>
                {falta && (
                  <p className="mt-1.5 text-[12.5px] text-text-secondary text-center">{falta}</p>
                )}
                {error && (
                  <p className="mt-1.5 text-[12.5px] text-danger font-semibold text-center">{error}</p>
                )}
                <p className="mt-2 text-[11.5px] text-text-tertiary leading-snug">
                  Se cierra por el mismo camino que un pedido normal
                  --<span className="whitespace-nowrap">order_status = completed</span>-- y queda
                  apuntado el motivo. El consumo NO se revierte: la comida se hizo.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
