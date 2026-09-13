// src/modules/kitchen/pages/KitchenPreguntaPage.tsx
//
// TABLERO 5 · CREAR UNA PREGUNTA (y editarla). Encargo del 13/09 10:00.
//
// EL LISTÓN: un administrativo de oficina de nivel medio tiene que crear una
// pregunta sin que nadie le explique nada. Si hay que explicarle qué es un
// «grupo de modificadores», la pantalla está mal.
//
// LAS PALABRAS. No se llama «modifier group»: se llama PREGUNTA. No son
// «options»: son las RESPUESTAS que puede elegir el cliente. No es «recipe
// impact»: es QUÉ LLEVA. Todo el castellano vive en
// `lib/crearPreguntaDeCocina.ts` y está probado allí con filas reales — aquí no
// se escribe ni una frase suelta.
//
// UNA SOLA PÁGINA, sin pestañas, y ningún cuadro encima de otro cuadro. Lo que
// hay que decidir se decide en la fila, no en un modal que tapa el contexto.
//
// LA VISTA DEL CLIENTE, a la derecha, viva. Es lo que evita las preguntas mal
// escritas, y cuesta poco: se ve lo que va a leer quien pide.
//
// ── LOS CANDADOS NO ESTÁN AQUÍ ─────────────────────────────────────────────
// Esta pantalla no ofrece guardar en una marca cedida, pero eso es una
// cortesía, no una guarda: quien manda es `kitchen_guardar_pregunta`, que
// rechaza la cedida, la ficha archivada, la respuesta nueva sin efecto y los
// nombres repetidos aunque la llame otro.
//
// ── LA DEUDA SE OFRECE, NO SE EXIGE (Julio, 13/09 10:10) ───────────────────
// Al editar una pregunta con respuestas sin decidir, se enseñan y se ofrece
// resolverlas ahí mismo. Ofrecer, no obligar: si corregir un precio obligara a
// resolver nueve fichas, nadie entraría a corregir el precio.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, BotonCocina, ChipCocina,
  PastillaCocina, AvisoCocina, InterruptorCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  getParaEditar, guardarPregunta, buscarFicha, getLasIguales, aplicarALasIguales,
  type MarcaElegible, type PreguntaGuardada, type FichaDelEscandallo,
  type RespuestaAGuardar,
} from '@/modules/kitchen/services/editorDePreguntasService'
import {
  tituloDelTipo, tipoEnLaBase, tituloDelQueLleva, queLlevaEnLaBase,
  laReglaDeLaPantalla, loQueVeraElCliente, porQueNoSePuedeCrear,
  porQueNoSePuedeGuardar, textoDelBotonGuardar, laDeudaDeEstaPregunta,
  precioEnTexto, lineaDelExtra, LOS_QUE_LLEVA,
  laOfertaDeLasIguales, lasQueQuedanFuera, dondeViveLaIgual,
  textoDelBotonDeLasIguales, laConfirmacionDeLasIguales,
  type BorradorDePregunta, type OpcionNueva, type QueLleva, type TipoNuevaPregunta,
  type UnaIgual, type UnaQueQuedaFuera,
} from '@/modules/kitchen/lib/crearPreguntaDeCocina'

const LOS_TIPOS: TipoNuevaPregunta[] = ['elige', 'anade', 'quita', 'sugiere']

/** Una fila del editor: el borrador de la lib más lo que hace falta para escribir. */
interface Fila extends OpcionNueva {
  /** id en la base; null = nueva. */
  filaId: string | null
  fichaId: string | null
  cantidad: string
  unidad: string | null
}

const FILA_VACIA = (): Fila => ({
  filaId: null, extraId: null, nombre: '', precio: 0, queLleva: null,
  yaEstabaDecidido: false, enCuantasPreguntas: 1, queLlevaEnTexto: null,
  fichaId: null, cantidad: '', unidad: null,
})

