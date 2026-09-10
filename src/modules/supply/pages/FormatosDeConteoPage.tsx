// src/modules/supply/pages/FormatosDeConteoPage.tsx
//
// PANTALLA 5 de la maqueta aprobada el 10/09/2026:
// «Deja claros los formatos antes de contar».
//
// EL PROBLEMA QUE RESUELVE, con los números medidos el 10/09 en Foodint: de
// los 194 artículos que se cuentan, 26 tienen dos o más formatos que se llaman
// IGUAL y pesan DISTINTO —Pulled Pork tiene tres «Bolsa»: 1 kg, 1,3 kg y
// 4 kg— y 20 tienen un formato llamado «Ud», «Uni» o «Unidad» que no es una
// unidad: en Tortilla Maíz 12 cm, «Ud» son 20 tortillas; en Milanesa de
// Ternera, «Ud» es un CUARTO de milanesa. Quien cuenta 13 «Ud» de tortilla
// está apuntando 260, y nadie se entera.
//
// Folvy NO decide cuál es el bueno. Cuál de las tres bolsas de Pulled Pork
// llega hoy es un hecho del negocio, y un hecho del negocio no se adivina con
// una heurística: se pregunta. Hasta que alguien lo marque, ese artículo se
// cuenta en gramos y punto — que es peor de teclear pero no miente.
//
// REGLA 7 · esta pantalla se abre a propósito, así que no esconde filas: los
// artículos ya confirmados siguen en la lista, abajo. El umbral («primero los
// que más se cuentan») decide el ORDEN, nunca la existencia.
//
// REGLA 8 · cada acción confirma en pantalla con contenido: «Pulled Pork
// confirmado: se contará con Bolsa · 4 kg», no un visto.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listFormatReview,
  setUseInCount,
  renameFormat,
  archiveFormat,
  confirmItemFormats,
  formatLabel,
  type FormatReviewItem,
  type CountFormat,
} from '@/modules/supply/services/countFormatService'
import {
  PanelCocina, RotuloDePanel, CifraCocina, PastillaCocina, BotonCocina, CabeceraCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'

export default function FormatosDeConteoPage() {
  const { authUserId } = useApp()
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const [items, setItems] = useState<FormatReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const recargar = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let cancel = false
    // Dentro de la promesa y no en el cuerpo del efecto: ver la nota gemela en
    // `AprobarRecuento.tsx`. El lint se midió a los dos lados.
    void Promise.resolve().then(() => { if (!cancel) setLoading(true) })
    listFormatReview(activeAccountId)
      .then(r => { if (!cancel) { setItems(r); setError(null) } })
      .catch(e => { if (!cancel) setError(e instanceof Error ? e.message : 'No se pudo cargar.') })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [activeAccountId, accountsLoading, tick])

  const cifras = useMemo(() => ({
    repetidos: items.filter(i => i.problems.includes('repetido')).length,
    enganosos: items.filter(i => i.problems.includes('nombre_enganoso')).length,
    sinFormato: items.filter(i => i.problems.includes('sin_formato')).length,
    total: items.length,
  }), [items])

  const porRevisar = useMemo(
    () => items.filter(i => i.problems.length > 0 && !i.reviewedAt),
    [items],
  )
  const resueltos = useMemo(
    () => items.filter(i => i.problems.length === 0 || i.reviewedAt),
    [items],
  )

  async function accion(itemId: string, fn: () => Promise<void>, mensaje: string) {
    setBusy(itemId)
    setError(null)
    try {
      await fn()
      setFlash(mensaje)
      recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setBusy(null)
    }
  }

  if (accountsLoading || loading) {
    return (
      <div className="cocina cocina-pagina min-h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin text-cocina-acento" size={26} />
      </div>
    )
  }

  return (
    <div className="cocina cocina-pagina">
      <CabeceraCocina
        migaja="Almacén · Cómo se cuenta cada producto"
        pregunta="Deja claros los formatos antes de contar"
        regla={
          <>
            De los {cifras.total} productos que se cuentan en este negocio. Marca con qué formatos se
            cuenta cada uno: son los que verá el empleado en el móvil, uno por casilla, más «abierto o
            suelto» en su unidad. Los que no chocan con nada salen marcados solos. Los que se llaman
            igual y pesan distinto esperan a que alguien diga cuál es el bueno.
          </>
        }
      />

      {flash && (
        <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-verde-bg text-cocina-verde border border-cocina-verde/35 flex items-start justify-between gap-3">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} className="shrink-0 opacity-70">✕</button>
        </div>
      )}
      {error && (
        <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-rojo-bg text-cocina-rojo border border-cocina-rojo/35">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-px bg-cocina-linea-suave border border-cocina-linea rounded-cocina-md overflow-hidden shadow-cocina">
        <CifraCocina
          titulo="Formatos repetidos con distinto peso"
          valor={String(cifras.repetidos)}
          tono={cifras.repetidos > 0 ? 'malo' : undefined}
          pie={ejemploRepetido(items) ?? 'Ninguno: cada nombre pesa una sola cosa'}
        />
        <CifraCocina
          titulo="Formato con nombre engañoso"
          valor={String(cifras.enganosos)}
          pie={ejemploEnganoso(items) ?? 'Ninguno: ningún «Ud» esconde otra cosa'}
        />
        <CifraCocina
          titulo="Sin ningún formato"
          valor={String(cifras.sinFormato)}
          pie="Se contarán sólo en gramos, mililitros o unidades"
        />
      </div>

      <PanelCocina>
        <RotuloDePanel derecha="Primero los que más se cuentan">
          Por revisar · {porRevisar.length}
        </RotuloDePanel>
        {porRevisar.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Check size={26} className="text-cocina-verde mx-auto" />
            <p className="text-[15px] font-bold text-cocina-tinta mt-2">No hay formatos por revisar</p>
            <p className="text-[12.5px] text-cocina-tinta-3 mt-1">
              Los {cifras.total} productos que se cuentan tienen claro con qué se cuentan.
            </p>
          </div>
        ) : (
          porRevisar.map(it => (
            <FilaArticulo
              key={it.itemId}
              it={it}
              busy={busy === it.itemId}
              onToggle={(f, v) => accion(it.itemId,
                () => setUseInCount(f.id, v),
                v ? `${it.itemName}: «${formatLabel(f, it.baseUnit)}» sale ahora en el móvil.`
                  : `${it.itemName}: «${formatLabel(f, it.baseUnit)}» deja de salir en el móvil.`)}
              onRenombrar={(f, nombre) => accion(it.itemId,
                () => renameFormat(f.id, nombre),
                `${it.itemName}: «${f.name}» pasa a llamarse «${nombre}». El peso no cambia: ${formatLabel(f, it.baseUnit).slice(f.name.length + 3)}.`)}
              onArchivar={f => accion(it.itemId,
                () => archiveFormat(f.id),
                `${it.itemName}: «${formatLabel(f, it.baseUnit)}» archivado. No se ha borrado: los albaranes y pedidos antiguos siguen apuntando a él.`)}
              onConfirmar={() => accion(it.itemId,
                () => confirmItemFormats(it.itemId, authUserId ?? null),
                `${it.itemName} confirmado: ${resumenMarcados(it)}`)}
            />
          ))
        )}
      </PanelCocina>

      {/* Regla 7: lo resuelto no desaparece, baja. */}
      {resueltos.length > 0 && (
        <PanelCocina>
          <RotuloDePanel derecha="Se pueden volver a tocar">
            Ya claros · {resueltos.length}
          </RotuloDePanel>
          {resueltos.map(it => (
            <FilaArticulo
              key={it.itemId}
              it={it}
              busy={busy === it.itemId}
              compacta
              onToggle={(f, v) => accion(it.itemId,
                () => setUseInCount(f.id, v),
                v ? `${it.itemName}: «${formatLabel(f, it.baseUnit)}» sale ahora en el móvil.`
                  : `${it.itemName}: «${formatLabel(f, it.baseUnit)}» deja de salir en el móvil.`)}
              onRenombrar={(f, nombre) => accion(it.itemId,
                () => renameFormat(f.id, nombre), `${it.itemName}: «${f.name}» → «${nombre}».`)}
              onArchivar={f => accion(it.itemId,
                () => archiveFormat(f.id), `${it.itemName}: «${f.name}» archivado, no borrado.`)}
              onConfirmar={() => accion(it.itemId,
                () => confirmItemFormats(it.itemId, authUserId ?? null),
                `${it.itemName} confirmado: ${resumenMarcados(it)}`)}
            />
          ))}
        </PanelCocina>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

function FilaArticulo({
  it, busy, compacta, onToggle, onRenombrar, onArchivar, onConfirmar,
}: {
  it: FormatReviewItem
  busy: boolean
  compacta?: boolean
  onToggle: (f: CountFormat, v: boolean) => void
  onRenombrar: (f: CountFormat, nombre: string) => void
  onArchivar: (f: CountFormat) => void
  onConfirmar: () => void
}) {
  const [renombrando, setRenombrando] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const enganoso = it.problems.includes('nombre_enganoso')

  return (
    <div className={`flex gap-4 px-4 ${compacta ? 'py-2.5' : 'py-3.5'} border-b border-cocina-linea-suave last:border-0`}>
      <div className="w-[190px] shrink-0">
        <div className="text-[14px] font-bold text-cocina-tinta leading-tight">{it.itemName}</div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {it.problems.includes('repetido') && <PastillaCocina tono="rojo">Nombres repetidos</PastillaCocina>}
          {enganoso && <PastillaCocina tono="ambar">Nombre engañoso</PastillaCocina>}
          {it.problems.includes('sin_formato') && <PastillaCocina tono="apagado">Sin formato</PastillaCocina>}
          {it.reviewedAt && <PastillaCocina tono="verde">Confirmado</PastillaCocina>}
        </div>
        <div className="text-[11.5px] text-cocina-tinta-3 mt-1.5">
          {it.timesCounted} recuento{it.timesCounted === 1 ? '' : 's'} en 30 días
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-2">
          {it.formats.length === 0 && (
            <span className="text-[12.5px] text-cocina-tinta-3 italic">
              Ningún formato: se cuenta sólo en su unidad.
            </span>
          )}
          {it.formats.map(f => (
            <ChipFormato
              key={f.id}
              f={f}
              baseUnit={it.baseUnit}
              choca={chocaEste(f, it)}
              disabled={busy}
              onToggle={v => onToggle(f, v)}
              onPedirRenombrar={() => { setRenombrando(f.id); setNombre(f.name) }}
              onArchivar={() => onArchivar(f)}
            />
          ))}
        </div>

        {renombrando && (
          <div className="flex gap-2 items-center mt-2">
            <input
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Su nombre real («Paquete de 20»)"
              className="h-9 px-2.5 rounded-cocina border border-cocina-acento bg-cocina-superficie
                         text-[12.5px] text-cocina-tinta w-[230px]"
            />
            <BotonCocina
              peso="relleno"
              disabled={busy || !nombre.trim()}
              onClick={() => {
                const f = it.formats.find(x => x.id === renombrando)
                if (f) onRenombrar(f, nombre.trim())
                setRenombrando(null)
              }}
            >
              Guardar el nombre
            </BotonCocina>
            <BotonCocina peso="fantasma" onClick={() => setRenombrando(null)}>Dejarlo</BotonCocina>
          </div>
        )}

        {it.explanation && !compacta && (
          <p className="text-[12.5px] text-cocina-tinta-2 mt-2 leading-[1.5]">{it.explanation}</p>
        )}
      </div>

      <div className="shrink-0 flex items-start">
        <BotonCocina
          peso={it.formats.some(f => f.useInCount) ? 'relleno' : 'borde'}
          disabled={busy}
          onClick={onConfirmar}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          Confirmar
        </BotonCocina>
      </div>
    </div>
  )
}

/** ¿Este formato concreto es de los que chocan? Es el que va en ámbar. */
function chocaEste(f: CountFormat, it: FormatReviewItem): boolean {
  const n = f.name.trim().toLowerCase()
  if (['ud', 'uni', 'unidad', 'u'].includes(n) && f.qtyInBase !== 1) return true
  return it.formats.some(o => o.id !== f.id
    && o.name.trim().toLowerCase() === n
    && o.qtyInBase !== f.qtyInBase)
}

function ChipFormato({
  f, baseUnit, choca, disabled, onToggle, onPedirRenombrar, onArchivar,
}: {
  f: CountFormat
  baseUnit: string | null
  choca: boolean
  disabled: boolean
  onToggle: (v: boolean) => void
  onPedirRenombrar: () => void
  onArchivar: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const base = choca
    ? 'border-cocina-ambar bg-cocina-ambar-bg/50 text-cocina-ambar'
    : 'border-cocina-linea bg-cocina-superficie text-cocina-tinta-2'
  const marcado = f.useInCount
    ? 'border-cocina-acento bg-cocina-acento-bg text-cocina-acento-ink font-semibold'
    : base
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onToggle(!f.useInCount)}
        onContextMenu={e => { e.preventDefault(); setAbierto(v => !v) }}
        className={`inline-flex items-center gap-2 px-2.5 py-[6px] rounded-cocina border text-[12.5px] ${marcado}`}
      >
        <span className={`w-3.5 h-3.5 rounded-[2px] border flex items-center justify-center ${
          f.useInCount ? 'bg-cocina-acento border-cocina-acento' : 'border-current opacity-60'
        }`}>
          {f.useInCount && <Check size={10} className="text-white" strokeWidth={3} />}
        </span>
        {formatLabel(f, baseUnit)}
        {choca && <AlertTriangle size={11} className="opacity-70" />}
      </button>
      <button
        type="button"
        aria-label={`Más opciones de ${f.name}`}
        onClick={() => setAbierto(v => !v)}
        className="px-1.5 text-cocina-tinta-3 text-[13px]"
      >
        ⋯
      </button>
      {abierto && (
        <span className="absolute z-10 top-full left-0 mt-1 flex flex-col bg-cocina-superficie border border-cocina-linea rounded-cocina shadow-cocina min-w-[180px]">
          <button
            type="button"
            onClick={() => { setAbierto(false); onPedirRenombrar() }}
            className="text-left px-3 py-2 text-[12.5px] text-cocina-tinta hover:bg-cocina-superficie-2"
          >
            Renombrar
          </button>
          <button
            type="button"
            onClick={() => { setAbierto(false); onArchivar() }}
            className="text-left px-3 py-2 text-[12.5px] text-cocina-rojo hover:bg-cocina-superficie-2"
          >
            Archivar (no se borra)
          </button>
        </span>
      )}
    </span>
  )
}

// ─── Los pies de las tres cifras, con un ejemplo REAL de la cuenta ─────────
// Un pie con un ejemplo inventado sería una frase bonita; con el nombre del
// artículo que lo tiene, es una pista de dónde mirar.

function ejemploRepetido(items: FormatReviewItem[]): string | null {
  const it = items.find(i => i.problems.includes('repetido'))
  if (!it) return null
  const grupos = new Map<string, CountFormat[]>()
  for (const f of it.formats) {
    const k = f.name.trim().toLowerCase()
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  const peor = [...grupos.values()].filter(v => new Set(v.map(f => f.qtyInBase)).size > 1)[0]
  if (!peor) return null
  const pesos = [...new Set(peor.map(f => f.qtyInBase))].sort((a, b) => a - b)
  return `${pesos.length} ${peor[0].name.toLowerCase()}s de ${it.itemName}: ` +
    pesos.map(v => formatLabel({ ...peor[0], qtyInBase: v }, it.baseUnit).split(' · ').pop()).join(', ')
}

function ejemploEnganoso(items: FormatReviewItem[]): string | null {
  const it = items.find(i => i.problems.includes('nombre_enganoso'))
  if (!it) return null
  const f = it.formats.find(x => ['ud', 'uni', 'unidad', 'u'].includes(x.name.trim().toLowerCase()) && x.qtyInBase !== 1)
  if (!f) return null
  return `En ${it.itemName} se llama «${f.name}» y son ${formatLabel(f, it.baseUnit).split(' · ').pop()}`
}

function resumenMarcados(it: FormatReviewItem): string {
  const marcados = it.formats.filter(f => f.useInCount)
  if (marcados.length === 0) {
    return 'no sale ningún formato en el móvil, así que se contará sólo en su unidad.'
  }
  return `se contará con ${marcados.map(f => `«${formatLabel(f, it.baseUnit)}»`).join(' y ')}.`
}
