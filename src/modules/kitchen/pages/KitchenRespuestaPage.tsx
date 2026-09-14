// src/modules/kitchen/pages/KitchenRespuestaPage.tsx
//
// LA FICHA DE UNA RESPUESTA. Encargo de Julio, 13/09 15:35 §2.
//
// Cuatro cosas y sin pestañas: el nombre grande, QUÉ LLEVA, DÓNDE ESTÁ (la
// lista de preguntas y marcas, cada una abrible) y CUÁNTO SE PIDE.
//
// Y lo que separa esto de una pantalla correcta: cada número es un sitio al que
// ir. «En 7 preguntas» se pincha. «0 ventas» se pincha y enseña cuáles fueron
// las últimas, si las hubo — y si las hubo y se anularon, lo dice, porque el
// cero nunca va solo.
//
// RETIRAR vive aquí y no es un botón rojo con un «¿seguro?»: primero los
// números, y si se vende, se dice más fuerte.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, BotonCocina,
  PastillaCocina, AvisoCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  getFichaDeRespuesta, retirar, type FichaDeRespuesta,
} from '@/modules/kitchen/services/limpiarLaCartaService'
import {
  laLineaDeDondeEsta, cuantasDeAhiSiguenSinDecidir, laLineaDeCuantoSePide,
  loQuePasaSiRetiras, elAvisoDeQueSeVende, porQueNoSePuedeRetirar,
  textoDelBotonDeRetirar, laConfirmacionDeRetirar,
} from '@/modules/kitchen/lib/loQueSobraYLoQueFalta'
import { tituloDelQueLleva } from '@/modules/kitchen/lib/crearPreguntaDeCocina'
import { loQueLastTeHaDeshecho } from '@/modules/kitchen/lib/preguntasDeCocina'
// `precio` y `total` vienen del servidor: si llegan nulos, `.toFixed` revienta
// y `isFinite(null)` no lo caza. Los helpers devuelven un guión y siguen.
import { fmtMoney } from '@/lib/format'

const DE_LA_BASE: Record<string, string> = {
  add_item: 'lleva', remove_item: 'quita', replace_item: 'cambia',
  multiply: 'multiplica', bundle: 'es_un_plato', none: 'no_lleva_nada',
}

