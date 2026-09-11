// src/modules/supply/components/CorregirAhoraModal.tsx
//
// «CORREGIR AHORA» · la oficina llama, cocina cuenta, la oficina apunta.
//
// Idea de Julio, 11/09/2026 08:20: «Si hay una cantidad mala, desde oficina se
// llama a cocina, se cuenta en ese momento y se corrige.»
//
// Las MISMAS CASILLAS que la pantalla de contar —cajas, bolsas, lo abierto—
// porque quien está al teléfono va a leer en voz alta lo mismo que leería el
// móvil, y traducirlo a un campo de «cantidad total» es donde se pierde el
// cómo. Aquí no se multiplica nada: el servidor recibe el CÓMO y decide el
// CUÁNTO, igual que en el móvil (`save_count_line`).
//
// ── Lo que esta pantalla SÍ enseña y el móvil NO ──────────────────────────
// LO ESPERADO, en gris bajo el total. El freno ciego existe para que quien
// cuenta no sepa la cifra y la confirme en vez de contarla; aquí quien teclea
// es la oficina, que ya la está viendo en la fila de al lado. Por eso Julio lo
// dijo con todas las letras: «quien llama no dice la cifra esperada a quien
// cuenta; ponlo en gris bajo la casilla».
//
// La red de cordura (FV001, cifras imposibles) SÍ sigue puesta, y se pasa
// confirmándola a mano, igual que en el móvil.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import {
  saveCountLine,
  AbsurdQuantityError,
  AppCaducadaError,
  type CountEntryInput,
} from '@/modules/supply/services/countEntryService'
import { listCountFormats, type CountFormat } from '@/modules/supply/services/countFormatService'
import { BotonCocina } from '@/modules/kitchen/components/PatronDeKitchen'

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })

// Espacio de NO SEPARACIÓN entre la cifra y su unidad, igual que en el resto
// de la aplicación: «750 g» no se parte al final de una línea. Va escapado
// —`\u00A0`— y no tecleado: el lint lo marca, y con razón, porque un espacio
// raro invisible dentro del código es de lo más difícil de encontrar.
function qtyTxt(v: number, unit: string | null): string {
  const u = (unit ?? '').toLowerCase()
  if (u === 'g' && Math.abs(v) >= 1000) return `${nf.format(v / 1000)}\u00A0kg`
  if (u === 'ml' && Math.abs(v) >= 1000) return `${nf.format(v / 1000)}\u00A0l`
  return `${nf.format(v)}${unit ? `\u00A0${unit}` : ''}`
}

export interface PersonaDelLocal { id: string; name: string }

type Abierto =
  | { modo: 'peso'; gramos: string }
  | { modo: 'ojo'; fraccion: number | null; otros: string }

