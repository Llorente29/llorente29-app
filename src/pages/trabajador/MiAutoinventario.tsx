// src/pages/trabajador/MiAutoinventario.tsx
//
// CONTAR POR FORMATOS · pantallas 1, 2 y 3 de la maqueta aprobada el 10/09/2026.
//
// Quien cuenta tiene poca soltura con la tecnología y está de pie delante de una
// cámara. Un producto por pantalla, un renglón por formato, botones de 48 px y
// cero jerga. Y lo que cambia de verdad respecto a lo de antes:
//
//   ANTES  un campo de texto y un selector de unidad. El empleado tenía que
//          convertir mentalmente («dos bolsas y media son… ¿6.250?») y teclear
//          un número en unidad base. De ahí salían los 57 % de líneas en g/ml
//          apuntadas en kilos exactos: 6.000, 12.000. Lo abierto no se pesaba.
//   AHORA  una fila por formato con − y +, y una última fila para lo abierto,
//          con báscula. Nadie multiplica: se cuenta lo que se ve.
//
// LO QUE ESPERA FOLVY NO SE ENSEÑA NUNCA. Ni la cantidad, ni un porcentaje, ni
// una flecha, ni en el aviso de «vuelve a mirarlo». En cuanto quien cuenta
// puede deducir lo que el sistema espera, deja de contar y empieza a confirmar,
// y el recuento pasa a valer exactamente lo que valía el teórico.
//
// PINTA CON LOS TOKENS DE LA MAQUETA (`cocinaTokens.css`, escopado a `.cocina`),
// que son los mismos que aprobó Julio para Kitchen. No es «el estilo de Folvy
// adaptado»: es la maqueta, con sus radios de 2-3 px, su Archivo y sus cifras
// en IBM Plex Mono tabular.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import type { Employee } from '../../types'
import {
  getMyDailyQueue,
  getManualCountLines,
  countRemainingLines,
  autocloseDailyCount,
  type DailyQueueLine,
} from '../../modules/supply/services/autoinventoryService'
import { closeInventoryCount } from '../../modules/supply/services/inventoryCountService'
import {
  saveCountLine,
  AbsurdQuantityError,
  type CountEntryInput,
} from '../../modules/supply/services/countEntryService'
import {
  listCountFormats,
  fmtQty,
  type CountFormat,
} from '../../modules/supply/services/countFormatService'
// Las piezas viven fuera para que la CAPTURA que va al lado de la maqueta se
// pinte con ellas y no con un HTML escrito para la foto.
import {
  Marco, Cabecera, Tarjeta, Pie, Centrado, BotonPrincipal, BotonSecundario,
  FilaFormato, FilaAbierto, HojaVuelveAMirarlo,
} from '../../modules/supply/components/ConteoMovilPiezas'
import {
  unidadLarga, desglose, type Abierto,
} from '../../modules/supply/lib/conteoMovilTexto'
import { getLocationName } from '../../modules/supply/services/countFormatService'
import '@/modules/kitchen/estilo/cocinaTokens.css'

interface Props {
  employee: Employee
  onBack: () => void
  /** C5 — inventario MANUAL concreto: se cuentan TODAS sus líneas. */
  manualCountId?: string
  title?: string
}

type Phase = 'loading' | 'intro' | 'counting' | 'recount' | 'done' | 'empty' | 'error'

