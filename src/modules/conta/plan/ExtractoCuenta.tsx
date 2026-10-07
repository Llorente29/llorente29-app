// src/modules/conta/plan/ExtractoCuenta.tsx
//
// El extracto de una cuenta en sus dos vistas: «Apunte a apunte» (con su saldo,
// desde la apertura del ejercicio) y «Saldos por mes» (debe, haber, saldo y
// acumulado, con la apertura y el cierre). Lo usan la ficha del proveedor
// (tarjeta «Saldo y movimientos» › Ver extracto) y el Mayor de cualquier cuenta
// del plan (respuesta 5 del C02): la misma pieza en los dos sitios.
//
// Los apuntes los pone el libro diario (C04). Sin apuntes sale el estado vacío,
// que lo dice claro, sin ceros que parezcan datos. El Mayor pide el saldo
// deudor (debe − haber); la ficha del proveedor, el acreedor.

import { useState, type ReactNode } from 'react'
import { Tarjeta, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos, fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { extracto, saldosPorMes, type Apunte, type Naturaleza } from '@/modules/conta/lib/cuentasProveedor'

export interface EjercicioExtracto { code: string; inicio: string; fin: string }

export function ExtractoCuenta({ ejercicios, apuntes, vacio, documento, accion, titulo = 'Extracto', naturaleza = 'acreedora' }: {
  ejercicios: readonly EjercicioExtracto[]
  apuntes: readonly Apunte[]
  /** Qué se dice mientras no hay apuntes; recibe el ejercicio que se está mirando. */
  vacio: (ejercicio: string) => { titulo: string; explicacion: string }
  /** Cómo se pinta el documento de un apunte (un enlace a la factura, si lo hay). */
  documento?: (a: Apunte) => ReactNode
  accion?: ReactNode
  titulo?: string
  /** Signo del saldo: acreedora (haber − debe, la del proveedor) o deudora (debe − haber, la del Mayor). */
  naturaleza?: Naturaleza
}) {
  const hoy = hoyEnMadrid()
  const [vista, setVista] = useState<'apuntes' | 'meses'>('apuntes')
  const deHoy = ejercicios.find((e) => e.inicio <= hoy && e.fin >= hoy) ?? ejercicios[0] ?? null
  const [code, setCode] = useState(deHoy?.code ?? '')
  const ej = ejercicios.find((e) => e.code === code) ?? deHoy
  const rango = ej ?? { code: hoy.slice(0, 4), inicio: `${hoy.slice(0, 4)}-01-01`, fin: `${hoy.slice(0, 4)}-12-31` }
  const delEjercicio = apuntes.filter((a) => a.fecha >= rango.inicio && a.fecha <= rango.fin)
  const anteriores = apuntes.filter((a) => a.fecha < rango.inicio)
  const apertura = extracto(anteriores, 0, naturaleza).at(-1)?.saldo ?? 0
  const filas = extracto(delEjercicio, apertura, naturaleza)
  const meses = saldosPorMes(apuntes, rango, 0, naturaleza)
  const v = vacio(rango.code)
  return (
    <Tarjeta titulo={titulo} accion={accion}>
      <div className="cx-chips cxp-extracto-barra">
        <button type="button" className="cx-pildora" aria-pressed={vista === 'apuntes'} onClick={() => setVista('apuntes')}>Apunte a apunte</button>
        <button type="button" className="cx-pildora" aria-pressed={vista === 'meses'} onClick={() => setVista('meses')}>Saldos por mes</button>
        {ejercicios.length > 1 && (
          <select className="cx-input" aria-label="Ejercicio" value={rango.code} onChange={(e) => setCode(e.target.value)} style={{ width: 'auto' }}>
            {ejercicios.map((e) => <option key={e.code} value={e.code}>Ejercicio {e.code}</option>)}
          </select>
        )}
      </div>
      {apuntes.length === 0 ? (
        <Vacio titulo={v.titulo} explicacion={v.explicacion} />
      ) : vista === 'apuntes' ? (
        <table className="cxp-extracto">
          <thead><tr><th>Fecha</th><th>Documento</th><th>Concepto</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
          <tbody>
            <tr><td colSpan={5}>Apertura</td><td>{eurosExactos(apertura)}</td></tr>
            {filas.map((a, i) => (
              <tr key={`${a.documento}-${i}`}>
                <td>{fechaLarga(a.fecha)}</td><td>{documento ? documento(a) : a.documento}</td><td>{a.concepto}</td>
                <td>{a.debe ? eurosExactos(a.debe) : ''}</td><td>{a.haber ? eurosExactos(a.haber) : ''}</td><td>{eurosExactos(a.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="cxp-extracto">
          <thead><tr><th>Mes</th><th>Debe</th><th>Haber</th><th>Saldo</th><th>Acumulado</th></tr></thead>
          <tbody>
            <tr><td>Apertura</td><td /><td /><td /><td>{eurosExactos(meses.apertura)}</td></tr>
            {meses.meses.map((m) => (
              <tr key={m.mes}><td>{m.mes}</td><td>{eurosExactos(m.debe)}</td><td>{eurosExactos(m.haber)}</td><td>{eurosExactos(m.saldo)}</td><td>{eurosExactos(m.acumulado)}</td></tr>
            ))}
            <tr><td>Total del año</td><td>{eurosExactos(meses.debe)}</td><td>{eurosExactos(meses.haber)}</td><td /><td>Cierre {eurosExactos(meses.cierre)}</td></tr>
          </tbody>
        </table>
      )}
    </Tarjeta>
  )
}
