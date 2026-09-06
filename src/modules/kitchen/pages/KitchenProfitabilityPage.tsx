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
import {
  calculaFila, cifrasDeRentabilidad, etiquetasDeFila, motivoSinCoste,
  type FilaDeCarta,
} from '@/modules/kitchen/lib/cartaYMargen'
import { intervaloEnCastellano } from '@/modules/ventas/services/textoInforme'
import { fmtMoney, fmtPct } from '@/lib/format'
import type { Brand } from '@/types/multitenancy'

type Dias = 30 | 90 | 365
type Orden = 'margen' | 'vendido' | 'coste'

// Los formateadores del proyecto, que ya son null-safe: un coste ausente sale
// «—», nunca 0 (regla del módulo, y la lección de meez).
const eur = (v: number | null | undefined) => fmtMoney(v)
/** Para «Margen que han dejado» y «al mes»: euros sin céntimos. */
const eurRedondo = (v: number | null | undefined) =>
  v == null ? '—' : `${Math.round(v).toLocaleString('es-ES')} €`
const pct = (v: number | null | undefined) => fmtPct(v, 1)

/** La marca que se recuerda entre visitas (principio 7). */
const RECUERDO = 'folvy.kitchen.rentabilidad'

function leeRecuerdo(): { marca?: string; dias?: Dias } {
  try { return JSON.parse(localStorage.getItem(RECUERDO) ?? '{}') } catch { return {} }
}
function guardaRecuerdo(v: { marca?: string; dias?: Dias }) {
  try { localStorage.setItem(RECUERDO, JSON.stringify(v)) } catch { /* sin recuerdo, no pasa nada */ }
}

export default function KitchenProfitabilityPage() {
  const { activeAccountId } = useActiveAccount()
  const navigate = useNavigate()

  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [dias, setDias] = useState<Dias>(leeRecuerdo().dias ?? 90)
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
        const recordada = leeRecuerdo().marca
        const elegida =
          vivas.find((b) => b.id === recordada) ??
          vivas.find((b) => b.ownershipType === 'own') ??
          vivas[0]
        setBrandId(elegida?.id ?? null)
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

  const cifras = useMemo(() => cifrasDeRentabilidad(filas, dias), [filas, dias])

  const conCoste = useMemo(() => {
    const c = filas.filter((f) => f.margen != null)
    const orden3 = {
      margen: (a: FilaDeCarta, b: FilaDeCarta) => (b.margen as number) - (a.margen as number),
      vendido: (a: FilaDeCarta, b: FilaDeCarta) => b.uds - a.uds,
      coste: (a: FilaDeCarta, b: FilaDeCarta) => (b.costeSobrePrecio ?? 0) - (a.costeSobrePrecio ?? 0),
    }[orden]
    return [...c].sort(orden3)
  }, [filas, orden])

  const sinCoste = useMemo(
    () => [...filas.filter((f) => f.margen == null)].sort((a, b) => b.uds - a.uds),
    [filas],
  )

  const abrirFicha = (recipeItemId: string | null, menuItemId: string, tab: string) => {
    if (recipeItemId) navigate(`/kitchen/recetas?recipe=${recipeItemId}&tab=${tab}`)
    else navigate(`/kitchen/menu?producto=${menuItemId}`)
  }

  const hasta = new Date()
  const desde = new Date(hasta.getTime() - dias * 24 * 3600 * 1000)

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* 1 · LA PREGUNTA, y debajo una sola línea con la regla y las fechas. */}
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">¿Qué platos te dejan más margen?</h1>
        <p className="mt-1.5 text-sm text-text-secondary max-w-4xl">
          Margen = precio de carta sin IVA − coste del plato (ingredientes y envase) ·
          vendido {intervaloEnCastellano(desde.toISOString(), hasta.toISOString())}.{' '}
          {/* Lo provisional va AQUÍ, en la misma línea, no en una caja amarilla. */}
          <span className="text-text-tertiary">
            El margen después de la comisión de Glovo, Uber o Just Eat llega cuando el catálogo tenga canal.
          </span>
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <Campo label="Marca">
          <select
            value={brandId ?? ''}
            onChange={(e) => { setBrandId(e.target.value); guardaRecuerdo({ marca: e.target.value, dias }) }}
            className="px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.ownershipType === 'licensed' ? ' · de terceros' : ''}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Periodo">
          <select
            value={String(dias)}
            onChange={(e) => { const d = Number(e.target.value) as Dias; setDias(d); guardaRecuerdo({ marca: brandId ?? undefined, dias: d }) }}
            className="px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary"
          >
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="365">Último año</option>
          </select>
        </Campo>
      </div>

      {/* 2 · CINCO CIFRAS con nombre de persona. Ni una más. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <Cifra titulo="Platos en carta" valor={String(cifras.platosEnCarta)}
          pie={`${cifras.conCoste} con coste · ${cifras.sinCoste} sin coste`} />
        <Cifra titulo="Margen por unidad vendida" valor={eur(cifras.margenPorUnidadVendida)}
          pie="media de todo lo vendido con coste, bebidas incluidas" />
        <Cifra titulo="Margen que han dejado" valor={eurRedondo(cifras.margenDelPeriodo)}
          pie={`en ${dias} días · ${eurRedondo(cifras.margenPorMes)} al mes · sumado plato a plato con el coste exacto`} />
        <Cifra titulo="Mejor plato" valor={eur(cifras.mejorPlato?.margen)}
          pie={cifras.mejorPlato ? `${cifras.mejorPlato.nombre} · ${pct(cifras.mejorPlato.costeSobrePrecio)} de coste` : '—'} />
        <Cifra titulo="Vendidos sin saber el coste" valor={String(cifras.udsSinCoste)}
          pie={`de ${cifras.udsTotales} · son los ${cifras.sinCoste} platos sin coste`}
          alerta={cifras.udsSinCoste > 0} />
      </div>

      {/* 3 · EL FILTRO ES LA ACCIÓN. Aquí la pregunta es el ranking, así que el
             orden manda y «sólo los que no tienen coste» nace apagado. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {([['margen', 'Por margen'], ['vendido', 'Por lo vendido'], ['coste', 'Por coste']] as const).map(([v, t]) => (
          <button key={v} type="button" onClick={() => setOrden(v)}
            className={`px-3 py-1.5 rounded-md border transition-base ${
              orden === v ? 'border-accent bg-accent text-white' : 'border-border-default text-text-secondary hover:bg-page'}`}>
            {t}
          </button>
        ))}
        <label className="inline-flex items-center gap-1.5 ml-2 text-text-secondary cursor-pointer">
          <input type="checkbox" checked={soloSinCoste} onChange={(e) => setSoloSinCoste(e.target.checked)} />
          Sólo los que no tienen coste
        </label>
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
            <Tabla filas={conCoste} recetaPorItem={recetaPorItem} abrir={abrirFicha} />
          )}

          {sinCoste.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-text-primary">
                Sin coste · {sinCoste.length}
                <span className="ml-2 font-normal text-text-secondary">
                  se han vendido {cifras.udsSinCoste} veces en {dias} días sin saber lo que cuestan
                </span>
              </h2>
              {sinCoste.map((f) => {
                const m = motivoSinCoste(f.tipo)
                return (
                  <div key={f.id} className="bg-card border border-border-default rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-primary">{f.nombre}</div>
                      <div className="text-xs text-text-secondary">{m.motivo}</div>
                    </div>
                    <div className="text-sm text-text-secondary font-mono">
                      {eur(f.precio)} <span className="text-xs">· {eur(f.precioNeto)} sin IVA</span>
                    </div>
                    <div className="text-sm text-warning">— sin coste</div>
                    <div className="text-sm text-text-secondary font-mono w-16 text-right">{f.uds}</div>
                    <button type="button"
                      onClick={() => abrirFicha(recetaPorItem.get(f.id) ?? null, f.id, m.destino)}
                      className="text-xs font-medium px-3 py-1.5 rounded-md border border-border-default text-terracota hover:bg-terracota-bg transition-base">
                      {m.boton}
                    </button>
                  </div>
                )
              })}
            </section>
          )}

          {/* 5 · NADA MÁS. Sólo la vara con la que se ha medido. */}
          <p className="text-xs text-text-secondary">
            Precios y costes son los de hoy; lo vendido, lo que dice el TPV en el periodo.
            {marca && (marca.ownershipType === 'licensed'
              ? ` ${marca.name} es de terceros: su carta la manda el TPV.`
              : ` ${marca.name} es tuya: el margen es tuyo entero.`)}
          </p>
        </>
      )}
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

