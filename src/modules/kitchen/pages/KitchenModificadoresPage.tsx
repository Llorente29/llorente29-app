// src/modules/kitchen/pages/KitchenModificadoresPage.tsx
//
// TABLERO 1 de la fase C: LA LISTA DE PREGUNTAS (encargo del 11/09, §2).
//
// QUÉ RESUELVE: hoy una pregunta sólo se puede ver y crear desde DENTRO de un
// plato. Para saber en cuántos platos está «Escoge una salsa para tu pita», o
// si existe cuatro veces copiada, hay que abrir los platos uno a uno. Aquí se
// ve de una vez, por marca, con lo que le pasa a cada una.
//
// EL DISEÑO ES EL DE LA MAQUETA, no el de la app de hoy. Todo dentro de
// `.cocina`, piezas de `PatronDeKitchen`, rejilla de `rejillasDeCocina` — la
// misma constante que usa su captura, para que no haya dos copias que puedan
// divergir (regla 38).
//
// NADA DE JERGA: ni grupo, ni modificador, ni impacto, ni bundle, ni confirmed.
// El castellano entero vive en `lib/preguntasDeCocina.ts` y está probado allí
// con filas reales.
//
// ── LO QUE ESTA PANTALLA NO PINTA, Y POR QUÉ (regla 35) ────────────────────
//
// · «+ Crear pregunta» lleva al tablero 5, que llega en este mismo paquete
//   pero todavía no está. Un botón sin destino no se pinta; llega con él.
// · «Ver lo que no cuadra» lleva al tablero 7, que es del paquete 3. Julio ya
//   lo dijo el 12/09: «hasta que exista el tablero 7, la franja se pinta sin el
//   botón». La franja sí va: la cifra que enmarca la pantalla no espera.
// · La franja NO lleva porcentaje. De 1.378 líneas de extra vendidas, 859
//   tienen decidido qué llevan y sólo 281 descuentan; los 578 de diferencia
//   pueden ser el corte, un precio indefendible o un extra que SUSTITUYE en vez
//   de sumar. Un «20 %» que no distingue eso inventa una avería, y eso es lo
//   que prohíbe el §5.
// · «N vendidas antes de llegar» está en la maqueta y no se puede definir sin
//   inventársela. No viaja en la RPC y no se pinta.
//
// ── Y LO QUE SÍ PINTA AUNQUE INCOMODE ──────────────────────────────────────
//
// Las 65, no las 56. Las apagadas se etiquetan y bajan; no se filtran. Y las
// que no están en ningún plato activo van en su propia sección, con su motivo,
// en vez de desaparecer: son 15 con 45 opciones, y hoy no las ve nadie.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  CabeceraCocina, CifrasCocina, CifraCocina, PastillaCocina,
  ChipCocina, PanelCocina, RotuloDePanel, FranjaCocina, BotonCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { REJILLA_PREGUNTAS } from '@/modules/kitchen/lib/rejillasDeCocina'
import { getPreguntas, type LasPreguntas } from '@/modules/kitchen/services/preguntasService'
import {
  quePuedeHacerElCliente, queHaceEnElPlato, opcionesEnTexto, platosEnTexto,
  platosPreocupa, pastillas, cuantasActivas, ordena,
  tituloDeLaFranja, detalleDeLaFranja, repartoDeLaFranja, tituloSinPlato, lineaSinPlato,
  subtituloDeMarca, chipDeMasMarcas, elPieDeLaLista, MARCAS_A_LA_VISTA,
  type Pregunta, type TonoDePastilla,
} from '@/modules/kitchen/lib/preguntasDeCocina'

const TONO: Record<TonoDePastilla, 'rojo' | 'ambar' | 'apagado'> = {
  malo: 'rojo', aviso: 'ambar', apagado: 'apagado',
}

