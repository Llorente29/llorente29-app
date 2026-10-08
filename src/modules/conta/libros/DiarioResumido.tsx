// src/modules/conta/libros/DiarioResumido.tsx
//
// C05 · El diario resumido (Diez «Diario resumido»): por cada mes, una fila por
// cuenta con lo que sumó al Debe y al Haber. Cuadra mes a mes (Debe = Haber) o
// lo dice en rojo. Sale del Mayor (journal_ledger), así que solo lleva lo
// validado y lo anulado con su contraasiento, como el libro.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaMayor } from '@/config/navegacion'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelTabla, pdfTabla, type FilaTabla } from '@/modules/conta/libros/exportar'
import { resumir } from '@/modules/conta/lib/extractos'
import { movimientos } from '@/modules/conta/services/librosService'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const c = (n: number) => Math.round(n * 100)

export function DiarioResumido() {
  const L = useLibros()
  const [nivel, setNivel] = useState<number | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const d = useLeer(() => movimientos(L.accountId, L.companyId, L.ejercicio.inicio, L.ejercicio.fin), `${L.companyId}:${L.ejercicio.id}:${L.vuelta}`)
  const meses = useMemo(() => (d.datos ? resumir(d.datos, nivel) : null), [d.datos, nivel])

  const filasExport = (): FilaTabla[] => (meses ?? []).flatMap((m) => [
    ...m.filas.map((f): FilaTabla => [nombreMes(m.mes), f.cuenta, f.nombre, f.debe, f.haber]),
    [nombreMes(m.mes), '', `Total del mes (${m.asientos} asientos)`, m.debe, m.haber],
  ])
  const exportar = (como: 'pdf' | 'excel') => {
    const filas = filasExport()
    const nombre = `Diario resumido ${L.ejercicio.code}`
    const cab = ['Mes', 'Cuenta', 'Nombre', 'Debe', 'Haber']
    const ok = como === 'pdf' ? pdfTabla(`${nombre}.pdf`, 'Diario resumido', `Ejercicio ${L.ejercicio.code} · por mes y cuenta`, cab, filas) : excelTabla(`${nombre}.xlsx`, 'Diario resumido', cab, filas)
    setHecho(ok ? `Bajado: ${nombre}.${como === 'pdf' ? 'pdf' : 'xlsx'}, ${meses?.length ?? 0} meses y ${filas.length} filas.` : 'No había nada que bajar: el ejercicio aún no tiene asientos validados.')
  }

  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Diario resumido">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Diario' }]} /><h2>Diario resumido</h2></div>
        <div className="cxl-herramientas">
          <div className="cxl-segmento" role="group" aria-label="Nivel">
            {([[null, 'Subcuenta'], [3, 'Cuenta'], [2, 'Subgrupo']] as const).map(([n, t]) => (
              <button key={t} type="button" aria-pressed={nivel === n} onClick={() => setNivel(n)}>{t}</button>
            ))}
          </div>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('pdf')} disabled={!meses}>Exportar PDF</button>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('excel')} disabled={!meses}>Excel</button>
        </div>
      </div>
      <Guardado texto={hecho} />
      {!meses && <div className="cx-tarjeta" aria-busy="true">{[0, 1, 2].map((i) => <Hueso key={i} alto={36} />)}</div>}
      {meses && !meses.length && <div className="cx-tarjeta"><Vacio titulo="Aún no hay asientos validados en este ejercicio." explicacion="El diario resumido suma lo validado mes a mes; las propuestas no entran." /></div>}
      {meses?.map((m) => {
        const cuadra = c(m.debe) === c(m.haber)
        return (
          <div key={m.mes} className="cx-tarjeta" style={{ overflowX: 'auto' }}>
            <table className="cxl-tabla" aria-label={`Diario resumido de ${nombreMes(m.mes)}`}>
              <caption className="cxl-titulo">{nombreMes(m.mes)} · {m.asientos} {m.asientos === 1 ? 'asiento' : 'asientos'}</caption>
              <thead><tr><th>Cuenta</th><th>Nombre</th><th className="cxl-der">Debe</th><th className="cxl-der">Haber</th></tr></thead>
              <tbody>
                {m.filas.map((f) => (
                  <tr key={f.cuenta}><td>{nivel ? f.cuenta : <Link to={rutaMayor(f.cuenta)}>{f.cuenta}</Link>}</td><td>{f.nombre}</td>
                    <td className="cxl-der">{f.debe ? eurosExactos(f.debe) : ''}</td><td className="cxl-der">{f.haber ? eurosExactos(f.haber) : ''}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2} className="cxl-total">Total del mes</td><td className="cxl-der cxl-total">{eurosExactos(m.debe)}</td><td className="cxl-der cxl-total">{eurosExactos(m.haber)}</td></tr></tfoot>
            </table>
            <p className={cuadra ? 'cxl-pie' : 'cxl-sin-sitio'} role="status">{cuadra ? `Cuadra: Debe = Haber · ✓ ${eurosExactos(m.debe)}` : `No cuadra: ${eurosExactos(Math.abs(m.debe - m.haber))} de diferencia entre Debe y Haber. Un asiento validado siempre cuadra: avisa, es un fallo.`}</p>
          </div>
        )
      })}
    </section>
  )
}
