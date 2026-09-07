// src/modules/kitchen/pages/KitchenExtrasPage.tsx
//
// SECCIÓN «EXTRAS» (encargo del 07/09/2026, maqueta aprobada §8).
//
// EL PROBLEMA, EN UNA FRASE: hay 98 extras que cobran y no descuentan comida, y
// son sólo 56 nombres. Ponerle coste a «Salsa Yogur» hoy son SIETE pantallas
// para la misma salsa —Cartas → producto → Modificadores → Impacto en coste, una
// vez por copia—, y por eso siguen a cero: el camino es siete veces más largo de
// lo que debería. Aquí se dice una vez y vale para las siete.
//
// EL DISEÑO ES EL DE LA MAQUETA, no el de la app de hoy (§9, condición de Julio
// al aprobar: «limpio y pro, no el seco y para informáticos que hay ahora»).
// Todo va dentro de `.cocina`, que trae los tokens copiados de `build.py::CSS`
// y comprobados uno a uno en `tokensDeCocina.test.ts`. Las rejillas y las
// alturas son las del `.dc.html`, no una aproximación.
//
// Y NADA DE JERGA (línea 5 del patrón): ni `impact_type`, ni `bundle`, ni
// `confirmed`. El castellano vive entero en `lib/extrasDeCocina.ts` y está
// probado allí.

import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import { intervaloDeFechas } from '@/modules/ventas/services/textoInforme'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  CabeceraCocina, CampoCocina, CifrasCocina, CifraCocina,
  PastillaCocina, BotonCocina, ChipCocina, InterruptorCocina, PanelCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { getExtras, ponerLoQueLleva, type LosExtras } from '@/modules/kitchen/services/extrasService'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import { kindOf, TIPOS_ELEGIBLES, type CatalogPick } from '@/modules/kitchen/lib/catalogPick'
import type { UnidadPick } from '@/modules/kitchen/lib/impactoResuelto'
import FlujoDeExtra from '@/modules/kitchen/components/FlujoDeExtra'
import {
  ORDENES, confirmacion, cuantasCopias, ventanaEnCastellano, loQueCobra, queLleva, botonDeLaFila,
  hayQueArreglarlo, ordena, parteEnDos, pieDeLaBarra, tituloDelPliegue,
  type ExtraPorNombre, type OrdenDeExtras, type CosaQueLleva,
} from '@/modules/kitchen/lib/extrasDeCocina'

/** La rejilla de la tabla, copiada del `.dc.html`. Cabecera y filas comparten. */
const REJILLA = 'minmax(0,1fr) 120px 90px 110px 150px auto'

