// src/modules/kitchen/components/FlujoDeExtra.tsx
//
// El flujo de «Decir qué lleva» (encargo de Extras §2.4 y §4, maqueta §8).
// Copiado del tablero `Flujo.dc.html`: la misma caja `.gate`, los mismos
// campos, la misma confirmación.
//
// DOS PASOS, Y EL PRIMERO SÓLO CUANDO HACE FALTA:
//   1. La PUERTA — únicamente si las copias no cobran lo mismo. «Tiras de Pollo
//      Kentucky» está a 1,90 € en dos marcas y a 6,50 € en otra: la de 6,50 € es
//      una ración entera, no un añadido, y costearlas juntas sería escribir un
//      error en tres fichas (decisión 2 del §5).
//   2. QUÉ LLEVA — el selector de B72, con su etiqueta plato/ingrediente y el
//      coste calculado al momento. Sin «crear como nuevo» a un clic (§4).
//
// Y AL GUARDAR SE DICE QUÉ HA PASADO, no un visto (regla 8): qué lleva, cuánto
// cuesta, a cuántas copias ha ido, en qué marcas y cuántos quedan sin coste.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, Loader2 } from 'lucide-react'
import { BotonCocina, PastillaCocina } from '@/modules/kitchen/components/PatronDeKitchen'
import { resuelveImpacto, type UnidadPick } from '@/modules/kitchen/lib/impactoResuelto'
import { kindOf, TIPOS_ELEGIBLES, normName, type CatalogPick } from '@/modules/kitchen/lib/catalogPick'
import {
  copiasPreseleccionadas, porQueSeQuedaFuera, textoDeGuardar, cuantasCopiasEnElTitulo,
  soloCopias, frasedeLoQueLleva, platoDelMismoNombre, fichasSinPrecio, avisoDeSinPrecio,
  type ExtraPorNombre, type CosaQueLleva,
} from '@/modules/kitchen/lib/extrasDeCocina'

const eur = (n: number) =>
  n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface Props {
  extra: ExtraPorNombre
  catalogo: CatalogPick[]
  unidades: UnidadPick[]
  guardando: boolean
  onCancelar: () => void
  onGuardar: (opciones: string[], cosas: CosaQueLleva[], frase: string, coste: number) => void
}

