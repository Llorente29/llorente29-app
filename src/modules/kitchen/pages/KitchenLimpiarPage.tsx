// src/modules/kitchen/pages/KitchenLimpiarPage.tsx
//
// LA ENTRADA DEL GESTOR: dos montones sobre los que se trabaja, no una lista.
// Encargo de Julio, 13/09 15:35 §2.
//
//   Le falta decir qué lleva · 97   — empezando por «Salsa Harissa», en 7
//   No lo pide nadie · 52           — empezando por la que lleva más sin venderse
//
// No son dos cifras de adorno: cada fila se pincha y se entra a trabajar.
//
// ── EL ORDEN DEL MONTÓN QUE SOBRA, que es media pantalla ───────────────────
// Tres escalones, y ninguno esconde nada (regla 7): candidatas de verdad
// arriba, las decididas hace poco en su propio grupo abajo, y las cedidas al
// final. Salió de un caso real: la primera fila era «Carnitas (Cerdo)», que
// Julio había decidido tres horas antes — la pantalla de limpiar ofrecía
// deshacer el trabajo recién hecho. Julio: «si lo primero que ves es la trampa,
// el cartel llega tarde».

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, BotonCocina,
  PastillaCocina, CifrasCocina, CifraCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { getLosDosMontones } from '@/modules/kitchen/services/limpiarLaCartaService'
import {
  tituloDeLoQueFalta, tituloDeLoQueSobra, porDondeEmpezarLoQueFalta,
  elDesgloseDeLoQueSobra, rotuloDeLasDecididasHacePoco, ROTULO_DE_LAS_CEDIDAS,
  elDiaQueEsteTodoHecho, loQueLlevaSinVenderse, loDeLosPedidosAnulados,
  cuandoSeDecidio,
  type LosDosMontones, type UnNombreSinDecidir, type UnaQueNadiePide,
} from '@/modules/kitchen/lib/loQueSobraYLoQueFalta'

/** Una fila del montón que falta. Se pincha y se entra a resolverlas todas. */
function FilaQueFalta({ f, onAbrir }: { f: UnNombreSinDecidir; onAbrir: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onAbrir(f.entrarPor)}
      title={`Abrir «${f.nombre}»`}
      className="w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-cocina-linea-suave last:border-b-0 transition-base hover:bg-cocina-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cocina-acento focus-visible:ring-inset"
    >
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-[13.5px] text-cocina-tinta">{f.nombre}</span>
        <span className="block text-[12px] text-cocina-tinta-3 mt-0.5">
          {f.marcas.join(' · ')}
        </span>
      </span>
      {f.cuantas > 1 && (
        <PastillaCocina tono="ambar">en {f.cuantas} preguntas</PastillaCocina>
      )}
      <span className="shrink-0 text-[12.5px] font-semibold text-cocina-acento">Abrir</span>
    </button>
  )
}

/** Una fila del montón que sobra. */
function FilaQueSobra({ f, onAbrir }: { f: UnaQueNadiePide; onAbrir: (id: string) => void }) {
  const anulados = loDeLosPedidosAnulados(f)
  const decidida = cuandoSeDecidio(f)
  return (
    <button
      type="button"
      onClick={() => onAbrir(f.id)}
      title={`${f.cedida ? 'Ver' : 'Abrir'} «${f.nombre}»`}
      className={`w-full text-left flex items-start gap-3 px-4 py-2.5 border-b border-cocina-linea-suave last:border-b-0 transition-base hover:bg-cocina-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cocina-acento focus-visible:ring-inset ${f.cedida ? 'opacity-70' : ''}`}
    >
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-[13.5px] text-cocina-tinta">{f.nombre}</span>
        <span className="block text-[12px] text-cocina-tinta-3 mt-0.5">
          {f.marca} · {f.pregunta}
        </span>
        <span className="block text-[11.5px] text-cocina-tinta-3 mt-1">
          {loQueLlevaSinVenderse(f)}
          {anulados && <span className="ml-1.5 text-cocina-ambar">· {anulados}</span>}
        </span>
        {/* Lo decidido hace poco lo dice la fila, no solo el grupo: quien llega
            aquí desde un enlace directo también tiene que verlo. */}
        {decidida && f.decididaReciente && (
          <span className="block text-[11.5px] text-cocina-acento-ink mt-0.5">{decidida}</span>
        )}
      </span>
      <span className="shrink-0 text-[12.5px] font-semibold text-cocina-acento">
        {f.cedida ? 'Ver' : 'Abrir'}
      </span>
    </button>
  )
}