export default function CorregirAhoraModal({
  lineId, recipeItemId, itemName, baseUnit, systemQty, countedQty, plantilla, onCerrar, onCorregido,
}: {
  lineId: string
  /** El artículo, para cargar SUS formatos de conteo. */
  recipeItemId: string
  itemName: string
  baseUnit: string | null
  /** Lo que Folvy espera. Se ENSEÑA, en gris: la oficina ya lo tiene delante. */
  systemQty: number | null
  /** Lo que hay apuntado ahora, para poder decir de qué se viene. */
  countedQty: number | null
  /** La plantilla activa del local. El servidor comprueba que sea de ahí. */
  plantilla: PersonaDelLocal[]
  onCerrar: () => void
  onCorregido: (msg: string) => void
}) {
  const [formats, setFormats] = useState<CountFormat[]>([])
  const [cargando, setCargando] = useState(true)
  const [quien, setQuien] = useState('')
  const [cuenta, setCuenta] = useState<Record<string, number>>({})
  const [abierto, setAbierto] = useState<Abierto>({ modo: 'peso', gramos: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** La red de cordura ha frenado: hay que confirmar ESTE total, no otro. */
  const [aConfirmar, setAConfirmar] = useState<number | null>(null)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setCargando(true)
      try {
        const fs = await listCountFormats(recipeItemId)
        if (!cancel) setFormats(fs)
      } catch {
        if (!cancel) setFormats([])
      } finally {
        if (!cancel) setCargando(false)
      }
    })()
    return () => { cancel = true }
  }, [recipeItemId])

  // El formato que se abre es el más pequeño: nadie abre una caja de 10 kg
  // para servir, abre la bolsa.
  const formatoAbierto = useMemo(
    () => (formats.length > 0 ? formats[formats.length - 1] : null),
    [formats],
  )

  const total = useMemo(() => {
    let t = 0
    for (const f of formats) t += (cuenta[f.id] ?? 0) * f.qtyInBase
    if (abierto.modo === 'peso') {
      const g = Number(abierto.gramos.replace(',', '.'))
      if (Number.isFinite(g) && g > 0) t += g
    } else {
      const ref = formatoAbierto
      if (ref) {
        if (abierto.fraccion != null) t += abierto.fraccion * ref.qtyInBase
        else {
          const n = Number(abierto.otros.replace(',', '.'))
          if (Number.isFinite(n) && n > 0) t += n * ref.qtyInBase
        }
      }
    }
    return t
  }, [formats, cuenta, abierto, formatoAbierto])

  const hayAlgo = useMemo(() => {
    if (formats.some(f => (cuenta[f.id] ?? 0) > 0)) return true
    if (abierto.modo === 'peso') return abierto.gramos.trim() !== ''
    return abierto.fraccion != null || abierto.otros.trim() !== ''
  }, [formats, cuenta, abierto])

  const nombreDeQuien = plantilla.find(p => p.id === quien)?.name ?? ''

  function construirEntradas(): CountEntryInput[] {
    const out: CountEntryInput[] = []
    for (const f of formats) {
      const n = cuenta[f.id] ?? 0
      if (n > 0) out.push({ method: 'formato', formatId: f.id, qty: n })
    }
    if (abierto.modo === 'peso') {
      const g = Number(abierto.gramos.replace(',', '.'))
      if (Number.isFinite(g) && g > 0) out.push({ method: 'peso', qty: g })
    } else if (formatoAbierto) {
      // «Otra» sigue siendo A OJO: va como fracción aunque pase de 1, para que
      // la aprobación lo marque. Mandarlo como 'formato' lo daría por medido.
      const n = abierto.fraccion ?? Number(abierto.otros.replace(',', '.'))
      if (Number.isFinite(n) && n > 0) {
        out.push({ method: 'fraccion', formatId: formatoAbierto.id, fraction: n })
      }
    }
    return out
  }

  async function guardar(confirmar?: number) {
    const entradas = construirEntradas()
    if (entradas.length === 0) {
      setError('No has apuntado nada. Si de verdad no queda nada, márcalo como cero.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const res = await saveCountLine(lineId, entradas, confirmar, quien, 'telefono')
      setGuardando(false)
      // REGLA 8 · la confirmación lleva CONTENIDO. «Hecho» no dice nada.
      onCorregido(
        `Corregido. ${nombreDeQuien.trim().split(/\s+/)[0]} ha contado ` +
        `${qtyTxt(res.counted, baseUnit)}, lo has apuntado tú.`,
      )
    } catch (e) {
      setGuardando(false)
      if (e instanceof AbsurdQuantityError) {
        // No se cambia de pantalla: se dice qué pasa y se deja corregir donde
        // tiene las manos, con la puerta de confirmarlo si de verdad es eso.
        setAConfirmar(total)
        setError(e.message)
        return
      }
      if (e instanceof AppCaducadaError) {
        setError(`${e.message} Recarga la página antes de seguir.`)
        return
      }
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-cocina-md bg-cocina-superficie shadow-xl">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-cocina-linea-suave">
          <div>
            <div className="text-[11px] font-bold tracking-[.08em] uppercase text-cocina-tinta-3">
              Corregir ahora
            </div>
            <div className="text-[19px] font-extrabold tracking-[-.01em] text-cocina-tinta leading-tight mt-0.5">
              {itemName}
            </div>
            <div className="text-[12.5px] text-cocina-tinta-2 mt-1 leading-[1.45]">
              Llama a cocina, que lo cuente ahora y apunta lo que te diga.
              Queda a su nombre, no al tuyo.
            </div>
          </div>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="shrink-0 rounded-cocina p-1.5 text-cocina-tinta-3 hover:bg-cocina-fondo"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-cocina-tinta">¿Quién lo ha contado?</span>
            <select
              value={quien}
              onChange={e => setQuien(e.target.value)}
              className="h-10 px-2 rounded-cocina border border-cocina-linea bg-cocina-superficie text-[13.5px] text-cocina-tinta"
            >
              <option value="">Elige a quien está contando</option>
              {plantilla.map(p => (
                <option key={p.id} value={p.id}>{p.name.trim()}</option>
              ))}
            </select>
            {plantilla.length === 0 && (
              <span className="text-[11.5px] text-cocina-ambar">
                No hay nadie activo en la plantilla de este local. Sin eso no se puede apuntar a nombre de nadie.
              </span>
            )}
          </label>

          {cargando ? (
            <div className="flex justify-center py-6">
              <Loader2 size={20} className="animate-spin text-cocina-acento" />
            </div>
          ) : (
            <div className="rounded-cocina-md border border-cocina-linea overflow-hidden">
              {formats.map((f, i) => (
                <div
                  key={f.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 ${i % 2 === 1 ? 'bg-cocina-fondo/60' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-cocina-tinta truncate">{f.name}</div>
                    <div className="text-[11.5px] text-cocina-tinta-3">
                      {qtyTxt(f.qtyInBase, baseUnit)} cada {f.name.trim().split(/\s+/)[0].toLowerCase()}
                    </div>
                  </div>
                  <Contador
                    valor={cuenta[f.id] ?? 0}
                    onChange={n => setCuenta(c => ({ ...c, [f.id]: Math.max(0, n) }))}
                  />
                </div>
              ))}

              <div className={`px-3 py-2.5 ${formats.length % 2 === 1 ? 'bg-cocina-fondo/60' : ''}`}>
                <div className="text-[13.5px] font-semibold text-cocina-tinta">Lo que está abierto</div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <BotonCocina
                    peso={abierto.modo === 'peso' ? 'relleno' : 'borde'}
                    onClick={() => setAbierto({ modo: 'peso', gramos: '' })}
                  >
                    Pesado
                  </BotonCocina>
                  <BotonCocina
                    peso={abierto.modo === 'ojo' ? 'relleno' : 'borde'}
                    onClick={() => setAbierto({ modo: 'ojo', fraccion: null, otros: '' })}
                  >
                    A ojo
                  </BotonCocina>
                </div>

                {abierto.modo === 'peso' ? (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      inputMode="decimal"
                      value={abierto.gramos}
                      onChange={e => setAbierto({ modo: 'peso', gramos: e.target.value })}
                      placeholder="0"
                      className="num h-10 w-28 px-2 rounded-cocina border border-cocina-linea bg-cocina-superficie text-right text-[14px]"
                    />
                    <span className="text-[13px] text-cocina-tinta-2">{baseUnit ?? ''}</span>
                  </div>
                ) : formatoAbierto ? (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {[0.25, 0.5, 0.75].map(fr => (
                      <BotonCocina
                        key={fr}
                        peso={abierto.fraccion === fr ? 'relleno' : 'borde'}
                        onClick={() => setAbierto({ modo: 'ojo', fraccion: fr, otros: '' })}
                      >
                        {fr === 0.25 ? '¼' : fr === 0.5 ? '½' : '¾'} {formatoAbierto.name.trim().split(/\s+/)[0].toLowerCase()}
                      </BotonCocina>
                    ))}
                    <input
                      inputMode="decimal"
                      value={abierto.otros}
                      onChange={e => setAbierto({ modo: 'ojo', fraccion: null, otros: e.target.value })}
                      placeholder="Otra"
                      className="num h-10 w-20 px-2 rounded-cocina border border-cocina-linea bg-cocina-superficie text-right text-[14px]"
                    />
                  </div>
                ) : (
                  <div className="text-[12px] text-cocina-tinta-3 mt-2">
                    Este artículo no tiene formatos de conteo: apunta el total pesado.
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-cocina-tinta-2">Suma lo que te ha dicho</span>
              <span className="num text-[22px] font-bold text-cocina-tinta">{qtyTxt(total, baseUnit)}</span>
            </div>
            {/* LO ESPERADO, EN GRIS. Va aquí a propósito: quien llama lo ve, y
                por eso no tiene que decírselo a quien cuenta. */}
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-[11.5px] text-cocina-tinta-3">
                Folvy esperaba {systemQty == null ? '—' : qtyTxt(systemQty, baseUnit)}
                {countedQty != null && ` · estaba apuntado ${qtyTxt(countedQty, baseUnit)}`}
              </span>
            </div>
          </div>

          {error && (
            <div className="rounded-cocina border border-cocina-ambar bg-cocina-ambar-bg/60 px-3 py-2 text-[12.5px] text-cocina-tinta leading-[1.45]">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-cocina-linea-suave">
          <BotonCocina peso="fantasma" onClick={onCerrar} disabled={guardando}>Cancelar</BotonCocina>
          {aConfirmar != null && aConfirmar === total ? (
            <BotonCocina peso="relleno" disabled={guardando} onClick={() => void guardar(total)}>
              {guardando ? <Loader2 size={13} className="animate-spin" /> : null}
              Sí, son {qtyTxt(total, baseUnit)}: guardar igual
            </BotonCocina>
          ) : (
            <BotonCocina
              peso="relleno"
              disabled={guardando || !hayAlgo || !quien}
              onClick={() => void guardar()}
            >
              {guardando ? <Loader2 size={13} className="animate-spin" /> : null}
              {/* REGLA 8 · el botón dice lo que va a pasar ANTES de pulsarlo. */}
              {quien
                ? `Guardar ${qtyTxt(total, baseUnit)} a nombre de ${nombreDeQuien.trim().split(/\s+/)[0]}`
                : 'Elige quién lo ha contado'}
            </BotonCocina>
          )}
        </div>
      </div>
    </div>
  )
}

function Contador({ valor, onChange }: { valor: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={() => onChange(valor - 1)}
        disabled={valor <= 0}
        aria-label="Uno menos"
        className="h-9 w-9 rounded-cocina border border-cocina-linea text-[17px] leading-none text-cocina-tinta-2 disabled:opacity-35"
      >
        −
      </button>
      <input
        inputMode="numeric"
        value={valor === 0 ? '' : String(valor)}
        onChange={e => {
          const n = Number(e.target.value.replace(/[^\d]/g, ''))
          onChange(Number.isFinite(n) ? n : 0)
        }}
        placeholder="0"
        className="num h-9 w-14 px-1 rounded-cocina border border-cocina-linea bg-cocina-superficie text-center text-[15px] font-bold"
      />
      <button
        onClick={() => onChange(valor + 1)}
        aria-label="Uno más"
        className="h-9 w-9 rounded-cocina border border-cocina-linea text-[17px] leading-none text-cocina-tinta-2"
      >
        +
      </button>
    </div>
  )
}
