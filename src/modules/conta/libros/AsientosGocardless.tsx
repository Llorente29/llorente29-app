// src/modules/conta/libros/AsientosGocardless.tsx
//
// X33 (25/11) · Los asientos de GoCardless del mes, en «Qué mirar antes de sacarlo» de «Salida a ERP10»: el cobro
// (57200002 / 430 del cliente), la devolución y el ingreso en el banco (57200000 / 57200002), sacados de lo que ya
// trae Sumied de GoCardless. «Preparar» los deja por revisar (no sube nada: sale cuando una persona los valida y la
// salida está encendida). Lo que no tiene su cliente, su 430 o su factura va a «Pendiente de revisar» con su motivo,
// arriba, y no para el resto. Solo sale en una empresa con algo de GoCardless ese mes.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento } from '@/config/navegacion'
import { useLeer } from '@/modules/conta/libros/contexto'
import { importe } from '@/modules/conta/erp10/salida'
import { aAsientosGc, comoEsta, enOrden, fraseDePreparar, queEs, resumenGc } from '@/modules/conta/erp10/qbo'
import { leerAsientosGc, prepararAsientosGc } from '@/modules/conta/services/erp10Service'

const dia = (f: string) => (/^\d{4}-\d{2}-\d{2}/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '—')

export function AsientosGocardless({ companyId, mes, mesTexto, quien, vuelta }: { companyId: string; mes: string; mesTexto: string; quien: string | null; vuelta: number }) {
  const [otra, setOtra] = useState(0)
  const leido = useLeer(() => leerAsientosGc(companyId, mes), `${companyId}:gc:${mes}:${otra}:${vuelta}`)
  const [haciendo, setHaciendo] = useState(false)
  const [dicho, setDicho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ver, setVer] = useState(false)

  if (leido.error) return <div className="cxe-aviso" role="note"><p>No se han podido leer los asientos de GoCardless: {leido.error}</p></div>
  if (!leido.datos) return null
  const a = aAsientosGc(leido.datos)
  const resumen = resumenGc(a, mesTexto)
  if (!resumen) return null
  const filas = enOrden(a.filas)
  const pendientes = filas.filter((f) => f.pendiente.length).length

  async function preparar() {
    setHaciendo(true); setDicho(null); setFallo(null)
    try {
      setDicho(fraseDePreparar(await prepararAsientosGc(companyId, mes, quien)))
      setOtra((v) => v + 1)
    } catch (e) {
      setFallo(`No se han preparado: ${e instanceof Error ? e.message : 'no ha contestado'}`)
    } finally {
      setHaciendo(false)
    }
  }

  return (
    <div className={pendientes ? 'cxe-aviso' : 'cxe-nota'} role="note" data-prueba="asientos-gocardless">
      <p><strong>{resumen.fuerte}</strong> {resumen.resto}</p>
      <div className="cxe-aviso-botones">
        <button type="button" className={pendientes ? 'cxe-ambar' : 'cxe-enlace'} disabled={haciendo} onClick={() => { void preparar() }}>
          {haciendo ? 'Preparando…' : `Preparar los de ${mesTexto}`}
        </button>
        {filas.length > 0 && <button type="button" className={pendientes ? 'cxe-ambar-sec' : 'cxe-enlace'} aria-expanded={ver} onClick={() => setVer((v) => !v)}>
          {ver ? 'Ocultar la lista' : `Ver la lista${pendientes ? ` · ${pendientes} pendientes de revisar` : ''}`}
        </button>}
      </div>
      {dicho && <p role="status" data-prueba="gc-preparados">{dicho}</p>}
      {fallo && <p role="alert">{fallo}</p>}
      {ver && (
        <table className="cxe-hoy-tabla" aria-label="Asientos de GoCardless">
          <thead><tr><th>Qué</th><th>Día</th><th>Cliente</th><th className="cxe-num">Importe</th><th>Cómo está</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={`${f.clase}:${f.gcId}`} data-tono={f.pendiente.length ? 'ambar' : 'gris'}>
                <td>{queEs(f.clase)}</td>
                <td className="cxe-num">{dia(f.fecha)}</td>
                <td title={f.cuenta ? `${f.cuenta} · ${f.concepto}` : f.concepto}>{f.nombre ?? (f.clase === 'ingreso' ? 'GoCardless' : '—')}</td>
                <td className="cxe-num">{importe(f.importe)}</td>
                <td className="cxe-hoy-estado" title={f.pendiente.join(' · ') || f.nota || undefined}>
                  {/* X33b · Con asiento (el suyo o, si la factura ya estaba cobrada, el que ya tenía), enlazado a él. */}
                  {f.entryId && !f.pendiente.length ? <Link className="cx-enlace" to={rutaAsiento(f.entryId)}>{comoEsta(f)}</Link> : comoEsta(f)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
