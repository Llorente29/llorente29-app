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

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export interface Eleccion { cuenta: string; concepto: string; regla: string | null }

/** «Otra cosa» / «Decirlo yo»: a qué va, en palabras; y si se quiere, que sea siempre así. */
export function DialogoCuenta({ m, alCerrar, alElegir, alApartar, apartando = false }: {
  m: MovimientoBanco
  /** B02 · Abrir directamente en «No va a contabilidad» (desde «¿Es otra cosa?»). */
  apartando?: boolean
  alCerrar: () => void
  alElegir: (e: Eleccion) => Promise<void>
  alApartar: (motivo: string) => Promise<void>
}) {
  const { datos } = useBancos()
  const [q, setQ] = useState('')
  const [cuenta, setCuenta] = useState<string | null>(null)
  const [concepto, setConcepto] = useState(m.propuesta?.que && m.estado === 'propuesto' ? m.propuesta.que : m.conceptoLimpio)
  const cp = contraparte(m.conceptoBanco || m.conceptoLimpio)
  const [siempre, setSiempre] = useState(false)
  const [apartar, setApartar] = useState(apartando)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Las cuentas de detalle del plan (8 cifras), por nombre o por código.
  const cuentas = useMemo(() => Object.entries(datos.nombres).filter(([c]) => c.length >= 8 && !c.startsWith('572'))
    .map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.codigo.localeCompare(b.codigo)), [datos.nombres])
  const vistas = useMemo(() => {
    const t = normal(q.trim())
    return (t ? cuentas.filter((c) => normal(`${c.nombre} ${c.codigo}`).includes(t)) : cuentas).slice(0, 40)
  }, [cuentas, q])

  const hacer = async (f: () => Promise<void>) => {
    setOcupado(true); setError(null)
    try { await f(); alCerrar() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }

  return (
    <Dialogo titulo={apartar ? 'Apartar este movimiento' : '¿A qué va este movimiento?'} alCerrar={alCerrar}>
      <p className="cx-ayuda">{diaMesCorto(m.fecha)} · {m.conceptoLimpio} · <span className="cx-cifra">{eurosExactos(m.importeCent / 100)}</span></p>
      {!apartar ? (
        <div className="cx-formulario">
          <label className="cx-campo">
            <span>Busca a qué va (por nombre o número)</span>
            <input className="cx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe: comida, alquiler, luz, 626…" autoFocus />
          </label>
          <ul className="cxl-buscar-lista cxb-cuentas" role="listbox" aria-label="Cuentas">
            {vistas.map((c) => (
              <li key={c.codigo} role="option" aria-selected={cuenta === c.codigo}>
                <a href="#" onClick={(e) => { e.preventDefault(); setCuenta(c.codigo) }} className={cuenta === c.codigo ? 'cxb-elegida' : undefined}>
                  <span>{c.nombre} · {c.codigo}</span>
                </a>
              </li>
            ))}
            {vistas.length === 0 && <li className="cx-ayuda">No hay ninguna cuenta que se llame así.</li>}
          </ul>
          <label className="cx-campo">
            <span>Cómo se llamará en contabilidad</span>
            <input className="cx-input" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
          </label>
          {cp && (
            <label className="cxb-check">
              <input type="checkbox" checked={siempre} onChange={(e) => setSiempre(e.target.checked)} />
              <span>Hazlo siempre así cuando el concepto tenga «{cp}» (queda en Reglas y se puede apagar)</span>
            </label>
          )}
          {error && <div className="cx-error" role="alert">{error}</div>}
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setApartar(true)} disabled={ocupado}>No es de la empresa…</button>
            <button type="button" className="cx-boton" disabled={!cuenta || !concepto.trim() || ocupado}
              onClick={() => hacer(() => alElegir({ cuenta: cuenta!, concepto: concepto.trim(), regla: siempre ? cp : null }))}>
              {ocupado ? 'Guardando…' : cuenta ? `Casar con ${datos.nombres[cuenta] ?? cuenta} · ${cuenta}` : 'Elige a qué va'}
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