function laFecha(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export default function KitchenRespuestaPage() {
  const { respuestaId } = useParams<{ respuestaId: string }>()
  const { activeAccountId } = useActiveAccount()
  const navigate = useNavigate()
  const [f, setF] = useState<FichaDeRespuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verVentas, setVerVentas] = useState(false)
  const [vaARetirar, setVaARetirar] = useState(false)
  const [retirando, setRetirando] = useState(false)
  const [confirmacion, setConfirmacion] = useState<string | null>(null)

  // El `setState` va SIEMPRE dentro de la parte asíncrona, nunca en el cuerpo
  // síncrono: `react-hooks/set-state-in-effect` lo prohíbe y tiene razón — un
  // setState síncrono encadena repintados. (Ya me mordió el 12/09 y el 13/09.)
  // Se relee con un contador y no con un `cargar()` suelto llamado desde el
  // efecto: `react-hooks/set-state-in-effect` prohíbe —con razón— que el cuerpo
  // del efecto ponga estado de forma síncrona, y una función con `setState`
  // dentro cuenta igual aunque la llamada sea asíncrona. Subir el contador es
  // la forma idiomática de decir «vuelve a leer» sin encadenar repintados.
  const [refresco, setRefresco] = useState(0)

  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!activeAccountId || !respuestaId) return
      setCargando(true); setError(null)
      try {
        const d = await getFichaDeRespuesta(activeAccountId, respuestaId, 30)
        if (vivo) setF(d)
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [activeAccountId, respuestaId, refresco])

  async function haceloDeVerdad(encender: boolean) {
    if (!activeAccountId || !f) return
    setRetirando(true)
    try {
      const r = await retirar({
        accountId: activeAccountId, opciones: [f.id], actor: 'Oficina', encender,
      })
      setConfirmacion(laConfirmacionDeRetirar(r))
      setVaARetirar(false)
      setRefresco((x) => x + 1)
    } catch (e) {
      setConfirmacion(e instanceof Error ? e.message : String(e))
    } finally {
      setRetirando(false)
    }
  }

  // Los platos de todas sus preguntas, que es lo que de verdad se retira.
  const platos = (f?.dondeEsta ?? []).reduce((a, s) => a + s.platos, 0)
  const sinDecidirAhi = f ? cuantasDeAhiSiguenSinDecidir(f.dondeEsta) : 0
  const loQuePasa = f ? loQuePasaSiRetiras({
    nombre: f.nombre, preguntas: f.dondeEsta.length, platos,
    ventas: f.ventas.ventas, dias: f.ventas.dias, cedida: f.cedida, marca: f.marca,
  }) : ''
  const avisoVende = f ? elAvisoDeQueSeVende({
    nombre: f.nombre, preguntas: f.dondeEsta.length, platos,
    ventas: f.ventas.ventas, dias: f.ventas.dias, cedida: f.cedida, marca: f.marca,
  }) : null
  const noSePuede = f ? porQueNoSePuedeRetirar(f) : null

  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Cocina · Preguntas de la carta"
          pregunta={f ? f.nombre : 'Una respuesta'}
          regla={f ? `${f.marca} · ${f.pregunta}` : ''}
        >
          <BotonCocina peso="fantasma" onClick={() => navigate('/kitchen/limpiar')}>
            Volver a los dos montones
          </BotonCocina>
          {f && !f.cedida && (
            <BotonCocina peso="fantasma" onClick={() => navigate(`/kitchen/preguntas/${f.preguntaId}`)}>
              Abrir la pregunta
            </BotonCocina>
          )}
        </CabeceraCocina>

        {(cargando || error) && (
          <div className="mt-4">
            <EstadoDeLaConsulta
              hayFilas={!cargando && !error && f !== null}
              cargando={cargando}
              textoCargando="Leyendo la respuesta…"
              error={error}
              queSePregunto="esta respuesta"
            />
          </div>
        )}

        {f && !cargando && !error && (
          <div className="mt-4 flex flex-col gap-4">
            {confirmacion && (
              <AvisoCocina onCerrar={() => setConfirmacion(null)}>{confirmacion}</AvisoCocina>
            )}

            {!f.activa && (
              <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-ambar-bg text-cocina-ambar border border-cocina-ambar/35 flex items-center justify-between gap-3">
                <span>
                  <b>Retirada de la carta.</b>
                  {f.retiradaPor === 'persona' ? ' La retiró una persona' : ' La apagó Last'}
                  {f.retiradaAt ? ` el ${laFecha(f.retiradaAt)}` : ''}. No la ve ningún cliente.
                </span>
                {f.retiradaPor === 'persona' && !f.cedida && (
                  <BotonCocina peso="borde" disabled={retirando}
                    onClick={() => void haceloDeVerdad(true)}>
                    Volver a ponerla
                  </BotonCocina>
                )}
              </div>
            )}

            {/* ── LAST TE LO HA DESHECHO ──────────────────────────────────
                El contrario del de arriba: aquélla está retirada; ésta está a
                la venta porque el importador deshizo lo que decidió alguien.
                Sin esto, quien la quitó no se entera nunca. */}
            {loQueLastTeHaDeshecho(f, laFecha) && (
              <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-ambar-bg text-cocina-ambar border border-cocina-ambar/35 flex items-center justify-between gap-3">
                <span>
                  <b>Last la ha vuelto a encender.</b>{' '}
                  {loQueLastTeHaDeshecho(f, laFecha)}
                </span>
                {!f.cedida && (
                  <BotonCocina peso="borde" disabled={retirando}
                    onClick={() => void haceloDeVerdad(false)}>
                    Volver a quitarla
                  </BotonCocina>
                )}
              </div>
            )}

            {noSePuede && (
              <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-ambar-bg text-cocina-ambar border border-cocina-ambar/35">
                {noSePuede}
              </div>
            )}

            {/* ── 1 · QUÉ LLEVA ─────────────────────────────────────────── */}
            <PanelCocina>
              <RotuloDePanel derecha={f.precio > 0 ? `suma ${fmtMoney(f.precio)}` : 'no cobra'}>
                Qué lleva
              </RotuloDePanel>
              <div className="px-4 pb-4">
                {f.efecto === null ? (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[13.5px] text-cocina-ambar">
                      Nadie ha dicho todavía qué lleva. Se vende sin descontar nada del almacén.
                    </span>
                    {!f.cedida && (
                      <BotonCocina peso="relleno"
                        onClick={() => navigate(`/kitchen/preguntas/${f.preguntaId}`)}>
                        Decir qué lleva
                      </BotonCocina>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-[15px] font-semibold text-cocina-tinta">
                      {tituloDelQueLleva(
                        (DE_LA_BASE[f.efecto.tipo] ?? 'no_lleva_nada') as never,
                      ).replace('…', '')}
                      {f.efecto.fichaNombre && (
                        <> {f.efecto.cantidad ?? ''} {f.efecto.fichaNombre}</>
                      )}
                    </span>
                    {!f.efecto.descuentaAlgo && (
                      <PastillaCocina tono="rojo">no descuenta nada</PastillaCocina>
                    )}
                    {f.efecto.quien && (
                      <span className="text-[11.5px] text-cocina-tinta-3">
                        Lo dijo {f.efecto.quien}
                        {f.efecto.cuando ? ` el ${laFecha(f.efecto.cuando)}` : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </PanelCocina>

            {/* ── 2 · DÓNDE ESTÁ ────────────────────────────────────────── */}
            <PanelCocina>
              <RotuloDePanel
                derecha={sinDecidirAhi > 0
                  ? `${sinDecidirAhi} sin decidir` : 'todas decididas'}
              >
                {laLineaDeDondeEsta(f.dondeEsta)}
              </RotuloDePanel>
              <div>
                {f.dondeEsta.map((s) => (
                  <button
                    key={s.id} type="button"
                    onClick={() => navigate(`/kitchen/preguntas/${s.preguntaId}`)}
                    title={`Abrir «${s.pregunta}»`}
                    className="w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-cocina-linea-suave last:border-b-0 transition-base hover:bg-cocina-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cocina-acento focus-visible:ring-inset"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-cocina-tinta">
                        {s.pregunta}
                        {s.esEsta && <span className="ml-1.5 text-cocina-tinta-3">· ésta</span>}
                      </span>
                      <span className="block text-[11.5px] text-cocina-tinta-3 mt-0.5">
                        {s.marca} · {s.platos === 1 ? '1 plato' : `${s.platos} platos`}
                      </span>
                    </span>
                    {s.cedida && <PastillaCocina tono="apagado">la manda Last</PastillaCocina>}
                    {!s.decidida && <PastillaCocina tono="ambar">sin decidir</PastillaCocina>}
                    <span className="shrink-0 text-[12.5px] font-semibold text-cocina-acento">Abrir</span>
                  </button>
                ))}
              </div>
            </PanelCocina>

            {/* ── 3 · CUÁNTO SE PIDE ────────────────────────────────────── */}
            <PanelCocina>
              <RotuloDePanel>Cuánto se pide</RotuloDePanel>
              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => setVerVentas((v) => !v)}
                  className="text-left text-[13.5px] text-cocina-tinta underline decoration-cocina-linea underline-offset-4 hover:decoration-cocina-acento"
                >
                  {laLineaDeCuantoSePide(f.ventas)}
                  <span className="ml-1.5 text-[12px] text-cocina-acento">
                    {verVentas ? 'ocultar' : 'ver cuáles'}
                  </span>
                </button>
                {verVentas && (
                  <div className="mt-2.5 flex flex-col gap-1">
                    {f.ventas.ultimas.length === 0 ? (
                      <span className="text-[12.5px] text-cocina-tinta-3">
                        Ni un solo pedido con ella en {f.ventas.dias} días.
                        {f.ultimaVenta && ` La última vez fue el ${laFecha(f.ultimaVenta)}.`}
                      </span>
                    ) : f.ventas.ultimas.map((u, i) => (
                      <span key={`${u.cuando}-${i}`} className="text-[12.5px] text-cocina-tinta-2">
                        {laFecha(u.cuando)} · {u.canal} · {fmtMoney(u.total)}
                        {u.anulada && <span className="ml-1.5 text-cocina-ambar">anulado</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </PanelCocina>

            {/* ── 4 · RETIRAR, CON LA VERDAD DELANTE ────────────────────── */}
            {f.activa && !f.cedida && (
              <PanelCocina>
                <RotuloDePanel>Retirar de la carta</RotuloDePanel>
                <div className="px-4 pb-4 flex flex-col gap-2.5">
                  <p className="text-[13px] text-cocina-tinta leading-[1.55]">{loQuePasa}</p>
                  {avisoVende && (
                    <p className="text-[13px] font-semibold text-cocina-ambar leading-[1.5]">
                      {avisoVende}
                    </p>
                  )}
                  <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
                    Se retira, no se borra: queda con quién y cuándo, se sigue viendo aquí y se
                    puede volver a encender. Borrarla se llevaría por delante el historial de
                    todo lo que se vendió con ella.
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    {!vaARetirar ? (
                      <BotonCocina peso="borde" onClick={() => setVaARetirar(true)}>
                        {textoDelBotonDeRetirar(1)}
                      </BotonCocina>
                    ) : (
                      <>
                        <BotonCocina peso="relleno" disabled={retirando}
                          onClick={() => void haceloDeVerdad(false)}>
                          {retirando ? 'Retirando…' : 'Sí, retirarla'}
                        </BotonCocina>
                        <BotonCocina peso="fantasma" onClick={() => setVaARetirar(false)}>
                          Dejarla como está
                        </BotonCocina>
                      </>
                    )}
                  </div>
                </div>
              </PanelCocina>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