export default function MiAutoinventario({ employee, onBack, manualCountId, title = 'Autoinventario de hoy' }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [total, setTotal] = useState(0)
  const [doneBefore, setDoneBefore] = useState(0)
  const [queue, setQueue] = useState<DailyQueueLine[]>([])
  const [idx, setIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [countId, setCountId] = useState<string | null>(null)
  const [locationName, setLocationName] = useState('')

  // Lo que se cuenta del artículo en curso.
  const [formats, setFormats] = useState<CountFormat[]>([])
  const [formatsLoading, setFormatsLoading] = useState(false)
  const [cuenta, setCuenta] = useState<Record<string, number>>({})
  const [abierto, setAbierto] = useState<Abierto>({ modo: 'peso', gramos: '' })

  const current = queue[idx]
  const stepNumber = doneBefore + idx + 1
  const progressPct = total > 0 ? Math.round(((doneBefore + idx) / total) * 100) : 0

  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        let lines: DailyQueueLine[] = []
        let cid: string | null = null
        if (manualCountId) {
          lines = await getManualCountLines(manualCountId)
          cid = manualCountId
        } else if (employee.locationId) {
          // Una sola llamada: la cola y su conteo vienen juntos. Pedirla dos
          // veces no sólo es lento — puede devolver dos conteos distintos si
          // el autoinventario se genera entre medias.
          const q = await getMyDailyQueue(employee.locationId, employee.id)
          lines = q.lines
          cid = q.countId
        }
        if (cancel) return
        setCountId(cid)
        if (employee.locationId) {
          void getLocationName(employee.locationId)
            .then(n => { if (!cancel) setLocationName(n) })
            .catch(() => {})
        }
        const pending = lines.filter(l => l.countedQty == null)
        setTotal(lines.length)
        setDoneBefore(lines.length - pending.length)
        setQueue(pending)
        setIdx(0)
        if (lines.length === 0) setPhase('empty')
        else if (pending.length === 0) setPhase('done')
        else setPhase('intro')
      } catch (e) {
        if (!cancel) {
          setErrMsg(e instanceof Error ? e.message : 'No se pudo cargar')
          setPhase('error')
        }
      }
    }
    void load()
    return () => { cancel = true }
  }, [employee.id, employee.locationId, manualCountId])

  // Los formatos de conteo del artículo en curso. Si no hay ninguno, el móvil
  // pide sólo la unidad base — que es lo que debe pasar mientras nadie haya
  // decidido cuál de los formatos que chocan es el bueno (§2.6).
  useEffect(() => {
    let cancel = false
    if (!current) return
    setFormatsLoading(true)
    listCountFormats(current.recipeItemId)
      .then(fs => { if (!cancel) { setFormats(fs); setFormatsLoading(false) } })
      .catch(() => { if (!cancel) { setFormats([]); setFormatsLoading(false) } })
    return () => { cancel = true }
  }, [current?.recipeItemId]) // eslint-disable-line react-hooks/exhaustive-deps

  // El formato de referencia para calcular a ojo: el más pequeño, que es el que
  // se abre. Nadie abre una caja de 10 kg para servir: abre la bolsa.
  const formatoAbierto = useMemo(
    () => (formats.length > 0 ? formats[formats.length - 1] : null),
    [formats],
  )

  const totalBase = useMemo(() => {
    let t = 0
    for (const f of formats) t += (cuenta[f.id] ?? 0) * f.qtyInBase
    if (abierto.modo === 'peso') {
      const g = Number(abierto.gramos.replace(',', '.'))
      if (Number.isFinite(g) && g > 0) t += g
    } else {
      const ref = formats.find(f => f.id === abierto.formatId) ?? formatoAbierto
      if (abierto.fraccion != null && ref) t += abierto.fraccion * ref.qtyInBase
      else {
        const g = Number(abierto.otros.replace(',', '.'))
        if (Number.isFinite(g) && g > 0) t += g
      }
    }
    return t
  }, [formats, cuenta, abierto, formatoAbierto])

  const hayAlgoTecleado = useMemo(() => {
    if (formats.some(f => (cuenta[f.id] ?? 0) > 0)) return true
    if (abierto.modo === 'peso') return abierto.gramos.trim() !== ''
    return abierto.fraccion != null || abierto.otros.trim() !== ''
  }, [formats, cuenta, abierto])

  const esAOjo = abierto.modo === 'ojo' && abierto.fraccion != null

  function limpiar() {
    setCuenta({})
    setAbierto({ modo: 'peso', gramos: '' })
  }

  /** Lo que se manda al servidor: el CÓMO. La conversión la hace él. */
  function construirEntradas(): CountEntryInput[] {
    const out: CountEntryInput[] = []
    for (const f of formats) {
      const n = cuenta[f.id] ?? 0
      if (n > 0) out.push({ method: 'formato', formatId: f.id, qty: n })
    }
    if (abierto.modo === 'peso') {
      const g = Number(abierto.gramos.replace(',', '.'))
      if (Number.isFinite(g) && g > 0) out.push({ method: 'peso', qty: g })
    } else {
      const ref = formats.find(f => f.id === abierto.formatId) ?? formatoAbierto
      if (abierto.fraccion != null && ref) {
        out.push({ method: 'fraccion', formatId: ref.id, fraction: abierto.fraccion })
      } else {
        const g = Number(abierto.otros.replace(',', '.'))
        if (Number.isFinite(g) && g > 0) out.push({ method: 'peso', qty: g })
      }
    }
    return out
  }

  async function guardar(entradas: CountEntryInput[]) {
    if (!current) return
    setSaving(true)
    setErrMsg('')
    try {
      const res = await saveCountLine(current.lineId, entradas)
      setSaving(false)
      if (res.verdict === 'recount') {
        limpiar()
        setPhase('recount')
        return
      }
      avanzar()
    } catch (e) {
      setSaving(false)
      if (e instanceof AbsurdQuantityError) {
        // La red de cordura. No se cambia de pantalla: se dice qué pasa y se
        // deja corregir donde está, que es donde tiene las manos.
        setErrMsg(e.message)
        return
      }
      setErrMsg(e instanceof Error ? e.message : 'No se pudo guardar')
      setPhase('error')
    }
  }

  function avanzar() {
    limpiar()
    if (idx + 1 >= queue.length) {
      setPhase('done')
      if (countId) {
        void (async () => {
          try {
            if (manualCountId) await closeInventoryCount(countId)
            else if (await countRemainingLines(countId) === 0) await autocloseDailyCount(countId)
          } catch {
            // Si falla el cierre no se le enseña error a quien cuenta: ya ha
            // terminado su parte. El barrido del día siguiente lo recoge.
          }
        })()
      }
    } else {
      setIdx(idx + 1)
      setPhase('counting')
    }
  }

  // ─── Pantallas ───────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return <Marco><Centrado><Loader2 size={28} className="text-cocina-acento animate-spin" />
      <p className="text-[13px] text-cocina-tinta-3 mt-3">Cargando…</p></Centrado></Marco>
  }

  if (phase === 'error') {
    return (
      <Marco>
        <Centrado>
          <AlertTriangle size={36} className="text-cocina-rojo" />
          <p className="text-[17px] font-bold text-cocina-tinta mt-3">No se pudo cargar</p>
          <p className="text-[13px] text-cocina-tinta-2 mt-1 max-w-xs">{errMsg}</p>
          <BotonPrincipal onClick={onBack}>Volver</BotonPrincipal>
        </Centrado>
      </Marco>
    )
  }

  if (phase === 'empty') {
    return (
      <Marco>
        <Cabecera title={title} onBack={onBack} />
        <Centrado>
          <Check size={40} className="text-cocina-verde" />
          <p className="text-[22px] font-extrabold text-cocina-tinta mt-4">Hoy no te toca contar</p>
          <p className="text-[13px] text-cocina-tinta-2 mt-1 max-w-xs">
            No tienes productos asignados para hoy. Nada que hacer por aquí.
          </p>
          <BotonPrincipal onClick={onBack}>Volver</BotonPrincipal>
        </Centrado>
      </Marco>
    )
  }

  if (phase === 'intro') {
    return (
      <Marco>
        <Cabecera title={title} onBack={onBack} />
        <div className="flex-1 px-4 pt-5">
          <p className="text-[26px] font-extrabold tracking-[-.02em] leading-[1.15] text-cocina-tinta">
            Hola, {employee.name.split(' ')[0]}
          </p>
          <p className="text-[14px] text-cocina-tinta-2 mt-1">Hoy te toca un recuento rápido.</p>
          <div className="mt-5 rounded-cocina-md bg-cocina-acento-bg px-5 py-6 text-center">
            <div className="num text-[44px] font-bold leading-none text-cocina-acento-ink">{queue.length}</div>
            <div className="text-[13px] text-cocina-acento-ink mt-2">
              {queue.length === 1 ? 'producto por contar' : 'productos por contar'}
            </div>
          </div>
          <p className="text-[13px] text-cocina-tinta-2 mt-4 leading-[1.5]">
            Te los pido de uno en uno. Cuenta lo cerrado por formato —cajas, bolsas, paquetes— y
            lo que esté abierto, a la báscula.
          </p>
        </div>
        <Pie>
          <BotonPrincipal onClick={() => setPhase('counting')}>Empezar a contar</BotonPrincipal>
        </Pie>
      </Marco>
    )
  }

  if (phase === 'done') {
    return (
      <Marco>
        <Cabecera title={title} />
        <Centrado>
          <Check size={44} className="text-cocina-verde" />
          <p className="text-[24px] font-extrabold text-cocina-tinta mt-4">¡Listo!</p>
          <p className="text-[13px] text-cocina-tinta-2 mt-2 max-w-xs leading-[1.5]">
            Has contado {total === 1 ? 'el producto' : `los ${total} productos`} de hoy. Gracias.
          </p>
          <p className="text-[13px] text-cocina-tinta-3 mt-5 max-w-xs leading-[1.5]">
            El encargado lo revisa y ajusta el stock. Tú no tienes que hacer nada más.
          </p>
        </Centrado>
        <Pie><BotonPrincipal onClick={onBack}>Cerrar</BotonPrincipal></Pie>
      </Marco>
    )
  }

  // ─── phase 'counting' y 'recount' comparten el cuerpo ────────────────────
  const enRecount = phase === 'recount'
  const instruccion = enRecount
    ? 'Cuéntalo otra vez, sin mirar lo de antes.'
    : abierto.modo === 'ojo'
      ? 'Sin báscula a mano: di cuánto queda en lo que está abierto.'
      : formats.length > 0
        ? 'Cuenta lo cerrado por formato. Lo abierto, a la báscula.'
        : `Cuenta lo que hay, en ${unidadLarga(current?.baseUnit)}.`

  return (
    <Marco>
      <Cabecera title={title} onBack={onBack} paso={stepNumber} de={total} pct={progressPct} />

      <div className={`flex-1 overflow-y-auto ${enRecount ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="px-4 pt-4 pb-3 flex flex-col gap-1">
          {locationName && (
            <span className="text-[11px] font-bold tracking-[.08em] uppercase text-cocina-tinta-3">{locationName}</span>
          )}
          <span className="text-[26px] font-extrabold tracking-[-.02em] leading-[1.15] text-cocina-tinta">
            {current?.name}
          </span>
          <span className="text-[14px] text-cocina-tinta-2 leading-[1.4]">{instruccion}</span>
        </div>

        {formatsLoading ? (
          <div className="mx-4 rounded-cocina-md border border-cocina-linea bg-cocina-superficie p-6 flex justify-center">
            <Loader2 size={20} className="animate-spin text-cocina-acento" />
          </div>
        ) : (
          <Tarjeta>
            {formats.map((f, i) => (
              <FilaFormato
                key={f.id}
                formato={f}
                baseUnit={current?.baseUnit ?? null}
                valor={cuenta[f.id] ?? 0}
                rayada={i % 2 === 1}
                onChange={n => setCuenta(c => ({ ...c, [f.id]: Math.max(0, n) }))}
              />
            ))}
            <FilaAbierto
              abierto={abierto}
              setAbierto={setAbierto}
              formatoRef={formatoAbierto}
              baseUnit={current?.baseUnit ?? null}
              soloBase={formats.length === 0}
            />
          </Tarjeta>
        )}

        {hayAlgoTecleado && (
          <div className="mx-4 mt-3 rounded-cocina-md bg-cocina-acento-bg px-4 py-3.5 flex justify-between items-baseline gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[12px] font-bold tracking-[.06em] uppercase text-cocina-acento-ink">Total contado</span>
              <span className="text-[13px] text-cocina-acento-ink leading-snug">
                {desglose(formats, cuenta, abierto, formatoAbierto, current?.baseUnit ?? null)}
              </span>
            </div>
            <span className="num text-[26px] font-bold tracking-[-.02em] text-cocina-acento-ink whitespace-nowrap">
              {esAOjo ? '≈ ' : ''}{fmtQty(totalBase, current?.baseUnit ?? null)}
            </span>
          </div>
        )}

        {errMsg && !enRecount && (
          <div className="mx-4 mt-3 rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-rojo-bg text-cocina-rojo leading-[1.45]">
            {errMsg}
          </div>
        )}
      </div>

      {!enRecount && (
        <Pie>
          <BotonPrincipal
            disabled={!hayAlgoTecleado || saving}
            onClick={() => void guardar(construirEntradas())}
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : null}
            Guardar y seguir
          </BotonPrincipal>
          <BotonSecundario
            disabled={saving}
            onClick={() => void guardar([{ method: 'cero' }])}
          >
            No queda nada de este producto
          </BotonSecundario>
        </Pie>
      )}

      {enRecount && (
        <HojaVuelveAMirarlo
          producto={current?.name ?? ''}
          formats={formats}
          baseUnit={current?.baseUnit ?? null}
          cuenta={cuenta}
          setCuenta={setCuenta}
          abierto={abierto}
          setAbierto={setAbierto}
          formatoRef={formatoAbierto}
          hayAlgo={hayAlgoTecleado}
          saving={saving}
          error={errMsg}
          onGuardar={() => void guardar(construirEntradas())}
          onLoMismo={() => void guardar([{ method: 'cero' }])}
        />
      )}
    </Marco>
  )
}

