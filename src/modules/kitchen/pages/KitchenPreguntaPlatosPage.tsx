// src/modules/kitchen/pages/KitchenPreguntaPlatosPage.tsx
//
// TABLERO 3 · PONERLA EN PLATOS. Encargo del 13/09 10:00.
//
// EL CONTADOR SIEMPRE A LA VISTA: «Estará en 14 platos». Es la cifra que dice
// si la pregunta sirve para algo, así que no se esconde detrás de un scroll ni
// aparece sólo al guardar.
//
// Y SE DICE LO QUE SE QUITA, no sólo lo que se pone. Desmarcar un plato es una
// acción tan importante como marcarlo —deja de preguntársele al cliente— y un
// botón que sólo cuenta las altas esconde la mitad de lo que va a hacer.
//
// LA CATEGORÍA ES UN ATAJO, NO UNA REGLA, y la ayuda lo dice con esas
// palabras. Medido el 12/09: no hay tabla de regla por categoría, ni disparador
// en `menu_item`, ni columna de categoría en `modifier_group_assignment`.
// Prometer que «un plato nuevo la llevará sola» sería un fallo silencioso que
// se descubre semanas después, con un plato sin su pregunta.
//
// El castellano vive en `lib/crearPreguntaDeCocina.ts`, probado allí.

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, BotonCocina, ChipCocina,
  PastillaCocina, AvisoCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  getParaEditar, getPlatosDeLaMarca, ponerEnPlatos,
  type PlatoDeLaMarca, type CategoriaDeLaMarca, type PreguntaGuardada,
} from '@/modules/kitchen/services/editorDePreguntasService'
import {
  elContadorDePlatos, marcarLaCategoria, elCambioEnPlatos,
  laConfirmacionDePlatos, ayudaDeLaCategoria,
} from '@/modules/kitchen/lib/crearPreguntaDeCocina'

