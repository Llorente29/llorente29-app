// src/modules/conta/bancos/dialogos.tsx
//
// B01 · Las ventanas de «Otra cosa / Decirlo yo» y «Buscar factura». Lenguaje
// de administrativo: se elige a qué va el movimiento («Comida y bebida ·
// 60000000»), nunca una «subcuenta». Cada una confirma con contenido o dice
// el fallo en pantalla (regla 8).

import { useEffect, useMemo, useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { eurosExactos, diaMesCorto } from '@/modules/conta/lib/formato'
import { contraparte } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { facturasPendientes, type FacturaPendiente } from '@/modules/conta/services/bancosPantallas'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { cuentas, leerImporte, lineaNueva, lineasParaRegla, porQueNoSeCasa, textoImporte, type LineaReparto, type LineaRegla } from '@/modules/conta/lib/reparto'
import { opcionesDePeriodo } from '@/modules/conta/lib/pagoDeModelo'

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** S01d · Lo que se elige: una o varias cuentas con su importe (el reparto), el concepto y si se recuerda. */
export interface Eleccion {
  lineas: { cuenta: string; importeCent: number; concepto: string | null; modelo?: string; periodo?: string }[]
  concepto: string
  /** «Recordar este reparto» / «Hazlo siempre así»: el texto del concepto que lo dispara. */
  regla: string | null
  /** Lo que guarda la regla (cada importe fijo). */
  paraRegla: LineaRegla[]
}

const MODELOS_4751 = ['111', '115', '123'] as const

/** La línea de partida: el reparto de la regla que no cuadró, la propuesta, o una línea con todo el importe. */
function lineasDeInicio(m: MovimientoBanco): LineaReparto[] {
  const reparto = m.propuesta?.reparto
  if (reparto && reparto.length) {
    return reparto.map((l) => ({ cuenta: l.cuenta, importe: l.importeCent === null ? '' : textoImporte(l.importeCent), concepto: l.concepto ?? '',
      ...(l.modelo ? { modelo: l.modelo } : {}), ...(l.periodo ? { periodo: l.periodo } : {}) }))
  }
  const d = m.propuesta?.destino as { tipo?: string; lineas?: { cuenta: string; importe: number; concepto?: string; modelo?: string; periodo?: string }[] } | null | undefined
  if (d?.tipo === 'cuenta' && d.lineas?.length) {
    return d.lineas.map((l) => ({ cuenta: l.cuenta, importe: textoImporte(Math.round(l.importe * 100)), concepto: l.concepto ?? '',
      ...(l.modelo ? { modelo: l.modelo } : {}), ...(l.periodo ? { periodo: l.periodo } : {}) }))
  }
  return [{ cuenta: '', importe: textoImporte(Math.abs(m.importeCent)), concepto: '' }]
}

/**
 * «Decirlo yo · a qué va este movimiento» (tableros 1 y 2 del S01d): una o
 * varias cuentas, cada una con su importe, hasta que «Falta por repartir» es
 * 0,00 €. No se casa antes. Y «Recordar este reparto» lo deja en Reglas.
 */
export function DialogoCuenta({ m, alCerrar, alElegir, alApartar, apartando = false }: {
  m: MovimientoBanco
  /** B02 · Abrir directamente en «No va a contabilidad» (desde «¿Es otra cosa?»). */
  apartando?: boolean
  alCerrar: () => void
  alElegir: (e: Eleccion) => Promise<void>
  alApartar: (motivo: string) => Promise<void>
}) {
  const { datos } = useBancos()
  const [lineas, setLineas] = useState<LineaReparto[]>(() => lineasDeInicio(m))
  const [concepto, setConcepto] = useState(m.propuesta?.que && m.estado === 'propuesto' && !m.propuesta.reparto ? m.propuesta.que : m.conceptoLimpio)
  const cp = contraparte(m.conceptoBanco || m.conceptoLimpio)
  const [siempre, setSiempre] = useState(false)
  const [apartar, setApartar] = useState(apartando)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Las cuentas de detalle del plan (8 cifras), para el desplegable de cada línea.
  const plan = useMemo(() => Object.entries(datos.nombres).filter(([c]) => c.length >= 8 && !c.startsWith('572'))
    .map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.codigo.localeCompare(b.codigo)), [datos.nombres])
  const existe = (c: string) => c.length >= 8 && !c.startsWith('572') && datos.nombres[c] !== undefined
  const movCent = Math.abs(m.importeCent)
  const { repartidoCent, faltaCent } = cuentas(movCent, lineas)
  const motivoNo = porQueNoSeCasa(movCent, lineas, existe)
  const anio = Number(m.fecha.slice(0, 4))

  const cambiar = (i: number, cambio: Partial<LineaReparto>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambio } : l)))
  /** Escribir la cuenta por nombre también vale: «Intereses de deudas · 66230000» → 66230000. */
  const leerCuenta = (t: string) => (t.match(/(\d{8,})\s*$/) ?? [])[1] ?? t.trim()

  const hacer = async (f: () => Promise<void>) => {
    setOcupado(true); setError(null)
    try { await f(); alCerrar() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }
  const casar = () => hacer(() => alElegir({
    lineas: lineas.map((l) => ({ cuenta: l.cuenta.trim(), importeCent: leerImporte(l.importe)!, concepto: l.concepto.trim() || null,
      ...(l.cuenta.startsWith('4751') && l.modelo && l.periodo ? { modelo: l.modelo, periodo: l.periodo } : {}) })),
    concepto: concepto.trim() || m.conceptoLimpio, regla: siempre ? cp : null, paraRegla: lineasParaRegla(lineas),
  }))
  const varias = lineas.length > 1

  return (
    <Dialogo titulo={apartar ? 'Apartar este movimiento' : 'Decirlo yo · a qué va este movimiento'} alCerrar={alCerrar}>
      <div className="cxr-cabeza">
        <div><span className="cx-ayuda">Fecha</span><strong>{diaMesCorto(m.fecha)}</strong></div>
        <div className="cxr-cabeza-concepto"><span className="cx-ayuda">Lo que dice el banco</span><strong>{m.conceptoBanco || m.conceptoLimpio}</strong></div>
        <div className="cxr-cabeza-importe"><span className="cx-ayuda">Importe</span><strong className="cx-cifra">{eurosExactos(m.importeCent / 100)}</strong></div>
      </div>
      {!apartar ? (
        <div className="cx-formulario">
          {m.propuesta?.reparto && m.propuesta.reparto.length > 0 && (
            <p className="cxr-aclarar" role="note"><strong>Por aclarar:</strong> el importe no es el de siempre. Ahí van las mismas cuentas: di cuánto va a cada una.</p>
          )}
          <div className="cxr-tabla" role="table" aria-label="Reparto del movimiento">
            <div className="cxr-fila cxr-titulos" role="row">
              <span role="columnheader">Cuenta</span><span role="columnheader">Nombre</span><span role="columnheader" className="cxr-num">Importe</span>
              <span role="columnheader">Concepto</span><span role="columnheader">Local</span><span />
            </div>
            {lineas.map((l, i) => (
              <div className="cxr-fila" role="row" key={i}>
                <input className="cx-input cxr-cuenta" aria-label={`Cuenta de la línea ${i + 1}`} list="cxr-plan" value={l.cuenta} autoFocus={i === 0 && !l.cuenta}
                  onChange={(e) => cambiar(i, { cuenta: leerCuenta(e.target.value) })} placeholder="Busca: 626, intereses…" />
                <span className="cxr-nombre">{datos.nombres[l.cuenta.trim()] ?? (l.cuenta.trim() ? 'No está en el plan' : '')}</span>
                <input className="cx-input cxr-num" aria-label={`Importe de la línea ${i + 1}`} inputMode="decimal" value={l.importe} onChange={(e) => cambiar(i, { importe: e.target.value })} />
                <input className="cx-input" aria-label={`Concepto de la línea ${i + 1}`} value={l.concepto} onChange={(e) => cambiar(i, { concepto: e.target.value })} placeholder={varias ? 'Capital, intereses…' : concepto} />
                <span className="cxr-local">Común</span>
                <button type="button" className="cxr-quitar" aria-label={`Quitar la línea ${i + 1}`} disabled={lineas.length === 1}
                  onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>×</button>
                {l.cuenta.startsWith('4751') && (
                  <div className="cxr-modelo">
                    <label>Modelo
                      <select className="cx-input" value={l.modelo ?? ''} onChange={(e) => cambiar(i, { modelo: e.target.value || undefined })}>
                        <option value="">—</option>{MODELOS_4751.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </label>
                    <label>Año
                      <select className="cx-input" value={l.periodo?.slice(0, 4) ?? ''} onChange={(e) => cambiar(i, { periodo: e.target.value ? `${e.target.value}-${l.periodo?.slice(5) || '1T'}` : undefined })}>
                        <option value="">—</option>{[anio, anio - 1, anio - 2].map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </label>
                    <label>Periodo
                      <select className="cx-input" value={l.periodo?.slice(5) ?? ''} onChange={(e) => cambiar(i, { periodo: e.target.value ? `${l.periodo?.slice(0, 4) || anio}-${e.target.value}` : undefined })}>
                        <option value="">—</option>{opcionesDePeriodo().map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            ))}
            <datalist id="cxr-plan">{plan.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}</datalist>
            <button type="button" className="cxr-otra" onClick={() => setLineas((ls) => [...ls, lineaNueva(movCent, ls)])}>+ Repartir en otra cuenta</button>
            <div className="cxr-total">
              <span>Movimiento <strong>{eurosExactos(movCent / 100)}</strong></span>
              <span>Repartido <strong>{eurosExactos(repartidoCent / 100)}</strong></span>
              <span className={faltaCent === 0 ? 'cxr-falta cxr-falta-cero' : 'cxr-falta'} aria-live="polite">
                {faltaCent >= 0 ? `Falta por repartir: ${eurosExactos(faltaCent / 100)}` : `Repartido de más: ${eurosExactos(-faltaCent / 100)}`}
              </span>
            </div>
          </div>
          <label className="cx-campo">
            <span>Cómo se llamará en contabilidad</span>
            <input className="cx-input" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
          </label>
          {cp && (
            <label className="cxb-check">
              <input type="checkbox" checked={siempre} onChange={(e) => setSiempre(e.target.checked)} />
              <span>{varias
                ? `Recordar este reparto: los próximos movimientos con «${cp}» saldrán ya repartidos, para confirmar (queda en Reglas y se puede apagar).`
                : `Hazlo siempre así cuando el concepto tenga «${cp}» (queda en Reglas y se puede apagar).`}</span>
            </label>
          )}
          {motivoNo && <p className="cx-ayuda" aria-live="polite">{motivoNo}</p>}
          {error && <div className="cx-error" role="alert">{error}</div>}
          <div className="cx-pie cxr-pie">
            <span className={faltaCent === 0 ? 'cxr-falta cxr-falta-cero cxr-solo-movil' : 'cxr-falta cxr-solo-movil'}>Falta por repartir: {eurosExactos(Math.max(faltaCent, 0) / 100)}</span>
            <button type="button" className="cx-boton-sec" onClick={() => setApartar(true)} disabled={ocupado}>No es de la empresa…</button>
            <button type="button" className="cx-boton" disabled={motivoNo !== null || ocupado} onClick={casar}>
              {ocupado ? 'Guardando…' : varias ? `Casar repartido en ${lineas.length} cuentas` : lineas[0].cuenta && existe(lineas[0].cuenta.trim()) ? `Casar con ${datos.nombres[lineas[0].cuenta.trim()]} · ${lineas[0].cuenta.trim()}` : 'Elige a qué va'}
            </button>
          </div>
        </div>
      ) : (
        <div className="cx-formulario">
          <label className="cx-campo">
            <span>Por qué se aparta (queda escrito y se puede volver a mirar)</span>
            <input className="cx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: es un cargo personal, ya lo devolvió el banco…" autoFocus />
          </label>
          {error && <div className="cx-error" role="alert">{error}</div>}
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setApartar(false)} disabled={ocupado}>Volver</button>
            <button type="button" className="cx-boton" disabled={!motivo.trim() || ocupado} onClick={() => hacer(() => alApartar(motivo.trim()))}>{ocupado ? 'Guardando…' : 'Apartarlo'}</button>
          </div>
        </div>
      )}
    </Dialogo>
  )
}

/** «Buscar factura»: las facturas recibidas pendientes, la de importe más parecido primero. */
export function DialogoFactura({ m, alCerrar, alElegir }: { m: MovimientoBanco; alCerrar: () => void; alElegir: (f: FacturaPendiente) => Promise<void> }) {
  const { companyId } = useBancos()
  const [facturas, setFacturas] = useState<FacturaPendiente[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    facturasPendientes(companyId).then((f) => { if (vivo) setFacturas(f) }, (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [companyId])
  const importe = Math.abs(m.importeCent)
  const vistas = useMemo(() => {
    const t = normal(q.trim())
    return (facturas ?? []).filter((f) => !t || normal(`${f.proveedor} ${f.numero ?? ''}`).includes(t))
      .sort((a, b) => Math.abs(a.pendienteCent - importe) - Math.abs(b.pendienteCent - importe)).slice(0, 30)
  }, [facturas, q, importe])

  return (
    <Dialogo titulo="¿Qué factura paga?" alCerrar={alCerrar}>
      <p className="cx-ayuda">{diaMesCorto(m.fecha)} · {m.conceptoLimpio} · <span className="cx-cifra">{eurosExactos(m.importeCent / 100)}</span></p>
      <input className="cx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Proveedor o número de factura" aria-label="Buscar factura" autoFocus />
      {!facturas && !error && <p className="cx-ayuda">Buscando las facturas sin pagar…</p>}
      {facturas && facturas.length === 0 && <p className="cx-ayuda">No hay ninguna factura recibida sin pagar. Si este pago no tiene factura, usa «Decirlo yo».</p>}
      <ul className="cxl-buscar-lista">
        {vistas.map((f) => (
          <li key={f.id}><a href="#" aria-disabled={!!ocupado} onClick={async (e) => {
            e.preventDefault(); if (ocupado) return
            setOcupado(f.id); setError(null)
            try { await alElegir(f); alCerrar() } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setOcupado(null) }
          }}>
            <span>{f.proveedor} · {f.numero ?? 'sin número'} <span className="cx-ayuda">del {diaMesCorto(f.fecha)}</span></span>
            <span className={`cx-cifra${f.pendienteCent === importe ? ' cxb-igual' : ''}`}>{ocupado === f.id ? 'Casando…' : `queda ${eurosExactos(f.pendienteCent / 100)}`}</span>
          </a></li>
        ))}
      </ul>
      {error && <div className="cx-error" role="alert">{error}</div>}
    </Dialogo>
  )
}
