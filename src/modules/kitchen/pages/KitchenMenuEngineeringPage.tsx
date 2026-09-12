// src/modules/kitchen/pages/KitchenMenuEngineeringPage.tsx
//
// «¿Qué platos vender más y cuáles quitar?» — Ingeniería de menús.
//
// B79 · lote 3 (06/09/2026). Reescrita entera sobre la maqueta aprobada, con el
// mismo patrón que Rentabilidad: pregunta, línea de regla, cinco cifras, un
// filtro que es la acción, filas con motivo y botón, y nada más.
//
// LO QUE HABÍA ANTES: «No hay platos con coste y ventas en este periodo y canal»
// sobre una marca con 21 platos vendiéndose. La causa era la RPC (B79), no la
// pantalla — pero el cartel también salía cuando la carga fallaba, y eso sí era
// de aquí.
//
// LA MATRIZ, Y POR QUÉ ESTA Y NO OTRA. Cada plato se compara con la media de la
// marca en dos ejes: cuánto se vende y cuánto deja. Los umbrales son la MEDIA
// SIMPLE (cada plato cuenta uno), que es el método clásico y el que hace que la
// comparación sea entre platos y no entre volúmenes.
//
// LAS BEBIDAS VAN APARTE, y no es cosmética: con las 6 latas dentro la media baja
// de 7,98 € a 6,48 € y una pita de 7,72 € pasa a contarse como lastre. Una lata
// no compite con una pita por el sitio en la carta. El criterio es la categoría
// de la CARTA (`menu_category.name`), comprobado contra la base — por
// `recipe_item.category` no se puede, está vacía en las 33 fichas.
//
// NINGÚN BOTÓN SIN DESTINO (regla de Julio, 06/09). «Mantener» no existe: no
// decidir es el estado por defecto, no una acción. «Quitar de la carta» lleva a
// la pestaña «En carta», que ya permite retirarlo.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import { getMenuItemEconomics, listMetaDeCarta } from '@/modules/kitchen/services/menuItemService'
import { getMenuItemUnitsSold } from '@/modules/kitchen/services/menuEngineeringService'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  calculaFila, construyeMatriz, elMargenEsDeLaCasa, esBebida, frasePorCuadrante, parteLaFrase,
  EXPLICACION_CUADRANTE, MARGEN_DE_MARCA_CEDIDA, ROTULO_CUADRANTE,
  type Cuadrante, type FilaDeCarta,
} from '@/modules/kitchen/lib/cartaYMargen'
import {
  guardaMarcaRecordada, guardaPeriodoRecordado, leePeriodoRecordado, marcaConLaQueAbrir,
} from '@/modules/kitchen/lib/recuerdoDeKitchen'
import {
  CabeceraCocina, CabeceraDeBloque, CampoCocina, CifrasCocina, CifraCocina,
  BotonCocina, ChipCocina, InterruptorCocina, PanelCocina, RotuloDePanel,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { useApp } from '@/context/AppContext'
import { intervaloDeFechas } from '@/modules/ventas/services/textoInforme'
import { REJILLA_INGENIERIA, REJILLA_INGENIERIA_ESTRELLAS } from '@/modules/kitchen/lib/rejillasDeCocina'
import { fmtMoney } from '@/lib/format'
import type { Brand } from '@/types/multitenancy'

type Dias = 30 | 90 | 365
/** El orden en que se enseñan: primero lo que pide una decisión. */
// DOS ÓRDENES, y no es un descuido: son dos preguntas distintas (B83, §3.17.5).
//
// LAS CIFRAS se leen como un retrato de la carta y empiezan por lo bueno —«4
// estrellas»—, que es como lo pinta el tablero. LAS SECCIONES se leen como una
// lista de trabajo y empiezan por lo que pide una decisión; las estrellas van al
// final porque no hay nada que hacer con ellas.
//
// Compartían una sola constante y por eso las cifras abrían por «Caballos»: la
// pantalla saludaba con el problema en vez de con la foto.
// LA REJILLA DE LA MAQUETA, y el cambio importa: yo tenía el nombre elástico y
// la frase DEBAJO, con el nombre recortado por la mitad. La maqueta da al nombre
// 250 px fijos —que caben dos líneas sin recortar nada— y pone la frase en su
// propia columna, a la derecha de los números. Así la columna de margen queda
// pegada a la de unidades y se leen las dos de un vistazo, que es la pregunta de
// esta pantalla: cuánto se vende y cuánto deja.

/** El número sin el símbolo: `CifraCocina` lo pone aparte, en pequeño. */
const eurSinSimbolo = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ORDEN_DE_LAS_CIFRAS: Cuadrante[] = ['estrella', 'caballo', 'joya', 'lastre']
const ORDEN_DE_LAS_SECCIONES: Cuadrante[] = ['caballo', 'joya', 'lastre', 'estrella']

export default function KitchenMenuEngineeringPage() {
  const { activeAccountId } = useActiveAccount()
  const { activeAccount } = useApp()
  const nombreDeLaCuenta = activeAccount?.name ?? null
  const navigate = useNavigate()

  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [dias, setDias] = useState<Dias>(leePeriodoRecordado('ingenieria', 90) as Dias)
  const [verBebidas, setVerBebidas] = useState(false)
  const [soloDecision, setSoloDecision] = useState(true)

  const [filas, setFilas] = useState<FilaDeCarta[]>([])
  const [recetaPorItem, setRecetaPorItem] = useState<Map<string, string | null>>(new Map())
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const marca = useMemo(() => brands.find((b) => b.id === brandId) ?? null, [brands, brandId])

  useEffect(() => {
    if (!activeAccountId) return
    let muerto = false
    listBrands({ accountId: activeAccountId })
      .then((bs) => {
        if (muerto) return
        const vivas = bs.filter((b) => b.isActive)
        setBrands(vivas)
        setBrandId(marcaConLaQueAbrir(vivas)?.id ?? null)
      })
      .catch((e: unknown) => { if (!muerto) setError(e instanceof Error ? e.message : 'Error cargando las marcas') })
    return () => { muerto = true }
  }, [activeAccountId])

  const peticion = useRef(0)
  useEffect(() => {
    if (!activeAccountId || !brandId) return
    const mia = ++peticion.current
    const hasta = new Date()
    const desde = new Date(hasta.getTime() - dias * 24 * 3600 * 1000)
    Promise.resolve().then(() => {
      if (mia !== peticion.current) return
      setCargando(true); setError(null)
    })
    Promise.all([
      getMenuItemEconomics(brandId),
      getMenuItemUnitsSold(brandId, desde.toISOString(), hasta.toISOString()),
      listMetaDeCarta(activeAccountId, brandId),
    ])
      .then(([eco, ventas, meta]) => {
        if (mia !== peticion.current) return
        const uds = new Map(ventas.map((v) => [v.menuItemId, v.unitsSold]))
        const m = new Map(meta.map((x) => [x.id, x]))
        setRecetaPorItem(new Map(eco.map((e) => [e.menuItemId, e.recipeItemId])))
        setFilas(eco.map((e) => calculaFila({
          id: e.menuItemId,
          nombre: e.menuItemName,
          tipo: m.get(e.menuItemId)?.productType ?? null,
          categoria: m.get(e.menuItemId)?.categoriaCarta ?? null,
          precio: e.price,
          ivaPct: e.vatRate,
          coste: e.costAvailable ? e.cost : null,
          uds: uds.get(e.menuItemId) ?? 0,
        })))
        setCargando(false)
      })
      .catch((e: unknown) => {
        if (mia !== peticion.current) return
        setError(e instanceof Error ? e.message : 'Error cargando la ingeniería de menús')
        setFilas([])
        setCargando(false)
      })
  }, [activeAccountId, brandId, dias])

  // En una marca de TERCEROS no hay matriz posible: el eje «cuánto deja» sería el
  // PVP de carta menos el coste, y eso no es lo que cobra Foodint. Una matriz
  // sobre un margen que no es tuyo colocaría platos en cuadrantes equivocados y
  // te haría subir el precio de algo que no cobras. Se dice y no se pinta.
  const margenPropio = elMargenEsDeLaCasa(marca?.ownershipType)

  // La matriz de PLATOS es la que manda: las bebidas se comparan entre ellas, en
  // su pestaña, con su propia media. Nunca las dos juntas (ver cabecera).
  const matrizPlatos = useMemo(() => construyeMatriz(filas), [filas])
  const matrizBebidas = useMemo(
    () => construyeMatriz(filas.filter((f) => esBebida(f.categoria)).map((f) => ({ ...f, categoria: null }))),
    [filas],
  )
  const matriz = verBebidas ? matrizBebidas : matrizPlatos

  const porCuadrante = useMemo(() => {
    const g: Record<Cuadrante, FilaDeCarta[]> = { estrella: [], caballo: [], joya: [], lastre: [] }
    for (const f of matriz.platos) {
      const c = matriz.cuadranteDe.get(f.id)
      if (c) g[c].push(f)
    }
    for (const c of ORDEN_DE_LAS_SECCIONES) g[c].sort((a, b) => b.uds - a.uds)
    return g
  }, [matriz])

  const abrir = (menuItemId: string, tab: 'escandallo' | 'en_carta' | 'economia') => {
    const receta = recetaPorItem.get(menuItemId) ?? null
    if (receta) navigate(`/kitchen/recetas?recipe=${receta}&tab=${tab}`)
    else navigate(`/kitchen/menu?producto=${menuItemId}`)
  }

  const hasta = new Date()
  const desde = new Date(hasta.getTime() - dias * 24 * 3600 * 1000)
  // Los tres que piden una decisión van en UN panel, con una cabecera de bloque
  // por cuadrante: son la lista de trabajo y se lee de arriba abajo del tirón.
  // Las estrellas van en SU panel, y con un rótulo en vez de una cabecera de
  // bloque: no son trabajo, son la parte de la carta que está bien.
  const LOS_QUE_PIDEN_DECISION: Cuadrante[] = ['caballo', 'joya', 'lastre']
  const bloquesConFilas = LOS_QUE_PIDEN_DECISION.filter((c) => porCuadrante[c].length > 0)
  const estrellas = soloDecision ? [] : porCuadrante.estrella

  const pintaFila = (f: FilaDeCarta, c: Cuadrante, compacta = false) => {
    const { frase, destacado, botones } = frasePorCuadrante(f, c, matriz.mediaSimpleDeMargen ?? 0)
    const [antes, fuerte, despues] = parteLaFrase(frase, destacado)
    return (
      <div key={f.id}
        className={`grid items-center gap-3.5 px-4 border-b border-cocina-linea-suave last:border-b-0 ${
          compacta ? 'py-[5px] min-h-[40px]' : 'py-[7px] min-h-[48px]'}`}
        style={{ gridTemplateColumns: compacta ? REJILLA_INGENIERIA_ESTRELLAS : REJILLA_INGENIERIA }}>
        {/* 500, no 600: en la maqueta el peso fuerte es del margen, que es la
            columna por la que se decide. Un nombre en negrita se lo robaba. */}
        <div className="text-[13.5px] font-medium text-cocina-tinta">{f.nombre}</div>
        <span className="num text-[13px] text-right text-cocina-tinta whitespace-nowrap">
          {f.uds} <span className="text-[11px] text-cocina-tinta-3">uds</span>
        </span>
        <span className="num text-[13px] text-right font-bold text-cocina-tinta">
          {fmtMoney(f.margen)}
        </span>
        {/* El número por el que se decide, en negrita: los 68 € que ganarías, o
            el margen del que deja de lo mejor de la carta. */}
        <div className="text-[12.5px] text-cocina-tinta-2 leading-[1.4]">
          {antes}<b className="font-semibold text-cocina-tinta">{fuerte}</b>{despues}
        </div>
        <span className="flex gap-2 justify-end">
          {botones.map((b, i) => (
            // El primero con borde y el resto en fantasma, y sólo cuando hay más
            // de uno: un botón solo —«Abrir» de una estrella— no es la acción
            // principal de nada, así que no se pinta como si lo fuera.
            <BotonCocina key={b.texto} peso={i === 0 && botones.length > 1 ? 'borde' : 'fantasma'}
              onClick={() => abrir(f.id, b.destino)}>
              {b.texto}
            </BotonCocina>
          ))}
        </span>
      </div>
    )
  }

  return (
    // B83 · al estándar de la maqueta (§9.2 de Extras). Tablero:
    // `Ingenieria.dc.html`. Esta era la única de las tres que NO usaba ninguna
    // pieza del patrón —tenía su propio marcado, deuda declarada en el §3.13—,
    // así que aquí es reescritura, no cambio de piezas.
    //
    // SIN SELECTOR DE LOCAL: `menu_item_units_sold(p_brand_id, p_from, p_to)` no
    // lo acepta (medido en la base). Un control que no filtra es peor que su
    // ausencia.
    <div className="cocina min-h-full">
      <div className="cocina-pagina">

        <CabeceraCocina
          migaja={`Folvy Kitchen${nombreDeLaCuenta ? ` · ${nombreDeLaCuenta}` : ''}`}
          pregunta="¿Qué platos vender más y cuáles quitar?"
          regla={
            <>
              Cada plato se compara con la media de la marca en dos cosas:{' '}
              <b className="font-semibold text-cocina-tinta">cuánto se vende</b> y{' '}
              <b className="font-semibold text-cocina-tinta">cuánto deja</b> (precio sin IVA − coste) ·{' '}
              <em className="not-italic text-cocina-tinta-3">
                {intervaloDeFechas(desde, hasta, { minuscula: true }) ?? 'en el periodo elegido'}, todos los canales
              </em>.{' '}
              <span className="text-cocina-tinta-3">
                {!margenPropio
                  ? MARGEN_DE_MARCA_CEDIDA
                  : verBebidas
                    ? 'Las bebidas se comparan entre ellas, no con los platos.'
                    : `Entran los ${matrizPlatos.platos.length} platos con coste y ventas; las bebidas van aparte.`}
              </span>
            </>
          }
        >
          <CampoCocina label="Marca">
            <select
              value={brandId ?? ''}
              onChange={(e) => { setBrandId(e.target.value); guardaMarcaRecordada(e.target.value) }}
              className="text-[13px] font-medium text-cocina-tinta"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.ownershipType === 'licensed' ? ' · de terceros' : ''}
                </option>
              ))}
            </select>
          </CampoCocina>
          <CampoCocina label="Periodo">
            <select
              value={String(dias)}
              onChange={(e) => { const d = Number(e.target.value) as Dias; setDias(d); guardaPeriodoRecordado('ingenieria', d) }}
              className="text-[13px] font-medium text-cocina-tinta"
            >
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="365">Último año</option>
            </select>
          </CampoCocina>
        </CabeceraCocina>

        {/* 2 · CINCO CIFRAS: los cuatro cuadrantes y la media que los separa. */}
        <CifrasCocina>
          {ORDEN_DE_LAS_CIFRAS.map((c) => (
            <CifraCocina
              key={c}
              titulo={ROTULO_CUADRANTE[c]}
              valor={String(matriz.conteo[c])}
              pie={EXPLICACION_CUADRANTE[c]}
              // Sólo los lastres se pintan en rojo: son los únicos que están mal
              // en las dos cosas. Un caballo o una joya no son un problema, son
              // una decisión.
              tono={c === 'lastre' && matriz.conteo[c] > 0 ? 'malo'
                : c === 'estrella' && matriz.conteo[c] > 0 ? 'bueno' : undefined}
            />
          ))}
          <CifraCocina
            titulo={`La media de ${verBebidas ? 'las' : 'los'} ${matriz.platos.length} ${verBebidas ? 'bebidas' : 'platos'}`}
            valor={eurSinSimbolo(matriz.mediaSimpleDeMargen)}
            sufijo="€"
            pie={`cada ${verBebidas ? 'bebida' : 'plato'} cuenta uno, se venda lo que se venda · y ${
              matriz.mediaSimpleDeUnidades == null ? '—' : Math.round(matriz.mediaSimpleDeUnidades)} vendidos`}
          />
        </CifrasCocina>

        {/* 3 · EL FILTRO ES LA ACCIÓN: abre en lo que pide una decisión. */}
        {/* Los dos MANDOS juntos a la izquierda y la nota a la derecha, como la
            maqueta: un interruptor separado de las pastillas por medio metro de
            pantalla no se lee como parte del mismo filtro. */}
        <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
          <div className="flex items-center gap-3.5 flex-wrap">
            <div className="flex gap-1.5">
              {([[false, 'Platos'], [true, 'Bebidas']] as const).map(([v, t]) => (
                <ChipCocina key={t} activo={verBebidas === v} onClick={() => setVerBebidas(v)}>{t}</ChipCocina>
              ))}
            </div>
            <InterruptorCocina activo={soloDecision} onChange={setSoloDecision}>
              Sólo los que piden una decisión
            </InterruptorCocina>
          </div>
          {soloDecision && (
            <span className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
              Caballos, joyas y lastres · las estrellas se quedan como están
            </span>
          )}
        </div>

        {!cargando && !error && marca && !margenPropio ? (
          // NO es «no hay platos»: es que la pregunta de esta pantalla no se
          // puede responder para una marca de terceros con la vara de hoy.
          <PanelCocina>
            <div className="px-4 py-4 flex flex-col gap-2">
              <p className="text-[13.5px] font-semibold text-cocina-tinta">
                {marca.name} es una marca de terceros: aquí no se puede ordenar por margen.
              </p>
              <p className="text-[12.5px] text-cocina-tinta-2 leading-[1.5] max-w-3xl">
                {MARGEN_DE_MARCA_CEDIDA} Comparar sus platos con un margen que no es el tuyo te haría
                subir el precio de algo que no cobras, así que no se dibuja la matriz.
              </p>
              <p className="text-[12.5px] text-cocina-tinta-2 leading-[1.5]">
                Lo que sí puedes ver de esta marca: el coste de cada plato y lo que se ha vendido.
              </p>
              <div className="mt-1">
                <BotonCocina peso="borde" onClick={() => navigate('/kitchen/rentabilidad')}>
                  Verlo en Rentabilidad
                </BotonCocina>
              </div>
            </div>
          </PanelCocina>
        ) : cargando || error || matriz.platos.length === 0 ? (
          <EstadoDeLaConsulta
            cargando={cargando}
            textoCargando="Cruzando coste real con ventas reales…"
            error={error}
            hayFilas={matriz.platos.length > 0}
            queSePregunto={marca
              ? `los ${verBebidas ? 'bebidas' : 'platos'} de ${marca.name} con coste y ventas en el periodo`
              : 'la ingeniería de menús'}
            matiz={marca
              ? 'Un plato entra aquí sólo si tiene escandallo Y ventas en el periodo. Si le falta una de las dos, está en Rentabilidad con su motivo.'
              : 'Elige una marca arriba.'}
          />
        ) : (
          <>
            {bloquesConFilas.length > 0 && (
              <PanelCocina>
                {bloquesConFilas.map((c) => (
                  <div key={c}>
                    <CabeceraDeBloque
                      nombre={`${ROTULO_CUADRANTE[c]} · ${porCuadrante[c].length}`}
                      detalle={
                        c === 'caballo' ? `se venden mucho pero dejan menos que la media (${fmtMoney(matriz.mediaSimpleDeMargen)})`
                          : c === 'joya' ? `dejan más que la media pero se venden menos de ${Math.round(matriz.mediaSimpleDeUnidades ?? 0)} en ${dias} días`
                            : 'por debajo de la media en las dos cosas'
                      }
                    />
                    {porCuadrante[c].map((f) => pintaFila(f, c))}
                  </div>
                ))}
              </PanelCocina>
            )}

            {estrellas.length > 0 && (
              <PanelCocina>
                <RotuloDePanel>
                  {ROTULO_CUADRANTE.estrella} · {estrellas.length} · se quedan como están
                </RotuloDePanel>
                {estrellas.map((f) => pintaFila(f, 'estrella', true))}
              </PanelCocina>
            )}

            {/* 5 · NADA MÁS: sólo lo que no entra y por qué, que es lo que evita
                   que alguien piense que faltan platos. */}
            <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
              {verBebidas
                ? 'Las bebidas se comparan entre ellas: una lata no compite con una pita por el sitio en la carta.'
                : `Las ${filas.filter((f) => esBebida(f.categoria)).length} bebidas se comparan entre ellas en su pestaña. ` +
                  `Los ${filas.filter((f) => f.margen == null).length} platos sin coste y los ${filas.filter((f) => f.margen != null && f.uds === 0 && !esBebida(f.categoria)).length} sin ventas en el periodo no entran: están en Rentabilidad con su motivo.`}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