const eur = (n: number) =>
  n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function KitchenExtrasPage() {
  const { activeAccountId } = useActiveAccount()
  const { userProfile } = useApp()
  const nombreDelActor = userProfile?.displayName ?? null
  const [datos, setDatos] = useState<LosExtras | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [soloLosQueArreglar, setSoloLosQueArreglar] = useState(true)
  const [orden, setOrden] = useState<OrdenDeExtras>('vendido')
  const [marca, setMarca] = useState<string>('')          // '' = todas
  const [pliegueAbierto, setPliegueAbierto] = useState(false)
  const [refresco, setRefresco] = useState(0)

  // El flujo y el «ver dónde». Sólo uno abierto a la vez: dos cajas de aviso
  // apiladas es justo lo que prohíbe la línea 5 del patrón.
  const [enFlujo, setEnFlujo] = useState<ExtraPorNombre | null>(null)
  const [verDonde, setVerDonde] = useState<ExtraPorNombre | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [catalogo, setCatalogo] = useState<CatalogPick[]>([])
  const [unidades, setUnidades] = useState<UnidadPick[]>([])

  // La consulta empieza con el `await`, no con un `setCargando(true)`: tocar el
  // estado en seco dentro del efecto encadena un render de más.
  //
  // Y el `vigente` no es adorno: si alguien cambia de cuenta con la consulta en
  // vuelo, la respuesta de la cuenta ANTERIOR llegaría después y pintaría los
  // extras de otro cliente. Es la regla 9 en el lado del navegador.
  useEffect(() => {
    if (!activeAccountId) return
    let vigente = true
    void (async () => {
      try {
        const d = await getExtras(activeAccountId)
        if (!vigente) return
        setDatos(d); setError(null)
      } catch (e) {
        if (!vigente) return
        setError(e instanceof Error ? e.message : 'No se han podido leer los extras')
      } finally {
        if (vigente) setCargando(false)
      }
    })()
    return () => { vigente = false }
  }, [activeAccountId, refresco])

  // El catálogo y las unidades: los mismos que usa la pestaña del plato, para
  // que las dos pantallas ofrezcan lo mismo y calculen igual.
  useEffect(() => {
    if (!activeAccountId) return
    let vigente = true
    void (async () => {
      try {
        const [items, uds] = await Promise.all([
          listRecipeItems({ accountId: activeAccountId, includeArchived: true }),
          listUnits({}),
        ])
        if (!vigente) return
        setCatalogo(items.map((r) => ({
          id: r.id, name: r.name, needsReview: r.needsReview, type: r.type,
          kind: kindOf(r.type),
          selectable: TIPOS_ELEGIBLES.includes(r.type) && r.isActive === true && r.archivedAt == null,
          costeUnitario: r.computedCost ?? r.fixedCost ?? null,
          baseUnitId: r.baseUnitId ?? null,
        })))
        setUnidades(uds.map((u) => ({
          id: u.id, abreviatura: u.abbreviation, dimension: u.dimension, factorABase: u.factorToBase,
        })))
      } catch { /* el flujo lo dirá al abrirse; la lista no depende de esto */ }
    })()
    return () => { vigente = false }
  }, [activeAccountId])

  async function guardar(opciones: string[], cosas: CosaQueLleva[], frase: string, coste: number) {
    if (!activeAccountId || !enFlujo) return
    setGuardando(true)
    try {
      await ponerLoQueLleva({
        accountId: activeAccountId,
        opciones,
        lleva: cosas.map((c) => ({ ficha: c.ficha, tipo: c.tipo, cantidad: c.cantidad, unidad: c.unidad })),
        actor: nombreDelActor,
      })
      // La confirmación lleva CONTENIDO (regla 8): qué, cuánto, dónde y qué queda.
      setHecho(confirmacion({
        nombre: enFlujo.nombre, queLleva: frase, coste,
        copias: enFlujo.donde.filter((d) => opciones.includes(d.opcion)),
        sinCosteDespues: Math.max(0, (datos?.cifras.sinCoste ?? 0) - opciones.length),
      }))
      setEnFlujo(null)
      setRefresco((n) => n + 1)     // los contadores se recalculan solos
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar lo que lleva')
    } finally {
      setGuardando(false)
    }
  }

  /** Las marcas que ofrece el selector salen de los datos, no de una lista aparte. */
  const marcas = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of datos?.filas ?? []) {
      for (const c of f.donde) if (c.marcaId) m.set(c.marcaId, c.marca)
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [datos])

  const visibles = useMemo(() => {
    let filas = datos?.filas ?? []
    if (soloLosQueArreglar) filas = filas.filter(hayQueArreglarlo)
    if (marca) filas = filas.filter((f) => f.donde.some((c) => c.marcaId === marca))
    return ordena(filas, orden)
  }, [datos, soloLosQueArreglar, marca, orden])

  // Las fechas de la ventana, en castellano. Salen de la consulta —son los días
  // que ha contado— y aquí sólo se escriben: un reloj, no dos. La lógica vive en
  // `lib/` para poder probarla: una frase que sitúa mal al que mira no la caza
  // un build.
  const intervalo = useMemo(
    () => ventanaEnCastellano(datos?.ventanaDesde ?? null, datos?.ventanaHasta ?? null, intervaloDeFechas),
    [datos],
  )

  const { conVentas, sinVentas } = useMemo(() => parteEnDos(visibles), [visibles])

  // El pie de la barra cuenta EL PROBLEMA, no lo que el filtro deja ver: «56
  // nombres · 100 copias · los 34 que se venden». Contar lo filtrado haría que
  // el número bajara al marcar una casilla, como si se hubiera arreglado algo.
  const paraElPie = useMemo(() => {
    let f = datos?.filas ?? []
    if (marca) f = f.filter((x) => x.donde.some((c) => c.marcaId === marca))
    return f.filter(hayQueArreglarlo)
  }, [datos, marca])
  const c = datos?.cifras

  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">

        <CabeceraCocina
          migaja="Folvy Kitchen"
          pregunta="¿Qué extras cobras sin saber lo que te cuestan?"
          regla={
            <>
              Un extra es lo que el cliente añade o elige y paga aparte. Aquí se le
              dice <b className="font-semibold text-cocina-tinta">una vez</b> qué lleva
              y vale para todos los platos donde aparezca
              {intervalo && <> · <em className="not-italic text-cocina-tinta-3">{intervalo}.</em></>}
            </>
          }
        >
          <CampoCocina label="Marca">
            <select
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              className="bg-transparent outline-none text-[13px] font-medium text-cocina-tinta"
            >
              <option value="">Todas</option>
              {marcas.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            </select>
          </CampoCocina>
        </CabeceraCocina>

        {(cargando || error || !datos) ? (
          <EstadoDeLaConsulta
            cargando={cargando}
            textoCargando="Buscando los extras que cobran…"
            error={error}
            queSePregunto="los extras que cobran de esta cuenta"
          />
        ) : (
          <>
            <CifrasCocina>
              <CifraCocina
                titulo="Extras que cobran" valor={String(c!.cobran)}
                pie={`en ${c!.marcasQueCobran} marcas · ${c!.nombresSinCoste} nombres distintos sin coste`}
              />
              <CifraCocina
                titulo="Con coste" valor={String(c!.conCoste)} tono="bueno"
                pie="ya dicen lo que llevan"
              />
              <CifraCocina
                titulo="Sin coste" valor={String(c!.sinCoste)} tono="malo"
                pie="entran por caja y no descuentan comida"
              />
              <CifraCocina
                titulo="Vendidos sin coste" valor={String(c!.vecesVendidos)}
                pie={`${c!.vendidosSinCoste} extras distintos, en ${datos.ventanaDias ?? 30} días`}
              />
              <CifraCocina
                titulo="Cobrado sin saber el coste" valor={eur(c!.cobradoEur)} sufijo="€" tono="malo"
                pie={`en ${datos.ventanaDias ?? 30} días · la comida que llevan no está en el coste`}
              />
            </CifrasCocina>

            {/* El filtro ES la acción, y el orden va al lado. */}
            <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
              <div className="flex gap-3.5 items-center flex-wrap">
                <InterruptorCocina activo={soloLosQueArreglar} onChange={setSoloLosQueArreglar}>
                  Sólo los que hay que arreglar
                </InterruptorCocina>
                <div className="flex gap-1.5">
                  {ORDENES.map((o) => (
                    <ChipCocina key={o.clave} activo={orden === o.clave} onClick={() => setOrden(o.clave)}>
                      {o.etiqueta}
                    </ChipCocina>
                  ))}
                </div>
              </div>
              <span className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
                {pieDeLaBarra(paraElPie)}
              </span>
            </div>

            {/* Lo que ha pasado, con contenido y no con un visto (regla 8). */}
            {hecho && (
              <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-verde-bg text-cocina-verde border border-cocina-verde/35 flex items-start justify-between gap-3">
                <span>{hecho}</span>
                <button type="button" onClick={() => setHecho(null)} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
              </div>
            )}

            <PanelCocina>
              <div
                className="grid gap-3.5 px-4 py-2 text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 border-b border-cocina-linea-suave bg-cocina-superficie-2"
                style={{ gridTemplateColumns: REJILLA }}
              >
                <span>Extra</span>
                <span className="text-right">Copias</span>
                <span className="text-right">Cobra</span>
                <span className="text-right">Vendido {datos.ventanaDias ?? 30} d</span>
                <span>Qué lleva</span>
                <span />
              </div>

              {conVentas.length === 0 && sinVentas.length === 0 ? (
                <p className="px-4 py-6 text-[13px] text-cocina-tinta-3">
                  Ningún extra cumple lo que estás mirando ahora mismo.
                </p>
              ) : (
                conVentas.map((f) => (
                  <FilaDeExtra key={f.clave} extra={f}
                    onDecir={() => { setHecho(null); setEnFlujo(f) }}
                    onVerDonde={() => setVerDonde(verDonde?.clave === f.clave ? null : f)}
                    abierta={verDonde?.clave === f.clave} />
                ))
              )}

              {/* Lo que no se vende NO desaparece: baja, se cuenta y se abre
                  (regla 7 — el umbral ordena, no decide quién existe). */}
              {sinVentas.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPliegueAbierto((v) => !v)}
                    className="w-full flex items-center gap-2.5 px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2 text-left"
                  >
                    <ChevronRight size={14} className={`text-cocina-tinta-3 transition-base ${pliegueAbierto ? 'rotate-90' : ''}`} />
                    <span className="text-[14px] font-bold text-cocina-tinta">{tituloDelPliegue(sinVentas)}</span>
                    <span className="text-[12px] text-cocina-tinta-3">
                      que no se han vendido en {datos.ventanaDias ?? 30} días · ordenados por copias
                    </span>
                  </button>
                  {pliegueAbierto && sinVentas.map((f) => (
                    <FilaDeExtra key={f.clave} extra={f}
                      onDecir={() => { setHecho(null); setEnFlujo(f) }}
                      onVerDonde={() => setVerDonde(verDonde?.clave === f.clave ? null : f)}
                      abierta={verDonde?.clave === f.clave} />
                  ))}
                </>
              )}
            </PanelCocina>

            <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
              Al decir qué lleva un extra se aplica a todas sus copias y el coste se
              ve al momento en la pestaña Modificadores de cada plato. Un plato
              entero («Sí, con patatas») se pone como plato, no como ingredientes.
            </p>
          </>
        )}
      </div>

      {enFlujo && (
        <FlujoDeExtra
          extra={enFlujo}
          catalogo={catalogo}
          unidades={unidades}
          sinCosteAhora={datos?.cifras.sinCoste ?? 0}
          guardando={guardando}
          onCancelar={() => setEnFlujo(null)}
          onGuardar={guardar}
        />
      )}
    </div>
  )
}

