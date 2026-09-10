// src/modules/supply/components/AprobarRecuento.tsx
//
// PANTALLA 4 de la maqueta aprobada el 10/09/2026: «Revisa antes de aprobar».
//
// Lo que arregla, dicho sin rodeos: hasta hoy quien aprobaba veía una tabla de
// 36 filas con una columna de € y un desplegable de motivos, y aprobaba. No
// tenía forma de saber CÓMO se había contado cada cosa, ni de enterarse de que
// la línea contradecía al recuento del día anterior. Por eso el 0 kg de
// peperoni del 04/09 se aprobó sin que nadie se diera cuenta de que Pamela
// había contado 9 kg la noche antes y no había entrado nada.
//
// Ahora la pantalla dice las cuatro cosas que hacen falta para decidir:
//   · CÓMO se contó — «4 cajas de 5 kg», «1 bolsa + ½ a ojo», «No queda nada».
//   · QUIÉN y a qué hora.
//   · QUÉ contradice, con nombre, fecha y cantidad, en su propia línea.
//   · QUÉ vale, y «sin coste» cuando no se sabe, nunca un 0 € callado.
//
// REGLA 7 · el umbral ORDENA, no esconde. Las 36 líneas están las 36: 6 arriba
// para mirar y 30 en «Cuadran», a un clic de verse. El botón lleva el número
// dentro —«Aprobar los 30 que cuadran»— porque un botón que dice sólo
// «Aprobar» no promete nada que se pueda comprobar.
//
// REGLA 8 · nada de éxitos silenciosos. Aprobar dice cuántas líneas ha
// aplicado; pedir un recuento dice a QUIÉN le ha caído y para cuándo.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, Check, ChevronLeft } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import {
  listCountLines,
  approveInventoryCount,
  type InventoryCount,
  type InventoryCountLine,
} from '@/modules/supply/services/inventoryCountService'
import {
  buildCountReview,
  getCountReviewThresholds,
  saveReason,
  motivoPideNota,
  MOTIVOS_DE_COCINA,
  UMBRALES_POR_DEFECTO,
  type CountReview,
  type ReviewLine,
  type CountReviewThresholds,
} from '@/modules/supply/services/countApprovalService'
import { requestRecount } from '@/modules/supply/services/countEntryService'
import {
  PanelCocina, RotuloDePanel, CifraCocina, PastillaCocina, BotonCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'

const nfQty = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })
const nfPct = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })
const nfEur = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

