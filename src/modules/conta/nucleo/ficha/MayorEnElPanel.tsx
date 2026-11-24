// src/modules/conta/nucleo/ficha/MayorEnElPanel.tsx
//
// K05 · «El mayor del cliente» (o de quien sea) en el panel de la derecha de
// una ficha del núcleo, como la maqueta de la emitida (nucleo_4): arriba el
// nombre, su cuenta, el ejercicio y lo que debe; debajo, fecha, concepto,
// debe, haber y el saldo que va quedando; la última fila, esta factura, en azul
// claro, mientras no está apuntada. Pieza común: la puede usar la recibida.

import { Link } from 'react-router-dom'
import { rutaMayor } from '@/config/navegacion'
import { cifra } from './textos'

export interface ApunteDelMayor { fecha: string; documento: string; concepto: string; debe: number; haber: number }

export function MayorEnElPanel({ nombre, subcuenta, ejercicio, apuntes, hay, estaFactura, signo, queDebe, sinElegir }: {
  nombre: string | null
  subcuenta: string
  ejercicio: string
  apuntes: readonly ApunteDelMayor[] | null
  /** ¿Hay quien elegido? */
  hay: boolean
  /** La fila de esta factura (aún sin apuntar): su fecha, su número y su importe al debe (+) o al haber (−). */
  estaFactura: { fecha: string; numero: string; importe: number } | null
  /** +1: el saldo es debe − haber (un cliente); −1: haber − debe (un proveedor). */
  signo: 1 | -1
  /** «nos debe», «le debes». */
  queDebe: string
  sinElegir: string
}) {
  if (!hay) return <p className="kf-panel-nota">{sinElegir}</p>
  if (!apuntes) return <p className="kf-panel-nota" aria-busy="true">Leyendo su mayor…</p>
  const ultimos = apuntes.slice(-30)
  // El saldo que va quedando, en céntimos: la suma de los de antes (sin reasignar nada al pintar).
  const cents = ultimos.map((a) => signo * (Math.round(a.debe * 100) - Math.round(a.haber * 100)))
  // Lo de antes de los 30 que se ven también cuenta en el saldo.
  const antes = apuntes.slice(0, Math.max(0, apuntes.length - ultimos.length)).reduce((t, a) => t + signo * (Math.round(a.debe * 100) - Math.round(a.haber * 100)), 0)
  const acumulado = cents.map((_, i) => antes + cents.slice(0, i + 1).reduce((t, x) => t + x, 0))
  const filas = ultimos.map((a, i) => ({ ...a, saldo: acumulado[i] / 100 }))
  const final = acumulado.length ? acumulado[acumulado.length - 1] : antes
  const conEsta = estaFactura ? (final + signo * Math.round(estaFactura.importe * 100)) / 100 : final / 100
  const fecha = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
  return (
    <div className="kf-mayor-caja">
      <p className="kf-mayor-titulo"><strong>{nombre ?? ''}</strong> · cuenta {subcuenta || '—'} · {ejercicio} · {queDebe} <strong data-prueba="mayor-saldo">{cifra(conEsta)}</strong></p>
      <table className="kf-mayor" aria-label={`El mayor de la ${subcuenta || 'cuenta'}`}>
        <thead><tr><th>Fecha</th><th>Concepto</th><th className="kf-cifra">Debe</th><th className="kf-cifra">Haber</th><th className="kf-cifra">Saldo</th></tr></thead>
        <tbody>
          {filas.map((a, i) => (
            <tr key={i}><td>{fecha(a.fecha)}</td><td>{a.documento ? `${a.documento}${a.concepto && !a.concepto.includes(a.documento) ? ` · ${a.concepto}` : ''}` : a.concepto}</td>
              <td className="kf-cifra">{a.debe ? cifra(a.debe) : ''}</td><td className="kf-cifra">{a.haber ? cifra(a.haber) : ''}</td><td className="kf-cifra">{cifra(a.saldo)}</td></tr>
          ))}
          {estaFactura && (
            <tr data-esta="si"><td>{fecha(estaFactura.fecha)}</td><td>{estaFactura.numero || 'Sin número'} · esta factura</td>
              <td className="kf-cifra">{signo * estaFactura.importe > 0 ? cifra(Math.abs(estaFactura.importe)) : ''}</td>
              <td className="kf-cifra">{signo * estaFactura.importe < 0 ? cifra(Math.abs(estaFactura.importe)) : ''}</td><td className="kf-cifra">{cifra(conEsta)}</td></tr>
          )}
        </tbody>
      </table>
      {!apuntes.length && !estaFactura && <p className="kf-panel-nota">La {subcuenta || 'subcuenta'} no tiene apuntes todavía.</p>}
      {subcuenta && <p className="kf-panel-nota"><Link to={rutaMayor(subcuenta)}>Ver el mayor entero de la {subcuenta}</Link></p>}
    </div>
  )
}