/** Una fila: un NOMBRE, no una copia. Es la idea entera de la sección. */
function FilaDeExtra({
  extra, onDecir, onVerDonde, abierta,
}: {
  extra: ExtraPorNombre
  onDecir: () => void
  onVerDonde: () => void
  abierta: boolean
}) {
  const cobra = loQueCobra(extra)
  const lleva = queLleva(extra)
  const marcas = [...new Set(extra.donde.map((d) => d.marca))].join(' · ')

  return (
    <>
    <div
      className="grid gap-3.5 items-center px-4 py-[7px] border-b border-cocina-linea-suave last:border-b-0 min-h-[50px]"
      style={{ gridTemplateColumns: REJILLA }}
    >
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-cocina-tinta">{extra.nombre}</div>
        <div className="text-[11.5px] font-medium text-cocina-tinta-3 mt-0.5 truncate">{marcas}</div>
      </div>

      <div className="text-right text-[13px] text-cocina-tinta-2">{cuantasCopias(extra)}</div>

      <div className="text-right">
        {cobra.esRango
          ? <PastillaCocina tono="ambar">{cobra.texto}</PastillaCocina>
          : <span className="num text-[13px] text-cocina-tinta">{cobra.texto}</span>}
      </div>

      <div className="text-right num text-[13px] text-cocina-tinta">{extra.vendidas}</div>

      <div><PastillaCocina tono={lleva.tono}>{lleva.texto}</PastillaCocina></div>

      <div className="flex gap-2">
        <BotonCocina onClick={onDecir}>{botonDeLaFila(extra)}</BotonCocina>
        <BotonCocina peso="fantasma" onClick={onVerDonde}>Ver dónde</BotonCocina>
      </div>
    </div>

    {/* Dónde aparece: la copia, su marca, en qué grupo la ve el cliente, lo que
        cobra y lo que se vende. Es lo que hace falta para decidir si son la
        misma cosa. */}
    {abierta && (
      <div className="px-4 pb-3 pt-1 bg-cocina-superficie-2 border-b border-cocina-linea-suave">
        <div className="text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 mb-1.5">
          Dónde aparece
        </div>
        <div className="flex flex-col gap-1">
          {extra.donde.map((c) => (
            <div key={c.opcion}
              className="grid items-center gap-2.5 text-[12.5px] px-2.5 py-1.5 bg-cocina-superficie border border-cocina-linea-suave rounded-cocina"
              style={{ gridTemplateColumns: 'minmax(0,1fr) 90px 90px 110px' }}>
              <span className="truncate text-cocina-tinta">{c.marca} · «{c.grupo}»</span>
              <span className="num text-right text-cocina-tinta">{eur(c.precio)} €</span>
              <span className="num text-right text-cocina-tinta-3">
                {c.vendidas > 0 ? `${c.vendidas} vend.` : '0'}
              </span>
              <span className="text-right">
                {c.tieneCoste
                  ? <PastillaCocina tono="verde">{eur(c.coste)} €</PastillaCocina>
                  : <PastillaCocina tono="rojo">sin coste</PastillaCocina>}
              </span>
            </div>
          ))}
        </div>
      </div>
    )}
    </>
  )
}
