// src/modules/kitchen/pages/KitchenProfitabilityPage.tsx
//
// «¿Qué platos te dejan más margen?» — Rentabilidad de carta.
//
// B79 · lote 2 (06/09/2026). Reescrita entera sobre la maqueta aprobada, con el
// patrón de Casado: una pregunta arriba, una línea de regla, cinco cifras con
// nombre humano, un filtro que es la acción, filas con motivo y botón, y nada más.
//
// LO QUE HABÍA ANTES, para que no se repita: esta pantalla decía «Esta marca no
// tiene platos en carta todavía» sobre marcas con 23 y 33 productos activos.
// `menu_item_economics` devolvía cero filas por un INNER JOIN contra
// `menu_item.channel_id`, vacío en toda la base (B79). Y el mismo cartel salía
// cuando la carga FALLABA. Las dos cosas están arregladas: el dato llega, y el
// estado vacío lo cuenta `EstadoDeLaConsulta`, que distingue error de vacío.
//
// LA PANTALLA NO CALCULA NI UN EURO. Todas las reglas —margen, medias, motivos de
// «sin coste», etiquetas— viven en `lib/cartaYMargen.ts`, probadas contra los 33
// productos reales de Meraki Pita. Aquí sólo se pinta y se ordena.
//
// DOS VARAS QUE NO SE MEZCLAN, y por eso la de aquí lleva su nombre completo:
// «Margen por unidad vendida» es PONDERADO por lo vendido y con las bebidas
// dentro (8,04 € en Meraki). Ingeniería usa otra —media simple, bebidas fuera,
// 7,98 €— porque responde otra pregunta. Ver la cabecera de `cartaYMargen.ts`.
//
// NINGÚN BOTÓN SIN DESTINO (regla de Julio, 06/09). Los tres destinos existen:
// `/kitchen/recetas?recipe=…&tab=…` para lo que tiene ficha, y
// `/kitchen/menu?producto=…` para los menús y los platos sin receta, que no
// tienen `recipe_item` al que apuntar.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import { getMenuItemEconomics, listMetaDeCarta } from '@/modules/kitchen/services/menuItemService'
import { getMenuItemUnitsSold } from '@/modules/kitchen/services/menuEngineeringService'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
// B79 lote 4: la cifra y el campo salen de aquí, iguales letra a letra que
// cuando vivían en este fichero. Lo fija `patronDeKitchen.test.tsx`.
import {
  CabeceraCocina, CampoCocina, CifrasCocina, CifraCocina,
  BotonCocina, ChipCocina, InterruptorCocina, PanelCocina, PastillaCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { eurDeCocina } from '@/modules/kitchen/lib/lasCosasQueArreglar'
import { useApp } from '@/context/AppContext'
import {
  calculaFila, cifrasDeRentabilidad, elMargenEsDeLaCasa, etiquetasDeFila,
  MARGEN_DE_MARCA_CEDIDA, motivoSinCoste,
  type FilaDeCarta,
} from '@/modules/kitchen/lib/cartaYMargen'
import { intervaloDeFechas } from '@/modules/ventas/services/textoInforme'
import {
  guardaMarcaRecordada, guardaPeriodoRecordado, leePeriodoRecordado, marcaConLaQueAbrir,
} from '@/modules/kitchen/lib/recuerdoDeKitchen'
import { fmtMoney, fmtPct } from '@/lib/format'
import type { Brand } from '@/types/multitenancy'

type Dias = 30 | 90 | 365
type Orden = 'margen' | 'vendido' | 'coste'

// Los formateadores del proyecto, que ya son null-safe: un coste ausente sale
// «—», nunca 0 (regla del módulo, y la lección de meez).
const eur = (v: number | null | undefined) => fmtMoney(v)
const pct = (v: number | null | undefined) => fmtPct(v, 1)

/** La carta: plato · precio · coste · margen · coste sobre precio · vendidos. */
const REJILLA_CARTA = 'minmax(0,1fr) 105px 80px 95px 110px 75px auto'
/** Los que no tienen coste: sin margen ni porcentaje, con su motivo y su botón. */
const REJILLA_SIN_COSTE = 'minmax(0,1fr) 120px 110px 90px auto'

/** El número sin el símbolo: `CifraCocina` lo pone aparte, en pequeño. */
const eurSinSimbolo = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function KitchenProfitabilityPage() {
  const { activeAccountId } = useActiveAccount()
  const { activeAccount } = useApp()
  const nombreDeLaCuenta = activeAccount?.name ?? null
  const navigate = useNavigate()

  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [dias, setDias] = useState<Dias>(leePeriodoRecordado('rentabilidad', 90) as Dias)
  const [orden, setOrden] = useState<Orden>('margen')
  const [soloSinCoste, setSoloSinCoste] = useState(false)

  const [filas, setFilas] = useState<FilaDeCarta[]>([])
  // `recipe_item_id` no cabe en `FilaDeCarta` —es de la carta, no del margen— pero
  // los botones lo necesitan para saber a dónde ir. Se guarda de la MISMA carga.
  const [recetaPorItem, setRecetaPorItem] = useState<Map<string, string | null>>(new Map())
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const marca = useMemo(() => brands.find((b) => b.id === brandId) ?? null, [brands, brandId])

  // ── Marcas. Abre en una TUYA, nunca en la primera por alfabeto (principio 7).
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

  // ── Los datos de la marca. Guarda de carrera: gana la que se PIDIÓ la última.
  const peticion = useRef(0)
  useEffect(() => {
    if (!activeAccountId || !brandId) return
    const mia = ++peticion.current
    const hasta = new Date()
    const desde = new Date(hasta.getTime() - dias * 24 * 3600 * 1000)
    // El estado se toca FUERA del cuerpo síncrono del efecto: tocarlo dentro
    // encadena renders (y el lint lo dice con razón). Mismo remedio que en
    // Informes: se salta un turno antes de escribir nada.
    Promise.resolve().then(() => {
      if (mia !== peticion.current) return
      setCargando(true)
      setError(null)
    })
    Promise.all([
      getMenuItemEconomics(brandId),
      getMenuItemUnitsSold(brandId, desde.toISOString(), hasta.toISOString()),
      listMetaDeCarta(activeAccountId, brandId),
    ])
      .then(([eco, ventas, meta]) => {
        if (mia !== peticion.current) return
        const udsPorItem = new Map(ventas.map((v) => [v.menuItemId, v.unitsSold]))
        const metaPorItem = new Map(meta.map((m) => [m.id, m]))
        setRecetaPorItem(new Map(eco.map((e) => [e.menuItemId, e.recipeItemId])))
        setFilas(eco.map((e) => calculaFila({
          id: e.menuItemId,
          nombre: e.menuItemName,
          tipo: metaPorItem.get(e.menuItemId)?.productType ?? null,
          categoria: metaPorItem.get(e.menuItemId)?.categoriaCarta ?? null,
          precio: e.price,
          ivaPct: e.vatRate,
          coste: e.costAvailable ? e.cost : null,
          uds: udsPorItem.get(e.menuItemId) ?? 0,
        })))
        setCargando(false)
      })
      .catch((e: unknown) => {
        if (mia !== peticion.current) return
        setError(e instanceof Error ? e.message : 'Error cargando la rentabilidad')
        setFilas([])
        setCargando(false)
      })
  }, [activeAccountId, brandId, dias])

  // En una marca de terceros el margen no es de Foodint: se enseña el coste y lo
  // vendido, y donde iría el margen va «—» con el motivo en la línea de regla.
  // Calcularlo igual sería inventar una cifra (ver `elMargenEsDeLaCasa`).
  const margenPropio = elMargenEsDeLaCasa(marca?.ownershipType)
  const filasParaContar = useMemo(
    () => (margenPropio ? filas : filas.map((f) => ({ ...f, margen: null, margenDelPeriodo: null }))),
    [filas, margenPropio],
  )
  const cifras = useMemo(() => cifrasDeRentabilidad(filasParaContar, dias), [filasParaContar, dias])

  const conCoste = useMemo(() => {
    // Con una cedida no hay margen que ordenar, pero los platos existen: se
    // listan por lo vendido para que la pantalla no se quede vacía.
    const c = margenPropio
      ? filas.filter((f) => f.margen != null)
      : filas.filter((f) => f.coste != null)
    const orden3 = {
      margen: (a: FilaDeCarta, b: FilaDeCarta) => (b.margen as number) - (a.margen as number),
      vendido: (a: FilaDeCarta, b: FilaDeCarta) => b.uds - a.uds,
      coste: (a: FilaDeCarta, b: FilaDeCarta) => (b.costeSobrePrecio ?? 0) - (a.costeSobrePrecio ?? 0),
    }[orden]
    return [...c].sort(margenPropio ? orden3 : (a, b) => b.uds - a.uds)
  }, [filas, orden, margenPropio])

  const sinCoste = useMemo(
    () => [...filas.filter((f) => f.coste == null)].sort((a, b) => b.uds - a.uds),
    [filas],
  )

  const abrirFicha = (recipeItemId: string | null, menuItemId: string, tab: string) => {
    if (recipeItemId) navigate(`/kitchen/recetas?recipe=${recipeItemId}&tab=${tab}`)
    else navigate(`/kitchen/menu?producto=${menuItemId}`)
  }

  const hasta = new Date()
  const desde = new Date(hasta.getTime() - dias * 24 * 3600 * 1000)

  return (
    // B83 · al estándar de la maqueta (§9.2 de Extras). Tablero:
    // `Rentabilidad.dc.html`. Cambia cómo se ve, no qué dice.
    //
    // SIN SELECTOR DE LOCAL, y no por olvido: `menu_item_economics(p_brand_id,
    // p_service_type)` y `menu_item_units_sold(p_brand_id, p_from, p_to)` no
    // aceptan local — medido en la base. Un selector que no filtra es peor que
    // su ausencia, y filtrarlo en el navegador sería inventar el dato. Queda
    // como diferencia con el tablero hasta que las dos consultas lo acepten.
    <div className="cocina min-h-full">
      <div className="cocina-pagina">

        <CabeceraCocina
          migaja={`Folvy Kitchen${nombreDeLaCuenta ? ` · ${nombreDeLaCuenta}` : ''}`}
          pregunta="¿Qué platos te dejan más margen?"
          regla={
            <>
              Margen = precio de carta sin IVA − coste del plato (ingredientes y envase) ·{' '}
              <em className="not-italic text-cocina-tinta-3">
                vendido {intervaloDeFechas(desde, hasta, { minuscula: true }) ?? 'en el periodo elegido'}
              </em>.{' '}
              {/* Lo provisional va AQUÍ, en la misma línea, no en una caja. */}
              <span className="text-cocina-tinta-3">
                {margenPropio
                  ? 'El margen después de la comisión de Glovo, Uber o Just Eat llega cuando el catálogo tenga canal.'
                  : MARGEN_DE_MARCA_CEDIDA}
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
              onChange={(e) => { const d = Number(e.target.value) as Dias; setDias(d); guardaPeriodoRecordado('rentabilidad', d) }}
              className="text-[13px] font-medium text-cocina-tinta"
            >
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="365">Último año</option>
            </select>
          </CampoCocina>
        </CabeceraCocina>

        {/* 2 · CINCO CIFRAS con nombre de persona. Ni una más. */}
        <CifrasCocina>
          <CifraCocina titulo="Platos en carta" valor={String(cifras.platosEnCarta)}
            pie={`${cifras.conCoste} con coste · ${cifras.sinCoste} sin coste`} />
          <CifraCocina titulo="Margen por unidad vendida" valor={eurSinSimbolo(cifras.margenPorUnidadVendida)} sufijo="€"
            pie="media de todo lo vendido con coste, bebidas incluidas" />
          <CifraCocina titulo="Margen que han dejado" valor={eurDeCocina(cifras.margenDelPeriodo)} tono="bueno"
            pie={`en ${dias} días · ${eurDeCocina(cifras.margenPorMes)} al mes · sumado plato a plato con el coste exacto`} />
          <CifraCocina titulo="Mejor plato" valor={eurSinSimbolo(cifras.mejorPlato?.margen)} sufijo="€"
            pie={cifras.mejorPlato ? `${cifras.mejorPlato.nombre} · ${pct(cifras.mejorPlato.costeSobrePrecio)} de coste` : '—'} />
          <CifraCocina titulo="Vendidos sin saber el coste" valor={String(cifras.udsSinCoste)}
            pie={`de ${cifras.udsTotales} · son los ${cifras.sinCoste} platos sin coste`}
            tono={cifras.udsSinCoste > 0 ? 'malo' : undefined} />
        </CifrasCocina>

        {/* 3 · EL FILTRO ES LA ACCIÓN. Aquí la pregunta es el ranking, así que
               el orden manda y «sólo los que no tienen coste» nace apagado. */}
        <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
          <div className="flex gap-1.5">
            {([['margen', 'Por margen'], ['vendido', 'Por lo vendido'], ['coste', 'Por coste']] as const).map(([v, t]) => (
              <ChipCocina key={v} activo={orden === v} onClick={() => setOrden(v)}>{t}</ChipCocina>
            ))}
          </div>
          <InterruptorCocina activo={soloSinCoste} onChange={setSoloSinCoste}>
            Sólo los que no tienen coste
          </InterruptorCocina>
        </div>

        {cargando || error || filas.length === 0 ? (
          <EstadoDeLaConsulta
            cargando={cargando}
            textoCargando="Cruzando la carta con lo vendido…"
            error={error}
            queSePregunto={marca ? `la rentabilidad de ${marca.name}` : 'la rentabilidad'}
            matiz={marca
              ? 'Si la marca tiene productos en su carta, es que ninguno ha llegado hasta aquí: revisa que tengan escandallo.'
              : 'Elige una marca arriba.'}
          />
        ) : (
          <>
            {/* 4 · LAS FILAS. */}
            {!soloSinCoste && conCoste.length > 0 && (
              <Tabla filas={conCoste} recetaPorItem={recetaPorItem} abrir={abrirFicha} margenPropio={margenPropio} />
            )}

            {sinCoste.length > 0 && (
              <PanelCocina>
                <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 border-b border-cocina-linea-suave bg-cocina-superficie-2">
                  <span className="text-[11px] font-bold tracking-[0.09em] uppercase text-cocina-tinta-3">
                    Sin coste · {sinCoste.length}
                  </span>
                  <span className="text-[11.5px] text-cocina-tinta-3">
                    se han vendido {cifras.udsSinCoste} veces en {dias} días sin saber lo que cuestan
                  </span>
                </div>
                {sinCoste.map((f) => {
                  const m = motivoSinCoste(f.tipo)
                  return (
                    <div key={f.id}
                      className="grid gap-3.5 items-center px-4 py-[7px] border-b border-cocina-linea-suave last:border-b-0 min-h-[50px]"
                      style={{ gridTemplateColumns: REJILLA_SIN_COSTE }}>
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold text-cocina-tinta truncate">{f.nombre}</div>
                        <div className="text-[11.5px] text-cocina-tinta-3 mt-0.5">{m.motivo}</div>
                      </div>
                      <span className="num text-[13px] text-right text-cocina-tinta whitespace-nowrap">
                        {eur(f.precio)}
                        <span className="block text-[11px] text-cocina-tinta-3">{eurSinSimbolo(f.precioNeto)} sin IVA</span>
                      </span>
                      <span className="text-right">
                        <PastillaCocina tono="ambar">sin coste</PastillaCocina>
                      </span>
                      <span className="num text-[13px] text-right text-cocina-tinta">{f.uds}</span>
                      <span className="text-right">
                        <BotonCocina peso="borde"
                          onClick={() => abrirFicha(recetaPorItem.get(f.id) ?? null, f.id, m.destino)}>
                          {m.boton}
                        </BotonCocina>
                      </span>
                    </div>
                  )
                })}
              </PanelCocina>
            )}

            {/* 5 · NADA MÁS. Sólo la vara con la que se ha medido. */}
            <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
              Precios y costes son los de hoy; lo vendido, lo que dice el TPV en el periodo.
              {marca && (marca.ownershipType === 'licensed'
                ? ` ${marca.name} es de terceros: su carta la manda el TPV.`
                : ` ${marca.name} es tuya: el margen es tuyo entero.`)}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Tabla({
  filas, recetaPorItem, abrir, margenPropio,
}: {
  filas: FilaDeCarta[]
  recetaPorItem: Map<string, string | null>
  abrir: (recipeItemId: string | null, menuItemId: string, tab: string) => void
  /** false = marca de terceros: el margen no es de Foodint y no se pinta. */
  margenPropio: boolean
}) {
  return (
    <PanelCocina>
      <div
        className="grid gap-3.5 px-4 py-2 text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 border-b border-cocina-linea-suave bg-cocina-superficie-2"
        style={{ gridTemplateColumns: REJILLA_CARTA }}
      >
        <span>Plato</span>
        <span className="text-right">Precio de carta</span>
        <span className="text-right">Coste</span>
        <span className="text-right">Margen</span>
        <span className="text-right">Coste sobre precio sin IVA</span>
        <span className="text-right">Vendidos</span>
        <span />
      </div>
      {filas.map((f) => {
        const etiquetas = etiquetasDeFila(f)
        return (
          <div key={f.id}
            className="grid gap-3.5 items-center px-4 py-[7px] border-b border-cocina-linea-suave last:border-b-0 min-h-[50px]"
            style={{ gridTemplateColumns: REJILLA_CARTA }}>
            <div className="min-w-0 flex items-center gap-1.5">
              <span className="text-[13.5px] font-semibold text-cocina-tinta truncate">{f.nombre}</span>
              {etiquetas.map((e) => <PastillaCocina key={e} tono="ambar">{e}</PastillaCocina>)}
            </div>
            <span className="num text-[13px] text-right text-cocina-tinta whitespace-nowrap">
              {eur(f.precio)}
              <span className="block text-[11px] text-cocina-tinta-3">{eurSinSimbolo(f.precioNeto)} sin IVA</span>
            </span>
            <span className="num text-[13px] text-right text-cocina-tinta">{eur(f.coste)}</span>
            {/* El margen es el número de la pregunta: en tinta y en negrita. */}
            <span className="num text-[13px] text-right font-semibold text-cocina-tinta">
              {margenPropio ? eur(f.margen) : '—'}
            </span>
            <span className="num text-[13px] text-right text-cocina-tinta">
              {margenPropio ? pct(f.costeSobrePrecio) : '—'}
            </span>
            <span className="num text-[13px] text-right text-cocina-tinta">{f.uds}</span>
            <span className="text-right">
              <BotonCocina peso="fantasma"
                onClick={() => abrir(recetaPorItem.get(f.id) ?? null, f.id, 'escandallo')}>
                Abrir
              </BotonCocina>
            </span>
          </div>
        )
      })}
    </PanelCocina>
  )
}