export default function KitchenLimpiarPage() {
  const { activeAccountId } = useActiveAccount()
  const navigate = useNavigate()
  const [datos, setDatos] = useState<LosDosMontones | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!activeAccountId) return
      setCargando(true); setError(null)
      try {
        const d = await getLosDosMontones(activeAccountId, 30)
        if (vivo) setDatos(d)
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [activeAccountId])

  const abrir = (id: string) => navigate(`/kitchen/respuestas/${id}`)

  const sobra = datos?.sobra
  const candidatas = (sobra?.filas ?? []).filter((f) => !f.cedida && !f.decididaReciente)
  const hacePoco   = (sobra?.filas ?? []).filter((f) => !f.cedida && f.decididaReciente)
  const cedidas    = (sobra?.filas ?? []).filter((f) => f.cedida)
  const todoHecho  = datos
    ? elDiaQueEsteTodoHecho(datos.falta.respuestas, datos.sobra.candidatas) : null

  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Cocina · Preguntas de la carta"
          pregunta="Qué hay que trabajar"
          regla={
            <>
              Dos montones y nada más. Uno es la calidad del dato —qué se descuenta
              del almacén— y el otro es la carta —qué ocupa sitio sin venderse—. El
              día que los dos estén a cero, el gestor ha hecho su trabajo.
            </>
          }
        >
          <BotonCocina peso="fantasma" onClick={() => navigate('/kitchen/modificadores')}>
            Ver las preguntas
          </BotonCocina>
          <BotonCocina peso="relleno" onClick={() => navigate('/kitchen/preguntas/nueva')}>
            + Crear una pregunta
          </BotonCocina>
        </CabeceraCocina>

        {(cargando || error) && (
          <div className="mt-4">
            <EstadoDeLaConsulta
              hayFilas={!cargando && !error}
              cargando={cargando}
              textoCargando="Contando lo que falta y lo que sobra…"
              error={error}
              queSePregunto="los dos montones"
            />
          </div>
        )}

        {datos && !cargando && !error && (
          <>
            {todoHecho && (
              <div className="mt-4 rounded-cocina-md border border-cocina-verde/40 bg-cocina-verde-bg px-4 py-3 text-[13.5px] text-cocina-verde">
                <b>{todoHecho}</b>
              </div>
            )}

            <div className="mt-4">
              <CifrasCocina>
                <CifraCocina
                  titulo="Le falta decir qué lleva"
                  valor={String(datos.falta.respuestas)}
                  tono={datos.falta.respuestas > 0 ? 'aviso' : 'bueno'}
                  pie={`${datos.falta.nombres} nombres distintos · ${datos.falta.alcanzables} se pueden tocar`}
                />
                <CifraCocina
                  titulo="No lo pide nadie"
                  valor={String(datos.sobra.candidatas)}
                  sufijo={`de ${datos.sobra.respuestas}`}
                  tono={datos.sobra.candidatas > 0 ? 'aviso' : 'bueno'}
                  pie={`sin una sola venta en ${datos.dias} días`}
                />
              </CifrasCocina>
            </div>

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
              {/* ── MONTÓN 1 · LO QUE FALTA ──────────────────────────────── */}
              <PanelCocina>
                <RotuloDePanel derecha={`${datos.falta.alcanzables} se pueden tocar`}>
                  {tituloDeLoQueFalta(datos.falta.respuestas)}
                </RotuloDePanel>
                {porDondeEmpezarLoQueFalta(datos.falta.filas) && (
                  <p className="px-4 pb-2.5 text-[12px] text-cocina-tinta-3 leading-[1.5]">
                    {porDondeEmpezarLoQueFalta(datos.falta.filas)}
                  </p>
                )}
                <div>
                  {datos.falta.filas.map((f) => (
                    <FilaQueFalta key={f.nombre} f={f} onAbrir={abrir} />
                  ))}
                  {datos.falta.filas.length === 0 && (
                    <p className="px-4 py-6 text-[13px] text-cocina-tinta-3">
                      Todas las respuestas dicen qué llevan.
                    </p>
                  )}
                </div>
              </PanelCocina>

              {/* ── MONTÓN 2 · LO QUE SOBRA ──────────────────────────────── */}
              <PanelCocina>
                <RotuloDePanel derecha={`en ${datos.sobra.preguntas} preguntas`}>
                  {tituloDeLoQueSobra(datos.sobra.candidatas)}
                </RotuloDePanel>
                <p className="px-4 pb-2.5 text-[12px] text-cocina-tinta-3 leading-[1.5]">
                  {elDesgloseDeLoQueSobra({ ...datos.sobra, dias: datos.dias })}
                </p>
                <div>
                  {candidatas.map((f) => <FilaQueSobra key={f.id} f={f} onAbrir={abrir} />)}

                  {/* Lo decidido hace poco NO se esconde: baja, con su rótulo. */}
                  {hacePoco.length > 0 && (
                    <>
                      <div className="px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2 text-[12px] font-bold text-cocina-tinta-3">
                        {rotuloDeLasDecididasHacePoco(hacePoco.length, datos.dias)}
                      </div>
                      {hacePoco.map((f) => <FilaQueSobra key={f.id} f={f} onAbrir={abrir} />)}
                    </>
                  )}

                  {cedidas.length > 0 && (
                    <>
                      <div className="px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2 text-[12px] font-bold text-cocina-tinta-3">
                        {ROTULO_DE_LAS_CEDIDAS} — {cedidas.length}
                      </div>
                      {cedidas.map((f) => <FilaQueSobra key={f.id} f={f} onAbrir={abrir} />)}
                    </>
                  )}

                  {datos.sobra.filas.length === 0 && (
                    <p className="px-4 py-6 text-[13px] text-cocina-tinta-3">
                      Todo lo que hay en la carta se ha pedido este mes.
                    </p>
                  )}
                </div>
              </PanelCocina>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
