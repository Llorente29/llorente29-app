// src/pages/InformesPage.tsx
//
// EL GENERADOR DE INFORMES. Lote 2 del encargo, sobre la maqueta aprobada (§11).
//
// ── LA TESIS DE LA PANTALLA ────────────────────────────────────────────────
// Los DOS ejes se eligen a la vez y se escriben junto a la cifra. Un número sin
// sus dos ejes es el que se lee mal. Y bruto, descuentos y neto son tres
// columnas distintas y siempre visibles: nunca una sola cifra llamada «ventas».
// Esa fue la que mordió el 05/09 —3.291,07 € que eran 1.979,11 €— y la que
// esconde que Uber descuenta el 31,5 % del bruto y Glovo el 10,8 %.
//
// ── LA BANDA DE MEDIDA NO ES ADORNO ────────────────────────────────────────
// El intervalo exacto, el filtro y la regla van pegados a la cifra y SIN
// desplegar nada. Los cuatro errores de esa semana fueron todos lo mismo: una
// cifra sin su denominador o sin su regla al lado. Es también lo que permite
// cuadrar esta pantalla con el correo del lunes, que es lo que exige el §6.
//
// ── ESTA PANTALLA NO CALCULA NI UN EURO ────────────────────────────────────
// Todas las cifras salen de `report_sales`. Aquí sólo se eligen ejes, se pintan
// filas y se llaman los helpers de descarga que ya existen.

import { useEffect, useMemo, useState } from 'react'
import { FileDown, Loader2, Save, Mail, AlertTriangle } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { usePermissions } from '@/modules/multitenancy/hooks/usePermissions'
import { supabase } from '@/lib/supabase'
import { descargaCsv } from '@/lib/descargaCsv'
import { descargaXlsx, nombreXlsxConFecha } from '@/lib/descargaXlsx'
import { diaNatural } from '@/lib/fechas'
import { fmtMoney, fmtInt, fmtPct } from '@/lib/format'
import {
  resuelvePeriodo, etiquetaDelEspejo,
  type ClaveDePeriodo, type PeriodoResuelto,
} from '@/modules/ventas/services/periodoInforme'
import {
  ejecutaInforme, cruzaConEspejo, filasParaDescarga, nombreDelInforme,
  type EjeInforme, type InformeVentas, type FilaConDelta,
} from '@/modules/ventas/services/reportSalesService'

// ── Vocabulario de la pantalla ─────────────────────────────────────────────

const EJES_FILA: { id: EjeInforme; label: string }[] = [
  { id: 'local', label: 'Local' }, { id: 'marca', label: 'Marca' },
  { id: 'canal', label: 'Canal' }, { id: 'propiedad', label: 'Propiedad' },
  { id: 'servicio', label: 'Servicio' },
]
const EJES_COLUMNA: { id: EjeInforme | null; label: string }[] = [
  { id: null, label: 'Ninguno' }, { id: 'canal', label: 'Canal' },
  { id: 'marca', label: 'Marca' }, { id: 'propiedad', label: 'Propiedad' },
]
const PERIODOS: { id: Exclude<ClaveDePeriodo, 'personalizado'>; label: string }[] = [
  { id: 'hoy', label: 'Hoy (en curso)' },
  { id: 'ayer', label: 'Ayer (completo)' },
  { id: 'esta_semana', label: 'Esta semana (en curso)' },
  { id: 'semana_pasada', label: 'Semana pasada (completa)' },
  { id: 'este_mes', label: 'Este mes (en curso)' },
  { id: 'mes_pasado', label: 'Mes pasado (completo)' },
]

interface Opcion { id: string; nombre: string }