function Fila({ p, sinRaya }: { p: Pregunta; sinRaya?: boolean }) {
  const chapas = pastillas(p)
  return (
    <div
      className={`grid items-center gap-3.5 px-4 py-2.5 min-h-[56px] ${sinRaya ? '' : 'border-b border-cocina-linea-suave last:border-b-0'} ${p.activa ? '' : 'opacity-60'}`}
      style={{ gridTemplateColumns: REJILLA_PREGUNTAS }}
    >
      <div className="min-w-0">
        {/* SIN `truncate`. La maqueta parte el nombre en dos líneas y la fila
            crece; cortar «¿Quieres acompañar con unas pata…» deja al lector sin
            saber cuál de las dos preguntas parecidas está mirando. */}
        <div className="font-semibold text-[13.5px] text-cocina-tinta">{p.nombre}</div>
        <div className="text-[12px] text-cocina-tinta-3 mt-0.5">{queHaceEnElPlato(p)}</div>
      </div>
      <div className="text-[13px] text-cocina-tinta-2">{quePuedeHacerElCliente(p)}</div>
      <div className="text-[13px] text-cocina-tinta-2 num">{opcionesEnTexto(p)}</div>
      <div className={`text-[13px] num ${platosPreocupa(p) ? 'text-cocina-rojo font-bold' : 'text-cocina-tinta'}`}>
        {platosEnTexto(p)}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {chapas.length === 0
          ? <span className="text-[12px] text-cocina-tinta-3">—</span>
          : chapas.map((c) => (
              <PastillaCocina key={c.texto} tono={TONO[c.tono]}>{c.texto}</PastillaCocina>
            ))}
      </div>
      {/* AQUÍ NO HAY BOTÓN TODAVÍA, y la columna se queda vacía a propósito.
          Pintarlo en gris en las 65 filas le dice a quien la abra «esto está
          roto» (Julio, 12:10). La regla 35 es no prometer un botón sin
          destino: cuando existan los tableros 2, 4 y 5, aparece. Mientras
          tanto lo dice el pie, con palabras. */}
      <div className="text-right" />
    </div>
  )
}

/** La lupa de la maqueta: 15 px, trazo 1.8, en el gris de los apagados. */
function Lupa() {
  return (
    <svg viewBox="0 0 24 24" className="w-[15px] h-[15px] shrink-0 stroke-cocina-tinta-3 fill-none" strokeWidth={1.8}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  )
}

function Cabecera() {
  return (
    <div
      className="grid gap-3.5 px-4 py-2 text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 border-b border-cocina-linea-suave bg-cocina-superficie-2"
      style={{ gridTemplateColumns: REJILLA_PREGUNTAS }}
    >
      <span>Pregunta</span>
      <span>Qué puede hacer el cliente</span>
      <span>Opciones</span>
      <span>En platos</span>
      <span>Qué le pasa</span>
      <span />
    </div>
  )
}