export default function KitchenPreguntaPage() {
  const { activeAccountId: accountId } = useActiveAccount()
  const navigate = useNavigate()
  const { preguntaId } = useParams<{ preguntaId: string }>()
  const [params] = useSearchParams()
  const editando = Boolean(preguntaId)

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marcas, setMarcas] = useState<MarcaElegible[]>([])
  const [original, setOriginal] = useState<PreguntaGuardada | null>(null)
  const [confirmacion, setConfirmacion] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // El borrador
  const [marcaId, setMarcaId] = useState<string | null>(params.get('marca'))
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoNuevaPregunta>('elige')
  const [obligatoria, setObligatoria] = useState(false)
  const [max, setMax] = useState(1)
  const [repetible, setRepetible] = useState(false)
  const [filas, setFilas] = useState<Fila[]>([FILA_VACIA()])

  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!accountId) return
      setCargando(true); setError(null)
      try {
        const d = await getParaEditar(accountId, preguntaId ?? null)
        if (!vivo) return
        setMarcas(d.marcas)
        if (d.pregunta) {
          setOriginal(d.pregunta)
          setMarcaId(d.pregunta.marcaId)
          setNombre(d.pregunta.nombre)
          setTipo(d.pregunta.tipo)
          setObligatoria(d.pregunta.obligatoria)
          setMax(d.pregunta.max)
          setRepetible(d.pregunta.repetible)
          setFilas(d.pregunta.respuestas.map((r) => ({
            filaId: r.id, extraId: r.id, nombre: r.nombre, precio: r.precio,
            queLleva: r.queLleva, yaEstabaDecidido: r.queLleva !== null,
            enCuantasPreguntas: r.enCuantasPreguntas,
            queLlevaEnTexto: r.fichaNombre
              ? `${r.cantidad ?? ''} ${r.fichaNombre}`.trim() : null,
            fichaId: r.fichaId, cantidad: r.cantidad == null ? '' : String(r.cantidad),
            unidad: r.unidad,
          })))
        }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [accountId, preguntaId])

  const marca = useMemo(() => marcas.find((m) => m.id === marcaId) ?? null, [marcas, marcaId])

  const borrador: BorradorDePregunta = useMemo(() => ({
    marcaId,
    marcaNombre: marca?.nombre ?? '',
    marcaCedida: marca?.cedida ?? false,
    nombre, tipo, max, obligatoria, repetible,
    opciones: filas,
    // Al crear, los platos se eligen en el tablero 3, que es el paso siguiente
    // del mismo botón: aquí se dan por puestos para que el motivo que sale sea
    // el que esta pantalla puede arreglar.
    platosElegidos: editando ? (original?.platos ?? []) : ['siguiente-paso'],
  }), [marcaId, marca, nombre, tipo, max, obligatoria, repetible, filas, editando, original])

  const faltan = editando ? porQueNoSePuedeGuardar(borrador) : porQueNoSePuedeCrear(borrador)
  const sePuede = faltan.length === 0
  const deuda = editando ? laDeudaDeEstaPregunta(filas) : null

  function cambia(i: number, parte: Partial<Fila>) {
    setFilas((f) => f.map((x, j) => (j === i ? { ...x, ...parte } : x)))
  }

  async function guardar() {
    if (!accountId || !marcaId || !sePuede) return
    setGuardando(true); setError(null)
    try {
      const respuestas: RespuestaAGuardar[] = filas.map((f) => ({
        id: f.filaId,
        nombre: f.nombre.trim(),
        precio: f.precio,
        // `null` sólo para las que YA existían y siguen sin decidir: eso deja lo
        // que hubiera como estaba. En una nueva la base lo rechaza, y hace bien.
        efecto: f.queLleva === null ? null : {
          tipo: queLlevaEnLaBase(f.queLleva),
          ficha: f.fichaId,
          cantidad: f.cantidad.trim() === '' ? null : Number(f.cantidad.replace(',', '.')),
          unidad: f.unidad,
        },
      }))
      const r = await guardarPregunta({
        accountId, groupId: preguntaId ?? null, brandId: marcaId,
        nombre: nombre.trim(), tipoEnLaBase: tipoEnLaBase(tipo),
        obligatoria, max, repetible, respuestas, actor: 'Oficina',
      })
      // El botón lleva a los platos, que es lo que dice que hace.
      navigate(`/kitchen/preguntas/${r.preguntaId}/platos`, {
        state: { reciénGuardada: true, resueltas: r.efectosEscritos },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGuardando(false)
    }
  }

  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Cocina · Preguntas de la carta"
          pregunta={editando ? 'Editar la pregunta' : 'Crear una pregunta'}
          regla={marca ? laReglaDeLaPantalla(borrador)
            : 'Elige de qué marca es la pregunta para empezar.'}
        >
          <BotonCocina peso="fantasma" onClick={() => navigate('/kitchen/modificadores')}>
            Volver a la lista
          </BotonCocina>
        </CabeceraCocina>

        {(cargando || error) && (
          <div className="mt-4">
            <EstadoDeLaConsulta
              hayFilas={!cargando && !error}
              cargando={cargando}
              textoCargando="Leyendo las marcas y la pregunta…"
              error={error}
              queSePregunto="la pregunta y sus respuestas"
            />
          </div>
        )}

        {!cargando && (
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
            {/* ── LA COLUMNA DE LA IZQUIERDA: lo que se rellena ───────────── */}
            <div className="flex flex-col gap-4">

              {confirmacion && <AvisoCocina onCerrar={() => setConfirmacion(null)}>{confirmacion}</AvisoCocina>}

              {/* 1 · La marca */}
              {!editando && (
                <PanelCocina>
                  <RotuloDePanel>¿De qué marca es?</RotuloDePanel>
                  <div className="px-4 pb-4 flex flex-wrap gap-2">
                    {marcas.map((m) => (
                      <ChipCocina key={m.id} activo={m.id === marcaId} onClick={() => setMarcaId(m.id)}>
                        {m.nombre}
                        {m.cedida && <span className="ml-1.5 opacity-70">· la manda Last</span>}
                      </ChipCocina>
                    ))}
                  </div>
                </PanelCocina>
              )}

              {/* La raya que no se cruza, dicha con palabras */}
              {marca?.cedida && (
                <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-ambar-bg text-cocina-ambar border border-cocina-ambar/35">
                  <b>La carta de {marca.nombre} la manda Last.</b> Aquí se ve, pero no se
                  toca: lo que guardáramos desaparecería esta noche cuando Last vuelva a
                  mandar su carta, y nadie se enteraría. Para cambiarla, se cambia en Last.
                </div>
              )}

              {/* 2 · Lo que lee el cliente */}
              <PanelCocina>
                <RotuloDePanel>¿Qué le preguntas al cliente?</RotuloDePanel>
                <div className="px-4 pb-4">
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="¿Qué bebida quieres?"
                    disabled={marca?.cedida}
                    className="w-full h-12 px-3.5 text-[18px] font-semibold text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina outline-none focus:border-cocina-acento disabled:opacity-50"
                  />
                  <p className="text-[11.5px] text-cocina-tinta-3 mt-2">
                    Es la frase literal que verá quien pide, en Glovo, en Uber y en la web.
                  </p>
                </div>
              </PanelCocina>

              {/* 3 · Cuántas puede elegir */}
              <PanelCocina>
                <RotuloDePanel>¿Cómo se responde?</RotuloDePanel>
                <div className="px-4 pb-4 flex flex-col gap-3.5">
                  <div className="flex flex-wrap gap-2">
                    {LOS_TIPOS.map((t) => (
                      <ChipCocina key={t} activo={t === tipo} onClick={() => setTipo(t)}>
                        {tituloDelTipo(t)}
                      </ChipCocina>
                    ))}
                  </div>
                  <div className="flex items-center gap-6 flex-wrap">
                    <InterruptorCocina activo={obligatoria} onChange={setObligatoria}>
                      ¿Tiene que elegir por fuerza?
                    </InterruptorCocina>
                    <label className="flex items-center gap-2 text-[13px] font-semibold text-cocina-tinta">
                      ¿Cuántas puede elegir?
                      <input
                        type="number" min={1} value={max}
                        onChange={(e) => setMax(Math.max(1, Number(e.target.value) || 1))}
                        className="w-16 h-9 px-2 text-center bg-cocina-superficie border border-cocina-linea rounded-cocina outline-none focus:border-cocina-acento"
                      />
                    </label>
                    <InterruptorCocina activo={repetible} onChange={setRepetible}>
                      ¿Puede repetir la misma?
                    </InterruptorCocina>
                  </div>
                </div>
              </PanelCocina>

              {/* 4 · Las respuestas */}
              <PanelCocina>
                <RotuloDePanel>
                  Las respuestas que puede elegir
                  {filas.length > 0 && (
                    <span className="ml-2 font-normal text-cocina-tinta-3">
                      {filas.length === 1 ? '1 respuesta' : `${filas.length} respuestas`}
                    </span>
                  )}
                </RotuloDePanel>

                {deuda && (
                  <div className="mx-4 mb-3 rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-ambar-bg text-cocina-ambar border border-cocina-ambar/35">
                    <b>{deuda}</b>
                    <div className="mt-1 text-cocina-tinta-2">
                      No hace falta para guardar: puedes dejarlas como están y volver otro
                      día. Pero mientras no lo digan, esas respuestas se venden sin
                      descontar nada del almacén.
                    </div>
                  </div>
                )}

                <div className="px-4 pb-4 flex flex-col gap-2.5">
                  {filas.map((f, i) => (
                    <FilaDeRespuesta
                      key={f.filaId ?? `nueva-${i}`}
                      fila={f}
                      accountId={accountId}
                      bloqueada={marca?.cedida ?? false}
                      editando={editando}
                      onResuelto={(t) => setConfirmacion(t)}
                      onCambia={(p) => cambia(i, p)}
                      onQuita={() => setFilas((xs) => xs.filter((_, j) => j !== i))}
                    />
                  ))}
                  <div>
                    <BotonCocina
                      peso="borde"
                      disabled={marca?.cedida}
                      onClick={() => setFilas((xs) => [...xs, FILA_VACIA()])}
                    >
                      + Añadir una respuesta
                    </BotonCocina>
                  </div>
                </div>
              </PanelCocina>

              {/* 5 · El botón, y por qué no se puede si no se puede */}
              <div className="flex items-center gap-3 flex-wrap">
                <BotonCocina peso="relleno" disabled={!sePuede || guardando} onClick={() => void guardar()}>
                  {guardando ? 'Guardando…' : textoDelBotonGuardar(borrador, editando)}
                </BotonCocina>
                {/* Ningún botón apagado sin una frase al lado diciendo por qué. */}
                {!sePuede && (
                  <ul className="text-[12.5px] text-cocina-tinta-2 leading-[1.6]">
                    {faltan.map((f) => <li key={f}>· {f}</li>)}
                  </ul>
                )}
              </div>
            </div>

            {/* ── LA COLUMNA DE LA DERECHA: lo que verá el cliente ────────── */}
            <div className="sticky top-4">
              <PanelCocina>
                <RotuloDePanel>Lo que verá el cliente</RotuloDePanel>
                <div className="px-4 pb-4">
                  <div className="rounded-cocina border border-cocina-linea bg-cocina-superficie-2 p-3.5">
                    <div className="text-[15px] font-bold text-cocina-tinta leading-[1.3]">
                      {nombre.trim() || <span className="text-cocina-tinta-3 font-medium">Tu pregunta aparecerá aquí</span>}
                    </div>
                    <div className="mt-1 text-[11.5px] text-cocina-tinta-3">
                      {loQueVeraElCliente(borrador)}
                    </div>
                    <div className="mt-3 flex flex-col gap-1.5">
                      {filas.filter((f) => f.nombre.trim() !== '').map((f, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-[13px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina px-3 py-2">
                          <span className="truncate">{f.nombre.trim()}</span>
                          <span className="shrink-0 text-cocina-tinta-2 text-[12px]">
                            {precioEnTexto(f.precio)}
                          </span>
                        </div>
                      ))}
                      {filas.every((f) => f.nombre.trim() === '') && (
                        <div className="text-[12px] text-cocina-tinta-3 py-2">
                          Escribe las respuestas y aparecerán aquí, como las verá quien pide.
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-[11.5px] text-cocina-tinta-3 mt-2.5 leading-[1.5]">
                    Todavía no está en Glovo ni en Uber: sale con la próxima publicación
                    de la carta.
                  </p>
                </div>
              </PanelCocina>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── UNA FILA: cómo se llama · cuánto suma · qué lleva ──────────────────────
// Las tres cosas en la fila, sin abrir nada. Un modal para decir «40 g de
// yogur» es esconder el contexto justo cuando hace falta.
function FilaDeRespuesta({
  fila, accountId, bloqueada, editando, onCambia, onQuita, onResuelto,
}: {
  fila: Fila
  accountId: string | null
  bloqueada: boolean
  editando: boolean
  onCambia: (p: Partial<Fila>) => void
  onQuita: () => void
  onResuelto: (texto: string) => void
}) {
  const [busca, setBusca] = useState('')
  const [fichas, setFichas] = useState<FichaDelEscandallo[]>([])
  const [abierto, setAbierto] = useState(false)
  const tiempo = useRef<number | null>(null)

  // ── LAS IGUALES ─────────────────────────────────────────────────────────
  // Se preguntan cuando esta respuesta ya tiene efecto y ficha, que es cuando
  // hay algo que ofrecer. Antes de eso no se pregunta nada: sería pedirle a la
  // base una lista para no enseñarla.
  const [iguales, setIguales] = useState<UnaIgual[]>([])
  const [fuera, setFuera] = useState<UnaQueQuedaFuera[]>([])
  const [marcadas, setMarcadas] = useState<string[]>([])
  const [aplicando, setAplicando] = useState(false)
  const [yaAplicado, setYaAplicado] = useState(false)

  const listo = fila.filaId !== null && fila.queLleva !== null
    && (fila.queLleva === 'no_lleva_nada' || fila.queLleva === 'es_un_plato' || fila.fichaId !== null)

  useEffect(() => {
    let vivo = true
    const id = fila.filaId
    // El `setState` va SIEMPRE dentro de la parte asíncrona, nunca en el cuerpo
    // del efecto: `react-hooks/set-state-in-effect` lo prohíbe y tiene razón —
    // un setState síncrono aquí encadena repintados. (Ya me mordió el 12/09.)
    void (async () => {
      if (!accountId || !id || !listo || yaAplicado) {
        if (vivo) { setIguales([]); setFuera([]) }
        return
      }
      try {
        const d = await getLasIguales(accountId, id)
        if (!vivo) return
        setIguales(d.iguales); setFuera(d.fuera)
        setMarcadas(d.iguales.map((i) => i.id))   // todas marcadas, y se desmarcan
      } catch {
        if (vivo) { setIguales([]); setFuera([]) }
      }
    })()
    return () => { vivo = false }
  }, [accountId, fila.filaId, fila.queLleva, fila.fichaId, listo, yaAplicado])

  async function resolverLasIguales() {
    if (!accountId || !fila.filaId || fila.queLleva === null) return
    setAplicando(true)
    try {
      const r = await aplicarALasIguales({
        accountId,
        opciones: [fila.filaId, ...marcadas],
        efecto: {
          tipo: queLlevaEnLaBase(fila.queLleva),
          ficha: fila.fichaId,
          cantidad: fila.cantidad.trim() === '' ? null : Number(fila.cantidad.replace(',', '.')),
          unidad: fila.unidad,
        },
        actor: 'Oficina',
      })
      onResuelto(laConfirmacionDeLasIguales(fila.nombre, r.donde))
      onCambia({ yaEstabaDecidido: true })
      setYaAplicado(true)
    } catch (e) {
      onResuelto(e instanceof Error ? e.message : String(e))
    } finally {
      setAplicando(false)
    }
  }

  const pideFichas = useCallback((texto: string) => {
    if (!accountId) return
    if (tiempo.current) window.clearTimeout(tiempo.current)
    tiempo.current = window.setTimeout(() => {
      void buscarFicha(accountId, texto).then(setFichas).catch(() => setFichas([]))
    }, 220)
  }, [accountId])

  // Las que necesitan un artículo del escandallo. «No lleva nada» y «doble de»
  // no lo piden: pedir una ficha para decir que no lleva nada es un campo que
  // nadie sabe rellenar.
  const pideFicha = fila.queLleva !== null
    && fila.queLleva !== 'no_lleva_nada' && fila.queLleva !== 'es_un_plato'

  return (
    <div className="rounded-cocina border border-cocina-linea bg-cocina-superficie p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <input
          value={fila.nombre}
          onChange={(e) => onCambia({ nombre: e.target.value })}
          placeholder="Cómo se llama"
          disabled={bloqueada}
          className="flex-1 min-w-0 h-9 px-3 text-[13.5px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina outline-none focus:border-cocina-acento disabled:opacity-50"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-cocina-tinta-3 shrink-0">
          suma
          <input
            type="number" step="0.10" min={0} value={fila.precio}
            onChange={(e) => onCambia({ precio: Number(e.target.value) || 0 })}
            disabled={bloqueada}
            className="w-20 h-9 px-2 text-right text-[13.5px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina outline-none focus:border-cocina-acento disabled:opacity-50"
          />
          <span className="text-cocina-tinta-2">€</span>
        </label>
        <button
          type="button" onClick={onQuita} disabled={bloqueada}
          title="Quitar esta respuesta"
          className="shrink-0 w-9 h-9 rounded-cocina border border-cocina-linea text-cocina-tinta-3 disabled:opacity-40"
        >✕</button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-cocina-tinta-3">Qué lleva</span>
        {LOS_QUE_LLEVA.map((q: QueLleva) => (
          <ChipCocina
            key={q}
            activo={fila.queLleva === q}
            onClick={() => { if (!bloqueada) onCambia({ queLleva: q }) }}
          >
            {tituloDelQueLleva(q)}
          </ChipCocina>
        ))}
      </div>

      {pideFicha && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <input
              value={abierto ? busca : (fila.queLlevaEnTexto ?? busca)}
              onChange={(e) => { setBusca(e.target.value); setAbierto(true); pideFichas(e.target.value) }}
              onFocus={() => { setAbierto(true); pideFichas(busca) }}
              placeholder="Busca el artículo del escandallo…"
              disabled={bloqueada}
              className="w-full h-9 px-3 text-[13px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina outline-none focus:border-cocina-acento disabled:opacity-50"
            />
            {abierto && fichas.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-[38px] max-h-56 overflow-auto rounded-cocina border border-cocina-linea bg-cocina-superficie shadow-cocina">
                {fichas.map((f) => (
                  <button
                    key={f.id} type="button"
                    onClick={() => {
                      onCambia({ fichaId: f.id, unidad: f.unidad, queLlevaEnTexto: f.nombre })
                      setBusca(f.nombre); setAbierto(false)
                    }}
                    className="block w-full text-left px-3 py-2 text-[13px] text-cocina-tinta hover:bg-cocina-superficie-2"
                  >{f.nombre}</button>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-cocina-tinta-3">
            cantidad
            <input
              value={fila.cantidad}
              onChange={(e) => onCambia({ cantidad: e.target.value })}
              placeholder="1"
              disabled={bloqueada}
              className="w-20 h-9 px-2 text-right text-[13px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina outline-none focus:border-cocina-acento disabled:opacity-50"
            />
          </label>
        </div>
      )}

      {/* ── LA OFERTA, dentro de la fila y sin abrir nada encima ───────── */}
      {!bloqueada && iguales.length > 0 && (
        <div className="rounded-cocina border border-cocina-acento/40 bg-cocina-acento-bg px-3 py-2.5 flex flex-col gap-2">
          <div className="text-[12.5px] font-semibold text-cocina-acento-ink">
            {laOfertaDeLasIguales(iguales)}
          </div>
          <div className="flex flex-col gap-1">
            {iguales.map((i) => {
              const marcada = marcadas.includes(i.id)
              return (
                <button
                  key={i.id} type="button"
                  onClick={() => setMarcadas((xs) =>
                    xs.includes(i.id) ? xs.filter((x) => x !== i.id) : [...xs, i.id])}
                  className="flex items-center gap-2 text-left text-[12px] text-cocina-tinta"
                >
                  <span className={`shrink-0 w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center text-[9px] font-bold ${
                    marcada ? 'bg-cocina-acento border-cocina-acento text-white'
                            : 'border-cocina-linea text-transparent bg-cocina-superficie'}`}>✓</span>
                  <span className="truncate">{dondeViveLaIgual(i)}</span>
                </button>
              )
            })}
          </div>
          {/* Las que no se tocan, DICHAS (regla 7): sin esto la pantalla diría
              «son 5» cuando son 12. */}
          {lasQueQuedanFuera(fuera) && (
            <div className="text-[11px] text-cocina-tinta-3">{lasQueQuedanFuera(fuera)}</div>
          )}
          <div>
            <BotonCocina peso="borde" disabled={aplicando} onClick={() => void resolverLasIguales()}>
              {aplicando ? 'Resolviendo…' : textoDelBotonDeLasIguales(marcadas.length)}
            </BotonCocina>
          </div>
        </div>
      )}

      <div className="text-[11.5px] text-cocina-tinta-3">
        {lineaDelExtra(fila, editando)}
        {fila.enCuantasPreguntas > 1 && (
          <span className="ml-1.5">
            <PastillaCocina tono="apagado">
              cambiarlo aquí no lo cambia en las otras {fila.enCuantasPreguntas - 1}
            </PastillaCocina>
          </span>
        )}
      </div>
    </div>
  )
}