export default function InformesPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { hasPermission } = usePermissions()
  const veCostes = hasPermission('show_costes')

  const [ejeFila, setEjeFila] = useState<EjeInforme>('local')
  const [ejeColumna, setEjeColumna] = useState<EjeInforme | null>('canal')
  const [periodoClave, setPeriodoClave] = useState<Exclude<ClaveDePeriodo, 'personalizado'>>('semana_pasada')
  const [locales, setLocales] = useState<Opcion[]>([])
  const [canales, setCanales] = useState<Opcion[]>([])
  const [localSel, setLocalSel] = useState<string>('')
  const [propiedadSel, setPropiedadSel] = useState<'' | 'own' | 'licensed'>('')
  const [canalSel, setCanalSel] = useState<string>('')

  const [informe, setInforme] = useState<InformeVentas | null>(null)
  const [cargando, setCargando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Qué fila está abierta en el día a día. null = el conjunto filtrado entero.
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null)

  // El periodo se congela al pedir el informe, no se recalcula al pintar: si se
  // recalculara, `hoy` se movería entre la cifra y su rótulo y dejarían de
  // corresponderse. Es la misma razón por la que las verificaciones llevan
  // instantes fijos.
  const [periodo, setPeriodo] = useState<PeriodoResuelto | null>(null)

  useEffect(() => {
    if (!activeAccountId || !supabase) return
    let vivo = true
    void (async () => {
      const [l, c] = await Promise.all([
        supabase!.from('locations').select('id, name').eq('account_id', activeAccountId).order('name'),
        supabase!.from('sales_channel').select('id, name').eq('account_id', activeAccountId).order('name'),
      ])
      if (!vivo) return
      setLocales(((l.data ?? []) as { id: string; name: string }[]).map(x => ({ id: x.id, nombre: x.name })))
      setCanales(((c.data ?? []) as { id: string; name: string }[]).map(x => ({ id: x.id, nombre: x.name })))
    })()
    return () => { vivo = false }
  }, [activeAccountId])

  const ejes = useMemo<EjeInforme[]>(
    () => (ejeColumna ? [ejeFila, ejeColumna] : [ejeFila]), [ejeFila, ejeColumna])

  async function ejecuta() {
    if (!activeAccountId) { setFallo('No hay cuenta activa.'); return }
    // Sale del cuerpo SÍNCRONO del efecto antes de tocar estado: pintar y
    // volver a pintar en la misma vuelta es una cascada de renders, y la regla
    // `react-hooks/set-state-in-effect` avisa de eso con razón. Otras pantallas
    // del proyecto la incumplen; eso no la convierte en opcional aquí.
    await Promise.resolve()
    setCargando(true); setFallo(null); setAviso(null); setFilaAbierta(null)
    const p = resuelvePeriodo(periodoClave, new Date())
    try {
      const r = await ejecutaInforme({
        accountId: activeAccountId,
        periodo: p,
        ejes,
        filtros: {
          locationIds: localSel ? [localSel] : null,
          ownership: propiedadSel || null,
          channelIds: canalSel ? [canalSel] : null,
        },
      })
      setPeriodo(p); setInforme(r)
    } catch (e) {
      // El mensaje de la frontera YA dice qué pasa («las ventanas no duran lo
      // mismo (X vs Y)»). Se enseña tal cual en vez de taparlo (regla 8).
      setFallo(e instanceof Error ? e.message : 'No se ha podido ejecutar el informe.')
      setInforme(null)
    } finally { setCargando(false) }
  }

  // `set-state-in-effect` marca ESTA LLAMADA, no el `setState`: el análisis
  // estático no puede ver que `ejecuta` sale del cuerpo síncrono con un `await`
  // antes de tocar estado. La cascada que la regla persigue no ocurre —eso está
  // arreglado de verdad arriba— pero la regla no puede comprobarlo, así que se
  // silencia AQUÍ y con el motivo escrito, en vez de dejar el aviso suelto.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void ejecuta() /* eslint-disable-next-line react-hooks/exhaustive-deps */ },
    [activeAccountId, ejeFila, ejeColumna, periodoClave, localSel, propiedadSel, canalSel])

  const filas = useMemo<FilaConDelta[]>(
    () => (informe ? cruzaConEspejo(informe.filas, informe.espejo) : []), [informe])

  const total = useMemo(() => sumaFilas(filas), [filas])
  const totalEspejo = useMemo(
    () => (informe ? sumaFilas(informe.espejo.map(e => ({ ...e, espejo: null, deltaNeto: null, deltaNetoPct: null, deltaPedidos: null }))) : null),
    [informe])

  function baja(tipo: 'csv' | 'xlsx') {
    if (!informe) return
    const rows = filasParaDescarga(informe, filas)
    const base = nombreDelInforme(ejes, new Date())
    const hubo = tipo === 'csv'
      ? descargaCsv(rows, `folvy-${base}.csv`)
      : descargaXlsx(rows, nombreXlsxConFecha(base, diaNatural(new Date())), 'Informe')
    setAviso(hubo
      ? `Descargado: ${rows.length} ${rows.length === 1 ? 'fila' : 'filas'}.`
      : 'No hay nada que descargar: el informe habría salido vacío.')
  }

  if (accountsLoading) return <p className="p-6 text-sm text-text-secondary">Cargando…</p>

  return (
    <div className="p-4 md:p-6 max-w-[1400px]">
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wide text-text-secondary">Folvy · Ventas</p>
        <h1 className="text-2xl font-semibold font-display text-text-primary">Informes</h1>
      </header>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ── EL CARRIL. Siempre visible: es la tesis de la pantalla ───────── */}
        <aside className="w-full lg:w-[250px] shrink-0 space-y-4">
          <section className="bg-card border border-border-default rounded-xl p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">Cómo se cruza</h2>

            <p className="text-[11px] font-medium text-text-secondary mb-1.5">Ver por · filas</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {EJES_FILA.map(e => (
                <Chip key={e.id} activo={ejeFila === e.id} onClick={() => setEjeFila(e.id)}
                  // El eje elegido se rotula DENTRO del chip: nunca hay que
                  // adivinar cuál de los dos es cuál.
                  label={ejeFila === e.id ? `filas · ${e.label}` : e.label} />
              ))}
            </div>

            <p className="text-[11px] font-medium text-text-secondary mb-1.5">Agrupar por · columnas</p>
            <div className="flex flex-wrap gap-1.5">
              {EJES_COLUMNA.filter(e => e.id !== ejeFila).map(e => (
                <Chip key={e.id ?? 'none'} activo={ejeColumna === e.id}
                  onClick={() => setEjeColumna(e.id)}
                  label={ejeColumna === e.id && e.id ? `columnas · ${e.label}` : e.label} />
              ))}
            </div>

            <p className="mt-2.5 text-[11px] text-text-secondary leading-snug">
              Los dos ejes se eligen a la vez y se escriben junto a la cifra.
              Un número sin sus dos ejes es el que se lee mal.
            </p>
          </section>

          <section className="bg-card border border-border-default rounded-xl p-3 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Filtros</h2>
            <Selector label="Local" value={localSel} onChange={setLocalSel}
              opciones={[{ id: '', nombre: `Todos (${locales.length})` }, ...locales]} />
            <div>
              <p className="text-[11px] font-medium text-text-secondary mb-1.5">Propiedad</p>
              <div className="flex gap-1.5">
                <Chip activo={propiedadSel === 'own'} label="Propias"
                  onClick={() => setPropiedadSel(propiedadSel === 'own' ? '' : 'own')} />
                <Chip activo={propiedadSel === 'licensed'} label="Cedidas"
                  onClick={() => setPropiedadSel(propiedadSel === 'licensed' ? '' : 'licensed')} />
              </div>
            </div>
            <Selector label="Canal" value={canalSel} onChange={setCanalSel}
              opciones={[{ id: '', nombre: `Todos (${canales.length})` }, ...canales]} />
            <Selector label="Periodo" value={periodoClave}
              onChange={v => setPeriodoClave(v as Exclude<ClaveDePeriodo, 'personalizado'>)}
              opciones={PERIODOS.map(p => ({ id: p.id, nombre: p.label }))} />
            {periodo && (
              <p className="text-[11px] text-text-secondary leading-snug">
                {periodo.parcial
                  ? 'Periodo en curso: el espejo se recorta al mismo tramo, no a la semana entera.'
                  : 'Periodo completo: el espejo es el anterior entero. Misma duración a los dos lados.'}
              </p>
            )}
          </section>
        </aside>

        {/* ── EL INFORME ──────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">
          {fallo && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{fallo}</p>
          )}
          {aviso && <p className="text-sm text-success">{aviso}</p>}

          {cargando && !informe && (
            <p className="text-sm text-text-secondary py-8 text-center">
              <Loader2 className="inline w-4 h-4 animate-spin mr-1.5" />Midiendo…
            </p>
          )}

          {informe && periodo && (
            <>
              <BandaDeMedida informe={informe} periodo={periodo} />
              <FilaDeKpis total={total} espejo={totalEspejo} />
              <Tabla
                filas={filas} ejeFila={ejeFila} ejeColumna={ejeColumna}
                total={total} totalEspejo={totalEspejo}
                abierta={filaAbierta} onAbrir={setFilaAbierta}
              />
              <DiaADia informe={informe} abierta={filaAbierta} ejeFila={ejeFila} />
              {veCostes && <Cobertura informe={informe} />}
              <Acciones onCsv={() => baja('csv')} onXlsx={() => baja('xlsx')} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Piezas ─────────────────────────────────────────────────────────────────

function Chip({ activo, label, onClick }: { activo: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2 py-1 rounded-md text-[12px] border transition-colors ${
        activo
          ? 'border-terracota bg-terracota-bg text-terracota font-medium'
          : 'border-border-default bg-card text-text-secondary hover:bg-page'
      }`}>{label}</button>
  )
}

function Selector({ label, value, onChange, opciones }: {
  label: string; value: string; onChange: (v: string) => void; opciones: Opcion[]
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-text-secondary mb-1.5">{label}</p>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary">
        {opciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
      </select>
    </div>
  )
}

/**
 * LA BANDA DE MEDIDA. Cuatro datos, arriba del todo, sin desplegar nada.
 *
 * Es el producto, no el pie de página: es lo que impide que una cifra viaje sin
 * su denominador y lo que permite cuadrar esta pantalla con el correo. Va en
 * monoespaciada a propósito — se lee para COMPARAR, no para leer de corrido.
 */
function BandaDeMedida({ informe, periodo }: { informe: InformeVentas; periodo: PeriodoResuelto }) {
  const m = informe.meta
  return (
    <section className="bg-card border border-border-default rounded-xl p-3 text-[12px] font-mono leading-relaxed">
      <Dato k="Periodo" v={`${m.ventana_actual.desde} → ${m.ventana_actual.hasta}`}
        extra={<span className="font-sans text-text-secondary ml-2">
          Espejo <span className="font-mono">{m.ventana_espejo.desde} → {m.ventana_espejo.hasta}</span>
          <span className="ml-2">· {etiquetaDelEspejo(periodo)}</span>
        </span>} />
      <Dato k="Filtro" v={Object.keys(m.filtros).length ? JSON.stringify(m.filtros) : 'todos los locales · todas las marcas · todos los canales'} />
      <Dato k="Regla" v={m.regla} />
    </section>
  )
}

function Dato({ k, v, extra }: { k: string; v: string; extra?: React.ReactNode }) {
  return (
    <p className="flex flex-wrap gap-x-2">
      <span className="uppercase text-text-tertiary w-[64px] shrink-0">{k}</span>
      <span className="text-text-primary break-all">{v}</span>
      {extra}
    </p>
  )
}

interface Totales {
  pedidos: number; bruto: number; descuentos: number; neto: number; ticket: number
}

function sumaFilas(filas: { pedidos: number; bruto: number; descuentos: number; neto: number }[]): Totales {
  const t = filas.reduce((a, f) => ({
    pedidos: a.pedidos + f.pedidos, bruto: a.bruto + f.bruto,
    descuentos: a.descuentos + f.descuentos, neto: a.neto + f.neto,
  }), { pedidos: 0, bruto: 0, descuentos: 0, neto: 0 })
  return { ...t, ticket: t.pedidos ? t.neto / t.pedidos : 0 }
}

/**
 * LOS CINCO KPI. No usa `KpiCard` y hay que decir por qué: KpiCard pinta el
 * delta en ABSOLUTO con el mismo formato del valor, no admite una tarjeta
 * destacada, y su `note` no cambia de color. La maqueta pide delta en %, el
 * Neto mayor que el resto y la tasa de descuento en rojo a partir del 20 %.
 * Cambiar KpiCard para esto movería `AvailabilityReportsPage`, que es
 * exactamente lo que su propia cabecera prohíbe.
 */
function FilaDeKpis({ total, espejo }: { total: Totales; espejo: Totales | null }) {
  const tasa = total.bruto ? (total.descuentos / total.bruto) * 100 : null
  return (
    <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Kpi label="Bruto" valor={fmtMoney(total.bruto)} delta={pct(total.bruto, espejo?.bruto)} mejorSi="up" />
      <Kpi label="Descuentos" valor={fmtMoney(total.descuentos)}
        delta={pct(total.descuentos, espejo?.descuentos)} mejorSi="down"
        nota={tasa != null ? `${fmtPct(tasa)} del bruto` : undefined}
        notaAlarma={tasa != null && tasa >= 20} />
      <Kpi label="Neto" valor={fmtMoney(total.neto)} delta={pct(total.neto, espejo?.neto)} mejorSi="up" destacado />
      <Kpi label="Pedidos" valor={fmtInt(total.pedidos)} delta={pct(total.pedidos, espejo?.pedidos)} mejorSi="up" />
      <Kpi label="Ticket medio" valor={fmtMoney(total.ticket)} delta={pct(total.ticket, espejo?.ticket)} mejorSi="up" />
    </section>
  )
}

/** null cuando no hay base: de 0 a 100 € no es «+∞ %», es que no había con qué comparar. */
function pct(hoy: number, antes: number | undefined): number | null {
  if (antes == null || antes === 0) return null
  return ((hoy - antes) / Math.abs(antes)) * 100
}

function Kpi({ label, valor, delta, mejorSi, nota, notaAlarma, destacado }: {
  label: string; valor: string; delta: number | null; mejorSi: 'up' | 'down'
  nota?: string; notaAlarma?: boolean; destacado?: boolean
}) {
  const mejor = delta != null && (mejorSi === 'up' ? delta > 0 : delta < 0)
  const peor = delta != null && (mejorSi === 'up' ? delta < 0 : delta > 0)
  return (
    <div className={`bg-card border rounded-xl p-3 ${destacado ? 'border-terracota/50' : 'border-border-default'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1">{label}</p>
      <p className={`font-display font-semibold text-text-primary ${destacado ? 'text-2xl' : 'text-lg'}`}>{valor}</p>
      <p className={`mt-1 text-[11px] ${mejor ? 'text-success' : peor ? 'text-danger' : 'text-text-secondary'}`}>
        {delta == null
          // Sin base no se inventa un porcentaje: se dice con palabras.
          ? 'sin espejo con qué comparar'
          : `${delta > 0 ? '+' : ''}${fmtPct(delta)} vs espejo`}
      </p>
      {nota && <p className={`mt-0.5 text-[11px] ${notaAlarma ? 'text-danger font-medium' : 'text-text-tertiary'}`}>{nota}</p>}
    </div>
  )
}

function Tabla({ filas, ejeFila, ejeColumna, total, totalEspejo, abierta, onAbrir }: {
  filas: FilaConDelta[]; ejeFila: EjeInforme; ejeColumna: EjeInforme | null
  total: Totales; totalEspejo: Totales | null
  abierta: string | null; onAbrir: (k: string | null) => void
}) {
  const etiqueta = (f: FilaConDelta) =>
    [f.dims[ejeFila], ejeColumna ? f.dims[ejeColumna] : null].filter(Boolean).join(' · ')
  return (
    <section className="bg-card border border-border-default rounded-xl overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 px-3 py-2 border-b border-border-default">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {ejeFila}{ejeColumna ? ` × ${ejeColumna}` : ''}
        </h2>
        <p className="text-[11px] text-text-secondary">Pulsa una fila para ver su día a día</p>
      </div>
      {/* El ancho lo absorbe la tabla, no el cuerpo de la página. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-secondary border-b border-border-default">
              <Th left>{ejeFila}{ejeColumna ? ` · ${ejeColumna}` : ''}</Th>
              <Th>Bruto</Th><Th>Descuentos</Th><Th>Neto</Th><Th>Pedidos</Th><Th>Neto espejo</Th><Th>Δ</Th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => {
              const k = etiqueta(f)
              return (
                <tr key={k} onClick={() => onAbrir(abierta === k ? null : k)}
                  className={`border-b border-border-default last:border-0 cursor-pointer hover:bg-page ${abierta === k ? 'bg-accent-bg' : ''}`}>
                  <Td left>
                    {k || '(sin valor)'}
                    {/* Una fila que ya no vende sigue saliendo, y se dice. */}
                    {f.pedidos === 0 && f.espejo && (
                      <span className="ml-1.5 text-[11px] text-danger">sin ventas este periodo</span>
                    )}
                  </Td>
                  <Td>{fmtMoney(f.bruto)}</Td>
                  <Td>{fmtMoney(f.descuentos)}</Td>
                  <Td fuerte>{fmtMoney(f.neto)}</Td>
                  <Td>{fmtInt(f.pedidos)}</Td>
                  <Td>{f.espejo ? fmtMoney(f.espejo.neto) : '—'}</Td>
                  <Td>
                    {f.deltaNetoPct == null
                      ? <span className="text-text-secondary text-[11px]">sin espejo</span>
                      : <span className={f.deltaNetoPct < 0 ? 'text-danger' : 'text-success'}>
                          {f.deltaNetoPct > 0 ? '+' : ''}{fmtPct(f.deltaNetoPct)}
                        </span>}
                  </Td>
                </tr>
              )
            })}
            <tr className="font-medium bg-page">
              <Td left>Total</Td>
              <Td>{fmtMoney(total.bruto)}</Td>
              <Td>{fmtMoney(total.descuentos)}</Td>
              <Td fuerte>{fmtMoney(total.neto)}</Td>
              <Td>{fmtInt(total.pedidos)}</Td>
              <Td>{totalEspejo ? fmtMoney(totalEspejo.neto) : '—'}</Td>
              <Td>{(() => {
                const d = pct(total.neto, totalEspejo?.neto)
                return d == null ? '—' : <span className={d < 0 ? 'text-danger' : 'text-success'}>
                  {d > 0 ? '+' : ''}{fmtPct(d)}</span>
              })()}</Td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

const Th = ({ children, left }: { children: React.ReactNode; left?: boolean }) =>
  <th className={`px-3 py-2 font-medium ${left ? 'text-left' : 'text-right'}`}>{children}</th>
const Td = ({ children, left, fuerte }: { children: React.ReactNode; left?: boolean; fuerte?: boolean }) =>
  <td className={`px-3 py-2 ${left ? 'text-left' : 'text-right tabular-nums'} ${fuerte ? 'font-medium text-text-primary' : ''}`}>{children}</td>

/**
 * DÍA A DÍA CONTRA EL ESPEJO.
 *
 * Sin esto, «−22 %» es un titular que no se puede accionar. Con esto se ve que
 * lunes, martes y miércoles de Alcalá sumaron 1.471,02 € contra 3.781,08 € — el
 * 95 % del agujero de la semana en tres días seguidos y un solo local. Un día
 * por debajo del 55 % de su espejo se pinta en rojo, sin texto de alarma: el
 * color ordena la mirada, no dictamina.
 */
function DiaADia({ informe, abierta, ejeFila }: {
  informe: InformeVentas; abierta: string | null; ejeFila: EjeInforme
}) {
  const dePeriodo = (fs: typeof informe.dias.actual) => {
    const filtradas = abierta == null ? fs : fs.filter(f => f.dims[ejeFila] === abierta.split(' · ')[0])
    const porDia = new Map<string, number>()
    for (const f of filtradas) {
      const d = f.dims.dia
      if (d) porDia.set(d, (porDia.get(d) ?? 0) + f.neto)
    }
    return porDia
  }
  const act = dePeriodo(informe.dias.actual)
  const esp = dePeriodo(informe.dias.espejo)
  const dias = [...act.keys()].sort()
  const espOrden = [...esp.keys()].sort()
  if (!dias.length) return null
  const max = Math.max(...[...act.values(), ...esp.values(), 1])

  return (
    <section className="bg-card border border-border-default rounded-xl p-3">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Día a día{abierta ? ` · ${abierta}` : ' · todo lo filtrado'}
        </h2>
        <p className="text-[11px] text-text-secondary">periodo vs espejo</p>
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-3 items-end min-w-max">
          {dias.map((d, i) => {
            const a = act.get(d) ?? 0
            const e = esp.get(espOrden[i] ?? '') ?? 0
            const cae = e > 0 && a < e * 0.55
            return (
              <div key={d} className="text-center">
                <div className="flex gap-1 items-end h-[110px]">
                  <div style={{ height: `${(a / max) * 100}%` }}
                    className={`w-6 rounded-t ${cae ? 'bg-danger' : 'bg-terracota'}`} />
                  <div style={{ height: `${(e / max) * 100}%` }} className="w-6 rounded-t bg-border-default" />
                </div>
                <p className="mt-1 text-[11px] font-medium text-text-primary">{fmtMoney(a)}</p>
                <p className="text-[10px] text-text-secondary">esp. {fmtMoney(e)}</p>
                <p className="text-[10px] text-text-tertiary">{d.slice(5)}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/**
 * COSTE Y MARGEN · COBERTURA DECLARADA.
 *
 * Los dos niveles con sus CUATRO porcentajes y su unidad escrita, la resta
 * explicada, y al lado el aviso de B73 EN TEXTO. Ese recuadro no se puede
 * convertir en porcentaje ni mover a otro sitio: pierde su función en cuanto se
 * despega de los números. Un hueco tiene porcentaje; un sesgo, no.
 */
function Cobertura({ informe }: { informe: InformeVentas }) {
  const c = informe.meta.cobertura_coste
  const a = c.con_coste
  const b = c.sin_hueco_de_modificador
  return (
    <section className="bg-card border border-border-default rounded-xl p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-3">
        Coste y margen · cobertura declarada
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <dl className="text-sm space-y-1.5">
          <Linea t="Pedidos con coste en todas sus líneas de plato"
            v={`${fmtInt(a.pedidos)} de ${fmtInt(c.pedidos)} · ${fmtPct(a.pct_pedidos)} de los pedidos`} />
          <Linea t="…y su importe"
            v={`${fmtMoney(a.neto)} de ${fmtMoney(c.neto)} · ${fmtPct(a.pct_importe)} del dinero`} />
          <Linea t="Además, sin ningún modificador cobrado sin coste"
            v={`${fmtInt(b.pedidos)} · ${fmtPct(b.pct_pedidos)} de los pedidos`} />
          <Linea t="…y su importe"
            v={`${fmtMoney(b.neto)} · ${fmtPct(b.pct_importe)} del dinero`} />
          <Linea t="Pedidos con un modificador cobrado y sin coste"
            v={fmtInt(b.pedidos_con_modificador_cobrado_sin_impacto)} />
          <p className="text-[11px] text-text-secondary pt-1 leading-snug">
            La resta no es {fmtInt(a.pedidos)} − {fmtInt(b.pedidos_con_modificador_cobrado_sin_impacto)}:
            {' '}sólo restan los que ya estaban dentro del nivel anterior.
          </p>
        </dl>
        <aside className="rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning mb-1.5">
            <AlertTriangle size={13} />Lo que la cobertura no mide
          </p>
          <p className="text-[13px] text-text-primary leading-snug">{c.sesgo_no_medido}</p>
          <p className="mt-2 text-[13px] text-text-primary leading-snug">
            Por eso el margen <strong>se ve en pantalla y no se manda por correo</strong> hasta que ese
            sesgo esté medido.
          </p>
        </aside>
      </div>
    </section>
  )
}

const Linea = ({ t, v }: { t: string; v: string }) => (
  <div className="flex flex-wrap justify-between gap-2 border-b border-border-default/60 pb-1">
    <dt className="text-text-secondary">{t}</dt>
    <dd className="font-medium text-text-primary tabular-nums">{v}</dd>
  </div>
)

function Acciones({ onCsv, onXlsx }: { onCsv: () => void; onXlsx: () => void }) {
  return (
    <section className="flex flex-wrap items-center gap-2 pt-1">
      <Boton onClick={onCsv} icon={<FileDown size={14} />} label="Descargar CSV" primario />
      <Boton onClick={onXlsx} icon={<FileDown size={14} />} label="Descargar XLSX" />
      {/* Lote 3. Apagado con el motivo escrito, no escondido. */}
      <Boton disabled icon={<Save size={14} />} label="Guardar esta configuración" />
      <Boton disabled icon={<Mail size={14} />} label="Programar por correo" />
      <p className="text-[11px] text-text-secondary basis-full leading-snug">
        «Guardar» llega en el siguiente lote. <strong>«Programar por correo» se enciende cuando B73
        esté medido</strong>: un informe que no se puede lanzar a mano no se programa, y un margen
        sesgado hacia arriba no se manda solo cada lunes.
      </p>
    </section>
  )
}

function Boton({ onClick, icon, label, primario, disabled }: {
  onClick?: () => void; icon: React.ReactNode; label: string; primario?: boolean; disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border transition-colors ${
        disabled ? 'border-border-default bg-page text-text-tertiary cursor-not-allowed'
          : primario ? 'border-terracota bg-terracota text-white hover:opacity-90'
          : 'border-border-default bg-card text-text-primary hover:bg-page'
      }`}>{icon}{label}</button>
  )
}