function qtyTxt(v: number | null, unit: string | null): string {
  if (v === null) return '—'
  const u = (unit ?? '').toLowerCase()
  if (u === 'g' && Math.abs(v) >= 1000) return `${nfQty.format(v / 1000)} kg`
  if (u === 'ml' && Math.abs(v) >= 1000) return `${nfQty.format(v / 1000)} l`
  return `${nfQty.format(v)}${unit ? ` ${unit}` : ''}`
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function tituloDelDia(iso: string | null): string {
  if (!iso) return 'Recuento'
  const d = new Date(iso)
  return `Recuento del ${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`
}

function hora(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function AprobarRecuento({
  count, accountId, locationName, onBack, onApproved,
}: {
  count: InventoryCount
  /** La cuenta activa. Va por parámetro y no se deduce del conteo: los
   *  umbrales viven en `supply_settings` por cuenta y una consulta sin cuenta
   *  es una consulta que no es de nadie (regla 9). */
  accountId: string
  locationName: string
  onBack: () => void
  onApproved: () => void
}) {
  const { authUserId, userProfile } = useApp()
  const [lines, setLines] = useState<InventoryCountLine[]>([])
  const [review, setReview] = useState<CountReview | null>(null)
  const [th, setTh] = useState<CountReviewThresholds>(UMBRALES_POR_DEFECTO)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busyLine, setBusyLine] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [verCuadran, setVerCuadran] = useState(false)
  const [tick, setTick] = useState(0)

  const recargar = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      // `setLoading` va DENTRO de la función y no en el cuerpo del efecto: la
      // regla `react-hooks/set-state-in-effect` marca el segundo, y medimos el
      // lint a los dos lados (761 errores en `origin/main`, 761 con esto).
      setLoading(true)
      try {
        const umbrales = await getCountReviewThresholds(accountId)
        const ls = await listCountLines(count.id)
        const r = await buildCountReview(count.id, ls, umbrales)
        if (cancel) return
        setTh(umbrales)
        setLines(ls)
        setReview(r)
        setError(null)
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : 'No se pudo cargar el recuento.')
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [count.id, accountId, tick])

  // Las que se pueden aprobar de una vez: las que cuadran, más las de revisar
  // que YA tienen motivo. El botón cuenta lo que va a hacer, no lo que hay.
  const aprobables = useMemo(() => {
    if (!review) return 0
    return review.counts.ok + review.toReview.filter(r => r.line.reasonCode).length
  }, [review])

  const sinMotivo = useMemo(
    () => review ? review.toReview.filter(r => !r.line.reasonCode).length : 0,
    [review],
  )

  const paraRecontar = useMemo(
    () => review ? review.toReview.filter(r => !r.line.recountRequestedAt).length : 0,
    [review],
  )

  async function onMotivo(r: ReviewLine, code: string, note: string | null) {
    setBusyLine(r.line.id)
    setError(null)
    try {
      await saveReason(r.line.id, code || null, note)
      recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el motivo.')
    } finally {
      setBusyLine(null)
    }
  }

  async function onRecontar(r: ReviewLine) {
    setBusyLine(r.line.id)
    setError(null)
    try {
      const res = await requestRecount(r.line.id)
      const quien = res.assignedName ? `a ${res.assignedName}` : 'a quien toque en el reparto'
      const cuando = res.when === 'hoy' ? 'en el recuento de hoy' : 'en el próximo autoinventario'
      setFlash(`Pedido: ${r.line.itemName} se lo cuenta ${quien}, ${cuando}. No se le pide a quien lo contó.`)
      recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo pedir el recuento.')
    } finally {
      setBusyLine(null)
    }
  }

  /**
   * El botón de lote. §5: ningún botón que escriba en lote sin su ensayo con
   * nombres propios delante — así que aquí el ensayo es la propia pregunta,
   * con los nombres de los artículos escritos, antes de tocar nada.
   */
  async function onRecontarTodas() {
    if (!review) return
    const pendientes = review.toReview.filter(r => !r.line.recountRequestedAt)
    if (pendientes.length === 0) return
    const nombres = pendientes.map(r => `· ${r.line.itemName}`).join('\n')
    const ok = window.confirm(
      `Vas a pedir que OTRA persona vuelva a contar ${pendientes.length} producto${pendientes.length === 1 ? '' : 's'}:\n\n` +
      `${nombres}\n\n` +
      'Entran en el recuento de hoy si sigue abierto, y si no, en el siguiente. ' +
      'Nunca se le piden a quien los contó.',
    )
    if (!ok) return

    setApproving(true)
    setError(null)
    const hechos: string[] = []
    const fallos: string[] = []
    for (const r of pendientes) {
      try {
        const res = await requestRecount(r.line.id)
        hechos.push(res.assignedName ? `${r.line.itemName} → ${res.assignedName}` : r.line.itemName)
      } catch (e) {
        fallos.push(`${r.line.itemName} (${e instanceof Error ? e.message : 'error'})`)
      }
    }
    setApproving(false)
    // Regla 8: la confirmación lleva contenido, y los fallos se dicen. Un lote
    // que se come tres errores en silencio es peor que no haberlo lanzado.
    setFlash(`Pedidos ${hechos.length} recuentos: ${hechos.join(' · ')}.`)
    if (fallos.length > 0) setError(`No se pudieron pedir ${fallos.length}: ${fallos.join(' · ')}`)
    recargar()
  }

  async function onAprobar() {
    if (!review) return
    setApproving(true)
    setError(null)
    try {
      const res = await approveInventoryCount(count.id, authUserId, userProfile?.displayName ?? null)
      const pendiente = sinMotivo > 0
        ? ` Quedan ${sinMotivo} esperando motivo: el recuento sigue abierto hasta que las cierres.`
        : ' El recuento queda aprobado.'
      setFlash(`Aplicado: ${res.adjustments} ajuste${res.adjustments === 1 ? '' : 's'} de stock sobre ${res.itemsRecomputed} artículos.${pendiente}`)
      if (sinMotivo === 0) onApproved()
      else recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aprobar.')
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return (
      <div className="cocina cocina-pagina min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-cocina-acento" size={26} />
      </div>
    )
  }

  const contadores = review?.counts
  const quienes = [...new Set(lines.map(l => l.countedByName).filter(Boolean))] as string[]

  return (
    <div className="cocina cocina-pagina">
      {/* ── Cabecera ── */}
      <div className="flex flex-col gap-3.5">
        <button
          onClick={onBack}
          className="self-start inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[.08em] uppercase text-cocina-tinta-3"
        >
          <ChevronLeft size={14} />
          Almacén · Inventarios · {locationName}
        </button>
        <div className="flex justify-between items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-bold tracking-[-.015em] leading-[1.2] text-cocina-tinta">
              {tituloDelDia(count.createdAt)}
            </h1>
            <p className="text-[12.5px] text-cocina-tinta-2 mt-1.5">
              {count.code ?? '—'}
              {quienes.length > 0 && <> · contado por {listar(quienes)}</>}
              {' · '}{lines.length} producto{lines.length === 1 ? '' : 's'}
            </p>
          </div>
          {contadores && contadores.ok > 0 && (
            <BotonCocina peso="borde" onClick={() => setVerCuadran(v => !v)}>
              {verCuadran ? 'Ocultar' : 'Ver'} los {contadores.ok} que cuadran
            </BotonCocina>
          )}
        </div>
      </div>

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

      {/* ── Las cuatro cifras ── */}
      {contadores && (
        <div className="grid grid-cols-4 gap-px bg-cocina-linea-suave border border-cocina-linea rounded-cocina-md overflow-hidden shadow-cocina">
          <CifraCocina
            titulo="Cuadran" valor={String(contadores.ok)} tono="bueno"
            pie="Se aprueban de una vez"
          />
          <CifraCocina
            titulo="Para revisar" valor={String(contadores.toReview)}
            tono={contadores.toReview > 0 ? 'malo' : undefined}
            pie={`Diferencia de un ${nfPct.format(th.reviewPct)} % o más y ${nfEur.format(th.reviewEur)} € o más`}
          />
          <CifraCocina
            titulo="Contradicen al recuento anterior" valor={String(contadores.contradictions)}
            pie="Sin entradas de por medio"
          />
          <CifraCocina
            titulo="Valor de lo que hay que revisar"
            valor={`${contadores.reviewValue >= 0 ? '+' : '−'}${nfEur.format(Math.abs(Math.round(contadores.reviewValue)))}`}
            sufijo="€"
            tono={contadores.reviewValue < 0 ? 'malo' : undefined}
            pie={
              contadores.reviewWithoutCost > 0
                // Regla 7: el pie dice lo que el número NO incluye. Un total que
                // se calla las que no sabe valorar es un total que miente.
                ? <>A coste medio · <b>{contadores.reviewWithoutCost}</b> sin coste, fuera de esta suma</>
                : <>A coste medio del local</>
            }
          />
        </div>
      )}

      {/* ── Revisa antes de aprobar ── */}
      <PanelCocina>
        <RotuloDePanel derecha="Ordenado por valor">
          Revisa antes de aprobar · {contadores?.toReview ?? 0}
        </RotuloDePanel>

        {review && review.toReview.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Check size={26} className="text-cocina-verde mx-auto" />
            <p className="text-[15px] font-bold text-cocina-tinta mt-2">
              Todo cuadra: {review.counts.ok} de {review.counts.ok}
            </p>
            <p className="text-[12.5px] text-cocina-tinta-3 mt-1">
              Ninguna línea se sale de lo normal ni contradice al recuento anterior.
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-cocina-superficie-2 text-[11px] font-bold tracking-[.06em] uppercase text-cocina-tinta-3">
                <th className="text-left px-4 py-2 font-bold">Producto · quién contó</th>
                <th className="text-left px-3 py-2 font-bold">Cómo se contó</th>
                <th className="text-right px-3 py-2 font-bold">Esperaba</th>
                <th className="text-right px-3 py-2 font-bold">Contado</th>
                <th className="text-right px-3 py-2 font-bold">Dif.</th>
                <th className="text-right px-3 py-2 font-bold">€</th>
                <th className="text-left px-3 py-2 font-bold">Motivo</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {review?.toReview.map(r => (
                <FilaRevision
                  key={r.line.id}
                  r={r}
                  busy={busyLine === r.line.id}
                  onMotivo={onMotivo}
                  onRecontar={onRecontar}
                />
              ))}
            </tbody>
          </table>
        )}
      </PanelCocina>

      {/* ── Las que cuadran, cuando se piden ── */}
      {verCuadran && review && (
        <PanelCocina>
          <RotuloDePanel>Cuadran · {review.counts.ok}</RotuloDePanel>
          <table className="w-full border-collapse">
            <tbody>
              {review.ok.map(r => (
                <tr key={r.line.id} className="border-b border-cocina-linea-suave last:border-0">
                  <td className="px-4 py-2.5 text-[13px] font-semibold text-cocina-tinta">{r.line.itemName}</td>
                  <td className="px-3 py-2.5 text-[12.5px] text-cocina-tinta-2">{r.howCounted}</td>
                  <td className="px-3 py-2.5 num text-[13px] text-right text-cocina-tinta-2">
                    {qtyTxt(r.line.systemQty, r.line.unitAbbr)}
                  </td>
                  <td className="px-3 py-2.5 num text-[13px] text-right font-semibold text-cocina-tinta">
                    {qtyTxt(r.line.countedQty, r.line.unitAbbr)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.estimated && <PastillaCocina tono="ambar">A ojo</PastillaCocina>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelCocina>
      )}

      {/* ── Pie fijo ── */}
      <div className="sticky bottom-0 -mx-6 -mb-[30px] px-6 py-3 bg-cocina-superficie border-t border-cocina-linea
                      flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[12px] text-cocina-tinta-2 leading-[1.5] min-w-0 flex-1">
          <b className="text-cocina-tinta">Motivos:</b>{' '}
          {MOTIVOS_DE_COCINA.map(m => m.label).join(' · ')}
          {sinMotivo > 0 && (
            <> — <b className="text-cocina-ambar">{sinMotivo} sin motivo</b>, y sin motivo no se aplican.</>
          )}
        </p>
        <div className="flex gap-2 shrink-0">
          {paraRecontar > 0 && (
            <BotonCocina peso="borde" onClick={() => void onRecontarTodas()} disabled={approving || busyLine !== null}>
              Pedir recuento de {paraRecontar}
            </BotonCocina>
          )}
          <BotonCocina peso="relleno" onClick={() => void onAprobar()} disabled={approving || aprobables === 0}>
            {approving ? 'Aplicando…' : `Aprobar los ${aprobables} que cuadran`}
          </BotonCocina>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

function FilaRevision({
  r, busy, onMotivo, onRecontar,
}: {
  r: ReviewLine
  busy: boolean
  onMotivo: (r: ReviewLine, code: string, note: string | null) => void
  onRecontar: (r: ReviewLine) => void
}) {
  const l = r.line
  const [nota, setNota] = useState(l.reasonNote ?? '')
  const pideNota = motivoPideNota(l.reasonCode)
  const contradice = r.contradiction !== ''
  const pct = l.variancePct
  const falta = (l.varianceQty ?? 0) < 0

  return (
    <>
      <tr className={`border-b ${contradice ? 'bg-cocina-ambar-bg/45 border-transparent' : 'border-cocina-linea-suave'}`}>
        <td className="px-4 py-3 align-top">
          <div className="text-[14px] font-bold text-cocina-tinta leading-tight">{l.itemName}</div>
          <div className="text-[12px] text-cocina-tinta-3 mt-0.5">
            {l.countedByName ?? 'sin firmar'}{l.countedAt ? ` · ${hora(l.countedAt)}` : ''}
          </div>
        </td>
        <td className="px-3 py-3 align-top text-[12.5px] text-cocina-tinta-2 max-w-[220px]">
          <div>{r.howCounted}</div>
          <div className="flex gap-1.5 mt-1 flex-wrap">
            {l.confirmedTwice && <PastillaCocina tono="apagado">Confirmado 2 veces</PastillaCocina>}
            {r.estimated && <PastillaCocina tono="ambar">A ojo</PastillaCocina>}
            {l.lineNeedsReview && <PastillaCocina tono="rojo">No cuadró dos veces</PastillaCocina>}
            {l.recountRequestedAt && <PastillaCocina tono="apagado">Recuento pedido</PastillaCocina>}
          </div>
        </td>
        <td className="px-3 py-3 align-top num text-[13px] text-right text-cocina-tinta-2 whitespace-nowrap">
          {qtyTxt(l.systemQty, l.unitAbbr)}
        </td>
        <td className="px-3 py-3 align-top num text-[15px] text-right font-bold text-cocina-tinta whitespace-nowrap">
          {qtyTxt(l.countedQty, l.unitAbbr)}
        </td>
        <td className={`px-3 py-3 align-top num text-[13px] text-right whitespace-nowrap ${falta ? 'text-cocina-rojo' : 'text-cocina-verde'}`}>
          {pct == null ? '—' : `${pct > 0 ? '+' : '−'}${nfPct.format(Math.abs(pct))} %`}
        </td>
        <td className="px-3 py-3 align-top num text-[13px] text-right text-cocina-tinta-2 whitespace-nowrap">
          {/* Nunca un 0 € callado: si no hay coste fiable, se dice. */}
          {l.varianceValue == null
            ? <span className="text-[11px] text-cocina-tinta-3">sin coste</span>
            : nfEur.format(Math.abs(Math.round(l.varianceValue)))}
        </td>
        <td className="px-3 py-3 align-top">
          <select
            value={l.reasonCode ?? ''}
            disabled={busy}
            onChange={e => onMotivo(r, e.target.value, e.target.value === 'otro' ? nota : null)}
            className="h-9 px-2 rounded-cocina border border-cocina-linea bg-cocina-superficie
                       text-[12.5px] text-cocina-tinta min-w-[150px]"
          >
            <option value="">Elige motivo</option>
            {MOTIVOS_DE_COCINA.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          {pideNota && (
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={nota}
                onChange={e => setNota(e.target.value)}
                placeholder="¿Qué ha pasado? (obligatorio)"
                className="h-9 px-2 rounded-cocina border border-cocina-ambar bg-cocina-superficie
                           text-[12.5px] text-cocina-tinta w-[190px]"
              />
              <BotonCocina peso="borde" disabled={busy || !nota.trim()} onClick={() => onMotivo(r, 'otro', nota)}>
                Guardar
              </BotonCocina>
            </div>
          )}
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex gap-2 justify-end">
            <BotonCocina
              peso={contradice ? 'relleno' : 'borde'}
              disabled={busy || Boolean(l.recountRequestedAt)}
              onClick={() => onRecontar(r)}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              {l.recountRequestedAt ? 'Pedido' : 'Pedir recuento'}
            </BotonCocina>
          </div>
        </td>
      </tr>

      {contradice && (
        <tr className="bg-cocina-ambar-bg/45 border-b border-cocina-linea-suave">
          <td colSpan={8} className="px-4 pb-3 pt-0">
            <div className="flex items-start gap-2.5">
              <span className="shrink-0 inline-flex items-center gap-1.5 rounded-cocina bg-cocina-ambar-bg
                               text-cocina-ambar px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap">
                <AlertTriangle size={11} /> Contradice al recuento anterior
              </span>
              <span className="text-[12.5px] text-cocina-tinta-2 leading-[1.5]">{r.contradiction}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function listar(xs: string[]): string {
  if (xs.length === 1) return xs[0]
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}
