// src/modules/conta/libros/DiarioResumido.tsx
//
// C05 · El diario resumido (Diez «Diario resumido»): por cada mes, una fila por
// cuenta con lo que sumó al Debe y al Haber. Cuadra mes a mes (Debe = Haber) o
// lo dice en rojo. Sale del Mayor (journal_ledger), así que solo lleva lo
// validado y lo anulado con su contraasiento, como el libro.
//
// S02 · PR 2 · El encabezado del patrón (EncabezadoLibro), el nivel con el
// segmento del patrón y cada mes en su caja, con el estilo de tabla del patrón.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaMayor } from '@/config/navegacion'
import { Boton } from '@/modules/conta/diseno'
import { ControlesInforme, VistaInforme } from '@/modules/conta/diseno/plantillas'
import { EncabezadoLibro } from '@/modules/conta/libros/EncabezadoLibro'
import { fraseDelPeriodo } from '@/modules/conta/libros/encabezado'
import { ErrorConReintento, Guardado, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelTabla, pdfTabla, type FilaTabla } from '@/modules/conta/libros/exportar'
import { resumir } from '@/modules/conta/lib/extractos'
import { movimientos } from '@/modules/conta/services/librosService'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const c = (n: number) => Math.round(n * 100)
/** El nivel, como id de la vista (VistaInforme trabaja con textos). */
const NIVELES = [{ id: 'subcuenta', nombre: 'Subcuenta', nivel: null }, { id: 'cuenta', nombre: 'Cuenta', nivel: 3 }, { id: 'subgrupo', nombre: 'Subgrupo', nivel: 2 }] as const
type IdNivel = (typeof NIVELES)[number]['id']

export function DiarioResumido() {
  const L = useLibros()
  const [idNivel, setIdNivel] = useState<IdNivel>('subcuenta')
  const nivel = NIVELES.find((n) => n.id === idNivel)?.nivel ?? null
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

  const encabezado = (
    <EncabezadoLibro titulo="Diario resumido"
      frase={`${fraseDelPeriodo(L.ejercicio.inicio, L.ejercicio.fin)}: por cada mes, lo que sumó cada ${NIVELES.find((n) => n.id === idNivel)!.nombre.toLowerCase()} al Debe y al Haber. Solo lo validado.`}
      secundarios={<>
        <Boton icono="descargar" onClick={() => exportar('pdf')} disabled={!meses}>Exportar PDF</Boton>
        <Boton onClick={() => exportar('excel')} disabled={!meses}>Excel</Boton>
      </>} />
  )
  if (d.error) return <section className="cxl-pagina" aria-label="Diario resumido">{encabezado}<ErrorConReintento mensaje={d.error} reintentar={d.recargar} /></section>
  return (
    <section className="cxl-pagina" aria-label="Diario resumido">
      {encabezado}
      <ControlesInforme>
        <VistaInforme etiqueta="Nivel" vistas={NIVELES} actual={idNivel} alCambiar={setIdNivel} />
      </ControlesInforme>
      <Guardado texto={hecho} />
      {!meses && <div className="s-lista-cargando" aria-busy="true" aria-label="Cargando el diario resumido" />}
      {meses && !meses.length && <div className="cxl-caja"><Vacio titulo="Aún no hay asientos validados en este ejercicio." explicacion="El diario resumido suma lo validado mes a mes; las propuestas no entran." /></div>}
      {meses?.map((m) => {
        const cuadra = c(m.debe) === c(m.haber)
        return (
          <div key={m.mes} className="cxl-caja">
            <table className="cxl-tabla cxl-apilada" aria-label={`Diario resumido de ${nombreMes(m.mes)}`}>
              <caption className="cxl-subtitulo">{nombreMes(m.mes)} · {m.asientos} {m.asientos === 1 ? 'asiento' : 'asientos'}</caption>
              <thead><tr><th>Cuenta</th><th>Nombre</th><th className="cxl-der">Debe</th><th className="cxl-der">Haber</th></tr></thead>
              <tbody>
                {m.filas.map((f) => (
                  <tr key={f.cuenta}><td>{nivel ? f.cuenta : <Link to={rutaMayor(f.cuenta)}>{f.cuenta}</Link>}</td><td>{f.nombre}</td>
                    <td className="cxl-der" data-titulo="Debe">{f.debe ? eurosExactos(f.debe) : ''}</td><td className="cxl-der" data-titulo="Haber">{f.haber ? eurosExactos(f.haber) : ''}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2} className="cxl-total">Total del mes</td><td className="cxl-der cxl-total" data-titulo="Debe">{eurosExactos(m.debe)}</td><td className="cxl-der cxl-total" data-titulo="Haber">{eurosExactos(m.haber)}</td></tr></tfoot>
            </table>
            <p className={cuadra ? 'cxl-pie' : 'cxl-sin-sitio'} role="status">{cuadra ? `Cuadra: Debe = Haber · ✓ ${eurosExactos(m.debe)}` : `No cuadra: ${eurosExactos(Math.abs(m.debe - m.haber))} de diferencia entre Debe y Haber. Un asiento validado siempre cuadra: avisa, es un fallo.`}</p>
          </div>
        )
      })}
    </section>
  )
}