export default function FlujoDeExtra({
  extra, catalogo, unidades, guardando, onCancelar, onGuardar,
}: Props) {
  // La puerta sólo existe si hace falta. Si todas cobran igual, se salta.
  const [enLaPuerta, setEnLaPuerta] = useState(extra.preciosDistintos)
  const [elegidas, setElegidas] = useState<string[]>(() => copiasPreseleccionadas(extra))
  const [cosas, setCosas] = useState<CosaQueLleva[]>([])

  const porUnidad = useMemo(() => new Map(unidades.map((u) => [u.id, u])), [unidades])
  const porFicha = useMemo(() => new Map(catalogo.map((c) => [c.id, c])), [catalogo])

  /** El coste, con el MISMO motor que la pestaña del plato: no se inventa aquí. */
  const coste = useMemo(() => {
    let total = 0
    for (const c of cosas) {
      const ficha = porFicha.get(c.ficha)
      const r = resuelveImpacto({
        impactType: c.tipo === 'plato' ? 'bundle' : 'add_item',
        targetRecipeItemId: c.ficha,
        quantity: c.cantidad,
        unitId: c.unidad,
        ficha: ficha ? { costeUnitario: ficha.costeUnitario ?? null, baseUnitId: ficha.baseUnitId ?? null } : null,
        unidadDeLaLinea: c.unidad ? porUnidad.get(c.unidad) ?? null : null,
        unidadBaseDeLaFicha: ficha?.baseUnitId ? porUnidad.get(ficha.baseUnitId) ?? null : null,
      })
      if (r.estado === 'con_coste') total += r.euros
      else if (r.estado === 'no_calculable') return null   // no se suma alrededor
    }
    return total
  }, [cosas, porFicha, porUnidad])

  const completo = cosas.length > 0 && cosas.every((c) => c.ficha && (c.tipo === 'plato' || (c.cantidad != null && c.unidad)))

  // Cerrar con Escape: si el panel tapa la pantalla, tiene que haber una salida
  // que no obligue a buscar la «×» con el ratón.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar() }
    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [onCancelar])

  // ── B84.1 · EL PANEL SE ABRE DONDE ESTÁS, NO ARRIBA DE LA PÁGINA ──────────
  //
  // Julio, 07/09 en producción: pulsando «Decir qué lleva» en una fila de abajo
  // el panel salía fuera de la vista y sólo aparecía con la tecla Inicio. Que
  // Inicio lo traiga es la prueba de que NO estaba fijo al viewport: algún
  // ascendiente lo estaba conteniendo. Y un administrativo no deduce eso: cree
  // que el botón no hace nada y lo vuelve a pulsar.
  //
  // El arreglo NO es cazar al ascendiente. Es sacar el panel del subárbol de la
  // página con un portal a `body`: así ningún ancestro —ni el de hoy ni el que
  // alguien añada mañana— puede volver a moverlo. Y `items-center`, como los
  // otros 43 paneles del módulo; el `items-start` era mío y era el único.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(16,26,33,.45)] p-8">
      <div className="cocina w-[560px] max-h-[calc(100vh-64px)] overflow-y-auto bg-cocina-superficie border border-cocina-linea rounded-cocina-md shadow-cocina py-[18px] px-5 flex flex-col gap-3">

        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase text-cocina-tinta-3">
              {enLaPuerta ? 'Cuando las copias no cobran lo mismo' : 'Paso 1 · Decir qué lleva'}
            </div>
            <h2 className="text-[17px] font-bold mt-1 text-cocina-tinta">
              {extra.nombre} · {enLaPuerta ? soloCopias(extra) : cuantasCopiasEnElTitulo(extra)}
              {!enLaPuerta && !extra.preciosDistintos && <> · cobra {eur(extra.precioMin)} €</>}
            </h2>
          </div>
          <button type="button" onClick={onCancelar} className="text-cocina-tinta-3 hover:text-cocina-tinta">
            <X size={18} />
          </button>
        </div>

        {enLaPuerta ? (
          <PuertaDeCopias
            extra={extra}
            elegidas={elegidas}
            onCambiar={setElegidas}
            onCancelar={onCancelar}
            onSeguir={() => setEnLaPuerta(false)}
          />
        ) : (
          <PasoDeLoQueLleva
            extra={extra}
            elegidas={elegidas}
            cosas={cosas}
            catalogo={catalogo}
            unidades={unidades}
            coste={coste}
            completo={completo}
            guardando={guardando}
            onCosas={setCosas}
            onCancelar={onCancelar}
            onGuardar={() => onGuardar(elegidas, cosas, frasedeLoQueLleva(cosas), coste ?? 0)}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * EL PASO 2 — qué lleva el extra. Pura, como `PuertaDeCopias`: recibe lo que hay
 * que pintar y avisa de lo que se toca, sin guardar estado propio.
 *
 * Está separada por la misma razón que el castellano vive en `lib/`: para poder
 * enseñarla. La captura del §9.3 la pinta con una cosa ya puesta —yogur griego,
 * 40 g, 0,18 €—, que es el estado del tablero de la maqueta y un estado al que
 * el componente entero no llega sin que alguien teclee.
 */
export function PasoDeLoQueLleva({
  extra, elegidas, cosas, catalogo, unidades, coste, completo,
  guardando, onCosas, onCancelar, onGuardar,
}: {
  extra: ExtraPorNombre
  elegidas: string[]
  cosas: CosaQueLleva[]
  catalogo: CatalogPick[]
  unidades: UnidadPick[]
  coste: number | null
  completo: boolean
  guardando: boolean
  onCosas: (c: CosaQueLleva[]) => void
  onCancelar: () => void
  onGuardar: () => void
}) {
  const elPlato = useMemo(
    () => platoDelMismoNombre(extra.nombre, catalogo, normName),
    [extra.nombre, catalogo],
  )
  const sinPrecio = useMemo(
    () => fichasSinPrecio(cosas.filter((c) => c.ficha), catalogo),
    [cosas, catalogo],
  )
  return (
    <>
      <p className="text-[12.5px] text-cocina-tinta-2 leading-[1.5]">
        Lo que pongas aquí vale para {elegidas.length === 1 ? 'la copia' : `las ${elegidas.length} copias`}
        : {repartoPorMarca(extra, elegidas)}.
      </p>

      {cosas.map((c, i) => (
        <UnaCosaQueLleva
          key={i}
          cosa={c}
          catalogo={catalogo}
          unidades={unidades}
          sePuedeQuitar={cosas.length > 1}
          onCambiar={(nueva) => onCosas(cosas.map((x, j) => (j === i ? nueva : x)))}
          onQuitar={() => onCosas(cosas.filter((_, j) => j !== i))}
        />
      ))}

      {/* Si ya existe un plato que se llama igual, se dice: su escandallo ya
          está hecho y teclearlo a mano sólo puede salir peor. */}
      {elPlato && !cosas.some((c) => c.ficha === elPlato.id) && (
        <div className="flex justify-between items-center gap-3 px-2.5 py-2 border border-cocina-linea-suave rounded-cocina text-[13px]">
          <span className="text-cocina-tinta-2">
            ¿Es un plato entero? <b className="font-semibold text-cocina-tinta">{elPlato.name}</b> existe
            como plato con su escandallo
            {elPlato.costeUnitario != null && <> · <span className="num">{eur(elPlato.costeUnitario)} €</span></>}
          </span>
          <BotonCocina
            peso="borde"
            onClick={() => onCosas([...cosas.filter((c) => c.ficha), {
              ficha: elPlato.id, nombreFicha: elPlato.name, tipo: 'plato',
              cantidad: 1, unidad: elPlato.baseUnitId ?? null, nombreUnidad: '',
            }])}
          >
            Usar el plato
          </BotonCocina>
        </div>
      )}

      {cosas.length > 0 && (
        <div className="flex flex-col gap-1.5 px-2.5 py-2 border border-cocina-linea-suave rounded-cocina">
          <div className="flex justify-between items-center">
            <span className="text-[10.5px] font-bold tracking-[0.05em] uppercase text-cocina-tinta-3">Coste</span>
            {coste === null
              ? <PastillaCocina tono="ambar">no se puede calcular</PastillaCocina>
              : <span className="num text-[13px] font-bold text-cocina-tinta">{eur(coste)} €</span>}
          </div>

          {/* B84.3 · UN CERO QUE NO ES UNA MEDIDA SE DICE. Sin esto, elegir un
              ingrediente sin precio daba «0,00 €» y Guardar activo: se escribían
              las siete copias y el extra quedaba «puesto, pero vale 0 €», que es
              PEOR que no tocarlo — ahora parece hecho. Y con el nombre y el
              enlace, porque el que mira tiene que saber cuál ir a rellenar. */}
          {sinPrecio.length > 0 && (
            <div className="text-[11.5px] text-cocina-ambar leading-[1.45]">
              {avisoDeSinPrecio(sinPrecio)} ·{' '}
              <a
                href={`/kitchen?item=${sinPrecio[0].id}`}
                className="underline underline-offset-2 font-semibold"
              >
                ponérselo en Ingredientes
              </a>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onCosas([...cosas, {
          ficha: '', nombreFicha: '', tipo: 'ingrediente',
          cantidad: null, unidad: null, nombreUnidad: '',
        }])}
        className="flex justify-between items-center px-2.5 py-2 border border-cocina-linea-suave rounded-cocina text-[13px] text-cocina-tinta-2 hover:bg-cocina-acento-bg"
      >
        <span className="inline-flex items-center gap-1.5"><Plus size={13} />
          {cosas.length === 0 ? 'Decir qué lleva' : 'Añadir otra cosa que lleve'}
        </span>
        <span className="text-[10.5px] font-bold tracking-[0.05em] uppercase text-cocina-tinta-3">pan, carne, salsa…</span>
      </button>

      <div className="flex gap-2 justify-end">
        <BotonCocina peso="fantasma" onClick={onCancelar}>Cancelar</BotonCocina>
        <BotonCocina
          // No se guarda un coste que se sabe que es mentira (B84.3).
          disabled={!completo || guardando || sinPrecio.length > 0}
          onClick={onGuardar}
        >
          {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : textoDeGuardar(elegidas.length)}
        </BotonCocina>
      </div>
    
    </>
  )
}

/** «Meraki Pita (3) y The Urban Kebab (4)» — el reparto real, no una lista. */
function repartoPorMarca(extra: ExtraPorNombre, elegidas: string[]): string {
  const m = new Map<string, number>()
  for (const c of extra.donde) {
    if (!elegidas.includes(c.opcion)) continue
    m.set(c.marca, (m.get(c.marca) ?? 0) + 1)
  }
  // Alfabético, como la maqueta y como la confirmación: el mismo reparto no
  // puede salir en dos órdenes distintos según qué caja lo pinte.
  const trozos = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([marca, n]) => `${marca} (${n})`)
  if (trozos.length <= 1) return trozos[0] ?? '—'
  return `${trozos.slice(0, -1).join(', ')} y ${trozos[trozos.length - 1]}`
}

export function PuertaDeCopias({
  extra, elegidas, onCambiar, onCancelar, onSeguir,
}: {
  extra: ExtraPorNombre
  elegidas: string[]
  onCambiar: (v: string[]) => void
  onCancelar: () => void
  onSeguir: () => void
}) {
  const fuera = extra.donde.filter((c) => !elegidas.includes(c.opcion))
  return (
    <>
      <p className="text-[12.5px] text-cocina-tinta-2 leading-[1.5]">
        Las copias cobran distinto, así que puede que no sean lo mismo. Elige a cuáles
        se les pone lo que lleva. Preseleccionadas las que cobran como la que más se vende.
      </p>

      <div className="flex flex-col gap-1.5">
        {extra.donde.map((c) => {
          const on = elegidas.includes(c.opcion)
          return (
            <button
              key={c.opcion}
              type="button"
              onClick={() => onCambiar(on ? elegidas.filter((x) => x !== c.opcion) : [...elegidas, c.opcion])}
              className={`grid items-center gap-2.5 px-2.5 py-2 border rounded-cocina text-left ${
                on ? 'border-cocina-acento bg-cocina-acento-bg' : 'border-cocina-linea-suave'
              }`}
              style={{ gridTemplateColumns: '24px minmax(0,1fr) 90px 70px' }}
            >
              <span className={`w-4 h-4 rounded-cocina border-[1.5px] inline-block ${
                on ? 'bg-cocina-acento border-cocina-acento' : 'border-cocina-linea'
              }`} />
              <span className="text-[13px] text-cocina-tinta truncate">{c.marca} · «{c.grupo}»</span>
              <span className="num text-[13px] text-right text-cocina-tinta">{eur(c.precio)} €</span>
              <span className="num text-[13px] text-right text-cocina-tinta-3">
                {c.vendidas > 0 ? `${c.vendidas} vend.` : '0'}
              </span>
            </button>
          )
        })}
      </div>

      {/* Por qué se queda fuera: dejarla desmarcada sin decirlo esconde una
          decisión (regla 8). */}
      {fuera.length > 0 && (
        <p className="text-[12.5px] text-cocina-tinta-2 leading-[1.5]">
          {porQueSeQuedaFuera({ ...extra, donde: extra.donde }, fuera[0])}
        </p>
      )}

      <div className="flex gap-2 justify-end">
        <BotonCocina peso="fantasma" onClick={onCancelar}>Cancelar</BotonCocina>
        <BotonCocina disabled={elegidas.length === 0} onClick={onSeguir}>
          Seguir con {elegidas.length} {elegidas.length === 1 ? 'copia' : 'copias'}
        </BotonCocina>
      </div>
    </>
  )
}

/** Una de las cosas que lleva: el selector de B72, con su etiqueta. */
function UnaCosaQueLleva({
  cosa, catalogo, unidades, sePuedeQuitar, onCambiar, onQuitar,
}: {
  cosa: CosaQueLleva
  catalogo: CatalogPick[]
  unidades: UnidadPick[]
  /** La papelera sólo cuando hay algo que quitar: con una sola cosa, quitarla
      es cancelar, y un botón que hace lo mismo que otro sólo estorba. */
  sePuedeQuitar: boolean
  onCambiar: (c: CosaQueLleva) => void
  onQuitar: () => void
}) {
  const [busca, setBusca] = useState('')
  const elegibles = useMemo(
    () => catalogo.filter((c) => c.selectable && TIPOS_ELEGIBLES.includes(c.type)),
    [catalogo],
  )
  const candidatas = useMemo(() => {
    if (!busca.trim()) return []
    const q = normName(busca)
    return elegibles.filter((c) => normName(c.name).includes(q)).slice(0, 8)
  }, [busca, elegibles])

  const ficha = catalogo.find((c) => c.id === cosa.ficha)

  return (
    // Sin marco propio: la caja de dentro ya lo lleva, y el de fuera era un
    // segundo borde que la maqueta no tiene. Lo que separa dos cosas es la
    // línea de arriba, no una caja alrededor de cada una.
    // Los mismos huecos que la maqueta: 12 px entre bloques (`.gate`) y 5 px
    // entre una etiqueta y su caja (`.field`). Con un solo hueco de 8 px para
    // todo, la etiqueta se despegaba de su campo y los campos se pegaban entre
    // sí — el bloque dejaba de leerse como «esto va con esto».
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-bold tracking-[0.06em] uppercase text-cocina-tinta-3">Lleva</span>
          {sePuedeQuitar && (
            <button type="button" onClick={onQuitar} className="text-cocina-tinta-3 hover:text-cocina-rojo">
              <Trash2 size={13} />
            </button>
          )}
        </div>

      {ficha ? (
        <div className="h-9 border border-cocina-linea rounded-cocina px-2.5 flex items-center gap-2 text-[13px]">
          <span className="truncate text-cocina-tinta">{ficha.name}</span>
          {/* «plato» / «ingrediente», nunca `dish`/`raw`: la mitad del arreglo
              de B72 vive en esta etiqueta. Buscando «patatas» salen la patata
              cruda a granel y la ración terminada. */}
          <PastillaCocina tono="apagado">{kindOf(ficha.type)}</PastillaCocina>
        </div>
      ) : (
        <>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar un ingrediente o un plato…"
            className="h-9 border border-cocina-linea rounded-cocina px-2.5 text-[13px] bg-cocina-superficie outline-none focus:border-cocina-acento"
          />
          {candidatas.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                const esPlato = kindOf(c.type) === 'plato'
                const ud = unidades.find((u) => u.id === c.baseUnitId)
                onCambiar({
                  ...cosa, ficha: c.id, nombreFicha: c.name, tipo: esPlato ? 'plato' : 'ingrediente',
                  cantidad: esPlato ? 1 : cosa.cantidad,
                  // B84.4: la unidad la trae la ficha. Dejarla en «—» obligaba a
                  // elegirla a mano sabiendo en qué se mide un yogur, y un
                  // desplegable en blanco al lado de una cantidad escrita es
                  // media orden dada: 40 de nada.
                  unidad: c.baseUnitId ?? cosa.unidad,
                  nombreUnidad: ud?.abreviatura ?? cosa.nombreUnidad,
                })
                setBusca('')
              }}
              className="flex justify-between items-center px-2.5 py-1.5 border border-cocina-linea-suave rounded-cocina text-[13px] hover:bg-cocina-acento-bg"
            >
              <span className="truncate text-cocina-tinta">{c.name}</span>
              <PastillaCocina tono="apagado">{kindOf(c.type)}</PastillaCocina>
            </button>
          ))}
        </>
      )}
      </div>

      {/* Un plato entero no pide cantidad: es una ración de ese plato. */}
      {ficha && cosa.tipo === 'ingrediente' && (
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold tracking-[0.06em] uppercase text-cocina-tinta-3">Cantidad</span>
            <input
              type="number" inputMode="decimal" value={cosa.cantidad ?? ''}
              onChange={(e) => onCambiar({ ...cosa, cantidad: e.target.value === '' ? null : Number(e.target.value) })}
              className="h-9 border border-cocina-linea rounded-cocina px-2.5 text-[13px] bg-cocina-superficie outline-none focus:border-cocina-acento"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold tracking-[0.06em] uppercase text-cocina-tinta-3">Unidad</span>
            <select
              value={cosa.unidad ?? ''}
              onChange={(e) => {
                const u = unidades.find((x) => x.id === e.target.value)
                onCambiar({ ...cosa, unidad: e.target.value || null, nombreUnidad: u?.abreviatura ?? '' })
              }}
              className="h-9 border border-cocina-linea rounded-cocina px-2.5 text-[13px] bg-cocina-superficie outline-none focus:border-cocina-acento"
            >
              <option value="">—</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.abreviatura}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
