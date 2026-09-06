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
  calculaFila, construyeMatriz, elMargenEsDeLaCasa, esBebida, frasePorCuadrante,
  EXPLICACION_CUADRANTE, MARGEN_DE_MARCA_CEDIDA, ROTULO_CUADRANTE,
  type Cuadrante, type FilaDeCarta,
} from '@/modules/kitchen/lib/cartaYMargen'
import {
  guardaMarcaRecordada, guardaPeriodoRecordado, leePeriodoRecordado, marcaConLaQueAbrir,
} from '@/modules/kitchen/lib/recuerdoDeKitchen'
import { intervaloDeFechas } from '@/modules/ventas/services/textoInforme'
import { fmtMoney } from '@/lib/format'
import type { Brand } from '@/types/multitenancy'

type Dias = 30 | 90 | 365
/** El orden en que se enseñan: primero lo que pide una decisión. */
const ORDEN_CUADRANTES: Cuadrante[] = ['caballo', 'joya', 'lastre', 'estrella']

export default function KitchenMenuEngineeringPage() {
  const { activeAccountId } = useActiveAccount()
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
    for (const c of ORDEN_CUADRANTES) g[c].sort((a, b) => b.uds - a.uds)
    return g
  }, [matriz])

  const abrir = (menuItemId: string, tab: 'escandallo' | 'en_carta' | 'economia') => {
    const receta = recetaPorItem.get(menuItemId) ?? null
    if (receta) navigate(`/kitchen/recetas?recipe=${receta}&tab=${tab}`)
    else navigate(`/kitchen/menu?producto=${menuItemId}`)
  }

  const hasta = new Date()
  const desde = new Date(hasta.getTime() - dias * 24 * 3600 * 1000)
  const cuadrantesVisibles = soloDecision
    ? (['caballo', 'joya', 'lastre'] as Cuadrante[])
    : ORDEN_CUADRANTES

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">¿Qué platos vender más y cuáles quitar?</h1>
        <p className="mt-1.5 text-sm text-text-secondary max-w-4xl">
          Cada plato se compara con la media de la marca en dos cosas: <strong>cuánto se vende</strong> y{' '}
          <strong>cuánto deja</strong> (precio sin IVA − coste) ·{' '}
          {intervaloDeFechas(desde, hasta) ?? 'En el periodo elegido'}, todos los canales.{' '}
          <span className="text-text-tertiary">
            {!margenPropio
              ? MARGEN_DE_MARCA_CEDIDA
              : verBebidas
                ? 'Las bebidas se comparan entre ellas, no con los platos.'
                : `Entran los ${matrizPlatos.platos.length} platos con coste y ventas; las bebidas van aparte.`}
          </span>
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-text-secondary">Marca</span>
          <select value={brandId ?? ''}
            onChange={(e) => { setBrandId(e.target.value); guardaMarcaRecordada(e.target.value) }}
            className="px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary">
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.ownershipType === 'licensed' ? ' · de terceros' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-text-secondary">Periodo</span>
          <select value={String(dias)}
            onChange={(e) => { const d = Number(e.target.value) as Dias; setDias(d); guardaPeriodoRecordado('ingenieria', d) }}
            className="px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary">
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="365">Último año</option>
          </select>
        </label>
      </div>

      {/* 2 · CINCO CIFRAS: los cuatro cuadrantes y la media que los separa. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {ORDEN_CUADRANTES.map((c) => (
          <div key={c} className="bg-card border border-border-default rounded-lg p-3">
            <div className="text-[11px] text-text-secondary">{ROTULO_CUADRANTE[c]}</div>
            <div className="text-2xl font-semibold text-text-primary mt-0.5">{matriz.conteo[c]}</div>
            <div className="text-[11px] text-text-secondary mt-1 leading-snug">{EXPLICACION_CUADRANTE[c]}</div>
          </div>
        ))}
        <div className="bg-card border border-border-default rounded-lg p-3">
          <div className="text-[11px] text-text-secondary">
            La media de {matriz.platos.length} {verBebidas ? 'bebidas' : 'platos'}
          </div>
          <div className="text-2xl font-semibold text-text-primary mt-0.5">{fmtMoney(matriz.mediaSimpleDeMargen)}</div>
          <div className="text-[11px] text-text-secondary mt-1 leading-snug">
            cada uno cuenta uno, se venda lo que se venda · y{' '}
            {matriz.mediaSimpleDeUnidades == null ? '—' : Math.round(matriz.mediaSimpleDeUnidades)} vendidos
          </div>
        </div>
      </div>

      {/* 3 · EL FILTRO ES LA ACCIÓN: abre en lo que pide una decisión. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {([[false, 'Platos'], [true, 'Bebidas']] as const).map(([v, t]) => (
          <button key={t} type="button" onClick={() => setVerBebidas(v)}
            className={`px-3 py-1.5 rounded-md border transition-base ${
              verBebidas === v ? 'border-accent bg-accent text-white' : 'border-border-default text-text-secondary hover:bg-page'}`}>
            {t}
          </button>
        ))}
        <label className="inline-flex items-center gap-1.5 ml-2 text-text-secondary cursor-pointer">
          <input type="checkbox" checked={soloDecision} onChange={(e) => setSoloDecision(e.target.checked)} />
          Sólo los que piden una decisión
        </label>
        {soloDecision && (
          <span className="text-xs text-text-secondary">
            Caballos, joyas y lastres · las estrellas se quedan como están
          </span>
        )}
      </div>

      {!cargando && !error && marca && !margenPropio ? (
        // NO es «no hay platos»: es que la pregunta de esta pantalla no se puede
        // responder para una marca de terceros con la vara de hoy.
        <div className="bg-card border border-border-default rounded-xl p-6">
          <p className="text-sm text-text-primary font-medium">
            {marca.name} es una marca de terceros: aquí no se puede ordenar por margen.
          </p>
          <p className="text-xs text-text-secondary mt-2 max-w-3xl leading-relaxed">
            {MARGEN_DE_MARCA_CEDIDA} Comparar sus platos con un margen que no es el tuyo te haría
            subir el precio de algo que no cobras, así que no se dibuja la matriz.
          </p>
          <p className="text-xs text-text-secondary mt-2">
            Lo que sí puedes ver de esta marca: el coste de cada plato y lo que se ha vendido, en{' '}
            <button type="button" onClick={() => navigate('/kitchen/rentabilidad')}
              className="text-terracota underline underline-offset-2">Rentabilidad</button>.
          </p>
        </div>
      ) : cargando || error || matriz.platos.length === 0 ? (
        <EstadoDeLaConsulta
          cargando={cargando}
          textoCargando="Cruzando coste real con ventas reales…"
          error={error}
          queSePregunto={marca
            ? `los ${verBebidas ? 'bebidas' : 'platos'} de ${marca.name} con coste y ventas en el periodo`
            : 'la ingeniería de menús'}
          matiz={marca
            ? 'Un plato entra aquí sólo si tiene escandallo Y ventas en el periodo. Si le falta una de las dos, está en Rentabilidad con su motivo.'
            : 'Elige una marca arriba.'}
        />
      ) : (
        <>
          {cuadrantesVisibles.map((c) => porCuadrante[c].length > 0 && (
            <section key={c} className="space-y-2">
              <h2 className="text-sm font-medium text-text-primary">
                {ROTULO_CUADRANTE[c]} · {porCuadrante[c].length}
                <span className="ml-2 font-normal text-text-secondary">
                  {c === 'caballo' && `se venden mucho pero dejan menos que la media (${fmtMoney(matriz.mediaSimpleDeMargen)})`}
                  {c === 'joya' && `dejan más que la media pero se venden menos de ${Math.round(matriz.mediaSimpleDeUnidades ?? 0)} en ${dias} días`}
                  {c === 'lastre' && 'por debajo de la media en las dos cosas'}
                  {c === 'estrella' && 'se quedan como están'}
                </span>
              </h2>
              {porCuadrante[c].map((f) => {
                const { frase, botones } = frasePorCuadrante(f, c, matriz.mediaSimpleDeMargen ?? 0)
                return (
                  <div key={f.id} className="bg-card border border-border-default rounded-lg p-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-sm font-medium text-text-primary">{f.nombre}</span>
                      <span className="text-sm font-mono text-text-secondary">{f.uds} uds</span>
                      <span className="text-sm font-mono text-text-primary">{fmtMoney(f.margen)}</span>
                    </div>
                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">{frase}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {botones.map((b) => (
                        <button key={b.texto} type="button" onClick={() => abrir(f.id, b.destino)}
                          className="text-xs font-medium px-3 py-1.5 rounded-md border border-border-default text-terracota hover:bg-terracota-bg transition-base">
                          {b.texto}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </section>
          ))}

          {/* 5 · NADA MÁS: sólo lo que no entra y por qué, que es lo que evita
                 que alguien piense que faltan platos. */}
          <p className="text-xs text-text-secondary">
            {verBebidas
              ? 'Las bebidas se comparan entre ellas: una lata no compite con una pita por el sitio en la carta.'
              : `Las ${filas.filter((f) => esBebida(f.categoria)).length} bebidas se comparan entre ellas en su pestaña. ` +
                `Los ${filas.filter((f) => f.margen == null).length} sin coste y los ${filas.filter((f) => f.margen != null && f.uds === 0 && !esBebida(f.categoria)).length} sin ventas en el periodo no entran: están en Rentabilidad con su motivo.`}
          </p>
        </>
      )}
    </div>
  )
}