export default function KitchenPreguntaPlatosPage() {
  const { activeAccountId: accountId } = useActiveAccount()
  const navigate = useNavigate()
  const { preguntaId } = useParams<{ preguntaId: string }>()
  const estado = useLocation().state as { reciénGuardada?: boolean } | null

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pregunta, setPregunta] = useState<PreguntaGuardada | null>(null)
  const [platos, setPlatos] = useState<PlatoDeLaMarca[]>([])
  const [categorias, setCategorias] = useState<CategoriaDeLaMarca[]>([])
  const [antes, setAntes] = useState<string[]>([])
  const [elegidos, setElegidos] = useState<string[]>([])
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [confirmacion, setConfirmacion] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!accountId || !preguntaId) return
      setCargando(true); setError(null)
      try {
        const d = await getParaEditar(accountId, preguntaId)
        if (!vivo || !d.pregunta) { if (vivo) setCargando(false); return }
        setPregunta(d.pregunta)
        const p = await getPlatosDeLaMarca(accountId, d.pregunta.marcaId, preguntaId)
        if (!vivo) return
        setPlatos(p.platos)
        setCategorias(p.categorias)
        const ya = p.platos.filter((x) => x.yaLaTiene).map((x) => x.id)
        setAntes(ya)
        setElegidos(ya)
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [accountId, preguntaId])

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return platos.filter((p) => {
      if (categoria !== null && (p.categoriaId ?? 'sin') !== categoria) return false
      return t === '' || p.nombre.toLowerCase().includes(t)
    })
  }, [platos, busca, categoria])

  function alterna(id: string) {
    setElegidos((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))
  }

  function marcaCategoria(catId: string) {
    const ids = platos.filter((p) => (p.categoriaId ?? 'sin') === catId).map((p) => p.id)
    const faltanAlgunos = ids.some((id) => !elegidos.includes(id))
    setElegidos((xs) => (faltanAlgunos
      ? [...new Set([...xs, ...ids])]
      : xs.filter((x) => !ids.includes(x))))
  }

  async function guardar() {
    if (!accountId || !preguntaId || !pregunta) return
    setGuardando(true); setError(null)
    try {
      const r = await ponerEnPlatos({ accountId, groupId: preguntaId, platos: elegidos, actor: 'Oficina' })
      setConfirmacion(laConfirmacionDePlatos(r.pregunta, r.total, r.puestos, r.quitados))
      setAntes(elegidos)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  const cambio = elCambioEnPlatos(antes, elegidos)
  const haCambiado = cambio !== 'Sin cambios'

  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Cocina · Preguntas de la carta"
          pregunta={pregunta ? `¿En qué platos va «${pregunta.nombre}»?` : 'Ponerla en platos'}
          regla={pregunta
            ? `${pregunta.marcaNombre} · ${platos.length} platos en la carta · `
              + 'lo que marques aquí es lo que verá el cliente en cada uno'
            : 'Cargando la pregunta…'}
        >
          {pregunta && (
            <BotonCocina peso="fantasma" onClick={() => navigate(`/kitchen/preguntas/${preguntaId}`)}>
              Volver a la pregunta
            </BotonCocina>
          )}
          <BotonCocina peso="fantasma" onClick={() => navigate('/kitchen/modificadores')}>
            Ir a la lista
          </BotonCocina>
        </CabeceraCocina>

        {(cargando || error) && (
          <div className="mt-4">
            <EstadoDeLaConsulta
              hayFilas={!cargando && !error && platos.length > 0}
              cargando={cargando}
              textoCargando="Leyendo los platos de la marca…"
              error={error}
              queSePregunto="los platos de esta marca"
            />
          </div>
        )}

        {!cargando && !error && (
          <div className="mt-4 flex flex-col gap-4">

            {estado?.reciénGuardada && !confirmacion && (
              <AvisoCocina>
                Pregunta guardada. Ahora dile en qué platos va: hasta que esté en
                alguno, no la ve ningún cliente.
              </AvisoCocina>
            )}
            {confirmacion && <AvisoCocina onCerrar={() => setConfirmacion(null)}>{confirmacion}</AvisoCocina>}

            {pregunta?.cedida && (
              <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-ambar-bg text-cocina-ambar border border-cocina-ambar/35">
                <b>La carta de {pregunta.marcaNombre} la manda Last.</b> Aquí se ve en qué
                platos está, pero no se cambia: Last la reescribe cada noche.
              </div>
            )}

            {/* EL CONTADOR, siempre delante */}
            <div className="flex items-center justify-between gap-4 flex-wrap rounded-cocina-md border border-cocina-linea bg-cocina-superficie px-4 py-3 shadow-cocina">
              <div>
                <div className="text-[20px] font-bold tracking-[-0.015em] text-cocina-tinta">
                  {elContadorDePlatos(elegidos.length)}
                </div>
                <div className="text-[12px] text-cocina-tinta-2 mt-0.5">
                  {haCambiado ? cambio : 'Igual que como está guardado ahora'}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <BotonCocina
                  peso="relleno"
                  disabled={!haCambiado || guardando || (pregunta?.cedida ?? false)}
                  onClick={() => void guardar()}
                >
                  {guardando ? 'Guardando…' : 'Guardar en estos platos'}
                </BotonCocina>
                {!haCambiado && !guardando && (
                  <span className="text-[12px] text-cocina-tinta-3">
                    Marca o desmarca algún plato para poder guardar.
                  </span>
                )}
              </div>
            </div>

            {/* El atajo por categoría, con su ayuda honesta */}
            <PanelCocina>
              <RotuloDePanel>Por categoría, para no ir uno a uno</RotuloDePanel>
              <div className="px-4 pb-4 flex flex-col gap-2.5">
                <div className="flex flex-wrap gap-2">
                  {categorias.map((c) => (
                    <ChipCocina key={c.id} onClick={() => marcaCategoria(c.id)}>
                      {marcarLaCategoria(c.nombre, c.cuantosPlatos)}
                    </ChipCocina>
                  ))}
                </div>
                <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
                  {ayudaDeLaCategoria()}
                </p>
              </div>
            </PanelCocina>

            {/* La lista de platos */}
            <PanelCocina>
              <RotuloDePanel>
                Los platos de {pregunta?.marcaNombre ?? 'la marca'}
                <span className="ml-2 font-normal text-cocina-tinta-3">
                  {visibles.length === platos.length
                    ? `${platos.length} platos`
                    : `${visibles.length} de ${platos.length}`}
                </span>
              </RotuloDePanel>

              <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar un plato…"
                  className="h-9 px-3 w-64 text-[13px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina outline-none focus:border-cocina-acento"
                />
                <ChipCocina activo={categoria === null} onClick={() => setCategoria(null)}>
                  Todas
                </ChipCocina>
                {categorias.map((c) => (
                  <ChipCocina key={c.id} activo={categoria === c.id} onClick={() => setCategoria(c.id)}>
                    {c.nombre}
                  </ChipCocina>
                ))}
              </div>

              <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                {visibles.map((p) => {
                  const marcado = elegidos.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { if (!pregunta?.cedida) alterna(p.id) }}
                      className={`flex items-center gap-2.5 text-left px-3 py-2.5 rounded-cocina border transition-base ${
                        marcado
                          ? 'bg-cocina-acento-bg border-cocina-acento'
                          : 'bg-cocina-superficie border-cocina-linea'
                      }`}
                    >
                      <span className={`shrink-0 w-4 h-4 rounded-[4px] border flex items-center justify-center text-[10px] font-bold ${
                        marcado ? 'bg-cocina-acento border-cocina-acento text-white' : 'border-cocina-linea text-transparent'
                      }`}>✓</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium text-cocina-tinta truncate">{p.nombre}</span>
                        <span className="block text-[11px] text-cocina-tinta-3">{p.categoria}</span>
                      </span>
                      {/* Nueve preguntas en un plato es una carta que el cliente
                          no termina de leer. Se dice, no se esconde. */}
                      {p.cuantasPreguntas >= 4 && (
                        <PastillaCocina tono={p.cuantasPreguntas >= 6 ? 'ambar' : 'apagado'}>
                          ya tiene {p.cuantasPreguntas}
                        </PastillaCocina>
                      )}
                    </button>
                  )
                })}
              </div>

              {visibles.length === 0 && platos.length > 0 && (
                <div className="px-4 pb-4 text-[13px] text-cocina-tinta-2">
                  Ningún plato de esta marca coincide con lo que buscas. Los {platos.length}{' '}
                  siguen ahí: quita el filtro para verlos.
                </div>
              )}
            </PanelCocina>

            <p className="text-[12px] text-cocina-tinta-3 leading-[1.5]">
              Al guardar queda <b>pendiente de publicar</b>: sale en Glovo, en Uber y en la
              web con la próxima publicación de la carta, no en el momento.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