function Cifra({ titulo, valor, pie, alerta }: { titulo: string; valor: string; pie: string; alerta?: boolean }) {
  return (
    <div className="bg-card border border-border-default rounded-lg p-3">
      <div className="text-[11px] text-text-secondary">{titulo}</div>
      <div className={`text-2xl font-semibold mt-0.5 ${alerta ? 'text-danger' : 'text-text-primary'}`}>{valor}</div>
      <div className="text-[11px] text-text-secondary mt-1 leading-snug">{pie}</div>
    </div>
  )
}

function Tabla({
  filas, recetaPorItem, abrir,
}: {
  filas: FilaDeCarta[]
  recetaPorItem: Map<string, string | null>
  abrir: (recipeItemId: string | null, menuItemId: string, tab: string) => void
}) {
  return (
    <div className="bg-card border border-border-default rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-text-secondary border-b border-border-default">
            <th className="px-3 py-2 font-medium">Plato</th>
            <th className="px-3 py-2 font-medium text-right">Precio de carta</th>
            <th className="px-3 py-2 font-medium text-right">Coste</th>
            <th className="px-3 py-2 font-medium text-right">Margen</th>
            <th className="px-3 py-2 font-medium text-right">Coste sobre precio sin IVA</th>
            <th className="px-3 py-2 font-medium text-right">Vendidos</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const etiquetas = etiquetasDeFila(f)
            return (
              <tr key={f.id} className="border-b border-border-default last:border-0 hover:bg-page">
                <td className="px-3 py-2 text-text-primary">
                  {f.nombre}
                  {etiquetas.map((e) => (
                    <span key={e} className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-warning-bg text-warning">{e}</span>
                  ))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-text-primary whitespace-nowrap">
                  {eur(f.precio)}
                  <span className="block text-[11px] text-text-secondary">{eur(f.precioNeto)} sin IVA</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-text-secondary">{eur(f.coste)}</td>
                <td className="px-3 py-2 text-right font-mono text-text-primary">{eur(f.margen)}</td>
                <td className="px-3 py-2 text-right font-mono text-text-secondary">{pct(f.costeSobrePrecio)}</td>
                <td className="px-3 py-2 text-right font-mono text-text-secondary">{f.uds}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button"
                    onClick={() => abrir(recetaPorItem.get(f.id) ?? null, f.id, 'escandallo')}
                    className="text-xs px-2.5 py-1 rounded-md border border-border-default text-text-secondary hover:bg-page transition-base">
                    Abrir
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