export default function KitchenModificadoresPage() {
  const { activeAccountId } = useActiveAccount()
  const navigate = useNavigate()
  const [datos, setDatos] = useState<LasPreguntas | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marca, setMarca] = useState<string>('')   // '' = todas
  const [busca, setBusca] = useState('')
  const [todasLasMarcas, setTodasLasMarcas] = useState(false)

  useEffect(() => {
    if (!activeAccountId) return
    let vigente = true
    void (async () => {
      // El «cargando» se enciende DENTRO, no en el cuerpo del efecto: en el
      // cuerpo es un setState síncrono que encadena renders y el lint lo para.
      setCargando(true)
      try {
        const d = await getPreguntas(activeAccountId, 30)
        // La respuesta caduca si mientras tanto se ha cambiado de cuenta
        // (regla 9 en el navegador): pintarla sería enseñar datos de otro.
        if (!vigente || d.cuentaPedida !== activeAccountId) return
        setDatos(d); setError(null)
      } catch (e) {
        if (!vigente) return
        setDatos(null)
        setError(e instanceof Error ? e.message : 'No se han podido leer las preguntas')
      } finally {
        if (vigente) setCargando(false)
      }
    })()
    return () => { vigente = false }
  }, [activeAccountId])

  const marcasVisibles = useMemo(() => {
    if (!datos) return []
    const q = busca.trim().toLowerCase()
    return datos.marcas
      .filter((m) => marca === '' || m.id === marca)
      .map((m) => ({
        ...m,
        preguntas: ordena(q === '' ? m.preguntas : m.preguntas.filter((p) => p.nombre.toLowerCase().includes(q))),
      }))
      .filter((m) => m.preguntas.length > 0)
  }, [datos, marca, busca])

  const activas = datos ? cuantasActivas(datos.marcas, datos.sinPlato.filas) : 0

  // Los chips a la vista. La marca elegida SIEMPRE se ve, aunque esté fuera
  // del tope: un filtro puesto cuyo chip no se ve es un filtro invisible.
  const chips = useMemo(() => {
    if (!datos) return []
    if (todasLasMarcas) return datos.marcas
    const cabeza = datos.marcas.slice(0, MARCAS_A_LA_VISTA)
    if (marca === '' || cabeza.some((m) => m.id === marca)) return cabeza
    const elegida = datos.marcas.find((m) => m.id === marca)
    return elegida ? [...cabeza, elegida] : cabeza
  }, [datos, todasLasMarcas, marca])

  // Lo que de verdad se pinta en la segunda sección. La cabecera cuenta ESTO,
  // no el resumen de la RPC: si algún día dejaran de coincidir, la cabecera
  // estaría contando filas que no están debajo (regla 38).
  const sinPlato = datos ? ordena(datos.sinPlato.filas) : []
  const opcionesSinPlato = sinPlato.reduce((a, p) => a + p.opciones, 0)   // activas

  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Kitchen · Modificadores"
          pregunta="¿Qué puede elegir, añadir o quitar el cliente en cada plato?"
          regla={
            <>
              Una pregunta es lo que se le pregunta al cliente en un plato («¿Con patatas?»,
              «Elige tu salsa»). Sus opciones son las respuestas, con su precio y lo que
              llevan. Una misma pregunta se pone en todos los platos donde toca.
            </>
          }
        >
          {/* YA TIENE DESTINO (13/09). El 12/09 este boton no se pintaba porque
              el tablero 5 no existia y un boton sin destino no se pinta (regla
              35). Ahora existe, y con el el tablero 3 detras. */}
          <BotonCocina peso="relleno" onClick={() => navigate('/kitchen/preguntas/nueva')}>
            + Crear una pregunta
          </BotonCocina>
        </CabeceraCocina>

        {/* EL CARTEL DE VACÍO NO CONVIVE CON LA LISTA. Esto se pintaba suelto,
            al lado del contenido, y la pantalla decía «la consulta no ha
            devuelto ninguna fila» con las 65 preguntas justo debajo. Ahora va
            en la misma forma que las otras cuatro pantallas —o el estado, o el
            contenido, nunca los dos— y además `hayFilas` se lo dice. */}
        {(cargando || error || !datos) ? (
          <EstadoDeLaConsulta
            cargando={cargando}
            textoCargando="Leyendo las preguntas de la cuenta…"
            error={error}
            hayFilas={!!datos}
            queSePregunto="las preguntas de esta cuenta"
          />
        ) : (
          <>
            <FranjaCocina
              tono="malo"
              titulo={tituloDeLaFranja(datos.franja, datos.ventana)}
              detalle={
                <>
                  {detalleDeLaFranja(datos.franja)}
                  {' '}
                  <span className="text-cocina-tinta-3">{repartoDeLaFranja(datos.franja)}</span>
                </>
              }
            />

            <CifrasCocina>
              <CifraCocina
                titulo="Preguntas"
                valor={String(datos.cifras.preguntas)}
                pie={`${activas} activas · ${datos.cifras.opcionesActivas} opciones que se venden`}
              />
              <CifraCocina
                titulo="Platos con alguna pregunta"
                valor={String(datos.cifras.platosConPregunta)}
                sufijo={`de ${datos.cifras.platosActivos}`}
                pie="platos activos de todas las marcas"
              />
              <CifraCocina
                titulo="Repetidas"
                valor={String(datos.cifras.repetidasPreguntas)}
                tono={datos.cifras.repetidasPreguntas > 0 ? 'aviso' : undefined}
                pie={`${datos.cifras.repetidasNombres} nombres que se repiten dentro de su marca`}
              />
              {/* La maqueta llama a esta cifra «Extras copiados» y le pone
                  encima el número de OPCIONES. No cuadra: la cabecera tiene que
                  ir sobre su propio número (regla 38). Y cuenta sólo extras
                  detrás de opciones ACTIVAS: el impacto de una opción retirada
                  no descuenta nada de nadie. */}
              <CifraCocina
                titulo="Extras distintos"
                valor={String(datos.cifras.extrasDistintos)}
                tono="aviso"
                pie={`detrás de las ${datos.cifras.opcionesDecididasActivas} opciones que ya lo tienen decidido`}
              />
              {/* LA CIFRA QUE MANDA EL TRABAJO cuenta lo que se puede vender
                  hoy. Contaba retiradas dentro, y eso manda a decidir cosas que
                  no existen. El total va de contexto, nunca de objetivo. */}
              <CifraCocina
                titulo="Opciones sin decidir qué llevan"
                valor={String(datos.cifras.opcionesSinDecidirActivas)}
                sufijo={`de ${datos.cifras.opcionesActivas}`}
                tono={datos.cifras.opcionesSinDecidirActivas > 0 ? 'malo' : undefined}
                pie={`${datos.cifras.opcionesSinDecidirCobranActivas} cobran y en Folvy no cuestan nada · ${datos.cifras.opciones} opciones entre todas, ${datos.cifras.opciones - datos.cifras.opcionesActivas} retiradas`}
              />
            </CifrasCocina>

            <div className="flex justify-between items-center gap-3">
              <div className="flex gap-1.5 flex-wrap">
                <ChipCocina activo={marca === ''} onClick={() => setMarca('')}>Todas las marcas</ChipCocina>
                {chips.map((m) => (
                  <ChipCocina key={m.id} activo={marca === m.id} onClick={() => setMarca(m.id)}>
                    {m.nombre}
                  </ChipCocina>
                ))}
                {/* El chip de más no filtra: abre el resto aquí mismo. */}
                {!todasLasMarcas && datos.marcas.length > chips.length && (
                  <ChipCocina onClick={() => setTodasLasMarcas(true)}>
                    {chipDeMasMarcas(datos.marcas.length - chips.length)}
                  </ChipCocina>
                )}
              </div>
              {/* «Buscar pregunta», no «Buscar pregunta u opción» como la
                  maqueta: los nombres de las opciones no viajan en la RPC y la
                  caja no puede buscarlos. Prometerlo haría que quien no
                  encuentre una opción concluya que no existe. */}
              <div className="flex items-center gap-2 h-[34px] w-[280px] px-[11px] border border-cocina-linea bg-cocina-superficie rounded-cocina">
                <Lupa />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar pregunta"
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px] text-cocina-tinta placeholder:text-cocina-tinta-3"
                />
              </div>
            </div>

            <PanelCocina>
              {/* La base viaja con la cifra (Julio, 11:52) pero sin decir
                  «Preguntas · 65 preguntas»: la palabra ya está en el rótulo. */}
              <RotuloDePanel derecha="Primero las que piden algo">
                {`Preguntas · ${datos.cifras.preguntas} en total · ${activas} activas`}
              </RotuloDePanel>
              <Cabecera />
              {marcasVisibles.map((m) => (
                <div key={m.id}>
                  <div className="flex items-baseline gap-2.5 px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2">
                    <span className="text-[14px] font-bold text-cocina-tinta">{m.nombre}</span>
                    <span className="text-[12px] text-cocina-tinta-3">
                      {subtituloDeMarca(m.cedida)}
                    </span>
                  </div>
                  {m.preguntas.map((p) => <Fila key={p.id} p={p} />)}
                </div>
              ))}
              {marcasVisibles.length === 0 && (
                <div className="px-4 py-6 text-[13px] text-cocina-tinta-3">
                  Ninguna pregunta cuadra con lo que has buscado. Las {datos.cifras.preguntas} siguen ahí.
                </div>
              )}
            </PanelCocina>

            {sinPlato.length > 0 && (
              <PanelCocina>
                <RotuloDePanel derecha="Su plato se retiró">
                  {tituloSinPlato(sinPlato.length, opcionesSinPlato)}
                </RotuloDePanel>
                <Cabecera />
                {/* La raya va en el envoltorio, no en la fila: si la pusiera la
                    fila, la línea de la marca caería DEBAJO de la raya y se
                    leería como si fuera de la pregunta siguiente. */}
                {sinPlato.map((p) => (
                  <div key={p.id} className="border-b border-cocina-linea-suave last:border-b-0">
                    <Fila p={p} sinRaya />
                    <div className="px-4 pb-2.5 -mt-1.5 text-[11.5px] text-cocina-tinta-3">{lineaSinPlato(p)}</div>
                  </div>
                ))}
              </PanelCocina>
            )}

            <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">{elPieDeLaLista()}</p>
          </>
        )}
      </div>
    </div>
  )
}
