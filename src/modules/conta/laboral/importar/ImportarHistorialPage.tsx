// src/modules/conta/laboral/importar/ImportarHistorialPage.tsx
//
// LAB1 · Sumied › Laboral › Importar historial, tanda 1 (29/10/2026): «solo
// leer las cabeceras» del paquete de Cegid. El fichero se lee en el navegador;
// a la base va solo lo que cada hoja trae de cabeceras y cuántas filas tiene,
// y la comparación con lo esperado. Ningún valor.
//
// Enseña todas las hojas (regla 7): las que están como se esperaban, las que
// traen columnas distintas, las que faltan y las que no se esperaban. El botón
// dice lo que ha hecho, con números (regla 8).
//
// LAB2 (30/10) · Segundo paso, con las cabeceras como se esperan: cargar las
// filas de las nueve hojas, tal cual, en el lote (por trozos, con su avance).
// Volver a cargar el mismo fichero no duplica nada. Las filas llevan datos
// personales y solo las ve el administrador de la cuenta.
//
// N1 · PR 1 (01/11) · Tercer paso, con todas las filas cargadas: cada centro
// de Cegid con su local y «Pasar a las fichas» (VolcadoTarjeta).

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { compararCabeceras, resumenComparacion, type Comparacion, type ComparacionHoja } from './cegidCabeceras'
import { huellaDelFichero, leerCabeceras } from './leerCabeceras'
import { leerFilas, resumenFilas, type ResultadoFilas } from './leerFilas'
import { cargarFilas, guardarCabeceras, leerLotes, type LoteImportacion } from './importarService'
import VolcadoTarjeta from './VolcadoTarjeta'

const ESTADO: Record<ComparacionHoja['estado'], { texto: string; tono: 'seguro' | 'duda' | 'falta' | 'neutro' }> = {
  igual: { texto: 'Como se esperaba', tono: 'seguro' },
  diferente: { texto: 'Columnas distintas', tono: 'duda' },
  falta: { texto: 'Falta la hoja', tono: 'falta' },
  sobra: { texto: 'No se esperaba', tono: 'neutro' },
}

const fechaYHora = (iso: string) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function ImportarHistorialPage() {
  const { activeAccountId } = useApp()
  const [fichero, setFichero] = useState<File | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [comparacion, setComparacion] = useState<Comparacion | null>(null)
  const [hecho, setHecho] = useState('')
  const [error, setError] = useState('')
  const [lotes, setLotes] = useState<LoteImportacion[]>([])
  const [loteId, setLoteId] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [avance, setAvance] = useState('')
  const [filas, setFilas] = useState<ResultadoFilas | null>(null)

  const cargarLotes = useCallback(() => {
    if (!activeAccountId) return
    leerLotes(activeAccountId).then(setLotes).catch((e: Error) => setError(e.message))
  }, [activeAccountId])
  useEffect(() => { cargarLotes() }, [cargarLotes])

  async function leer() {
    if (!fichero || !activeAccountId) return
    setLeyendo(true); setError(''); setHecho(''); setComparacion(null); setLoteId(null); setFilas(null)
    try {
      const bytes = await fichero.arrayBuffer()
      const hojas = leerCabeceras(bytes)
      const c = compararCabeceras(hojas)
      const lote = await guardarCabeceras(activeAccountId, fichero.name, await huellaDelFichero(bytes), hojas, c)
      setComparacion(c)
      setLoteId(lote.id)
      setHecho(`${resumenComparacion(c)}. ${lote.repetido
        ? `Es el mismo fichero que el lote del ${fechaYHora(lote.subidoAt)}: no se crea otro, se ponen las cabeceras de ahora.`
        : `Guardado como lote nuevo, el ${fechaYHora(lote.subidoAt)}.`} No se ha guardado ningún valor de ninguna fila.`)
      cargarLotes()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido leer el fichero.')
    } finally {
      setLeyendo(false)
    }
  }

  async function cargar() {
    if (!fichero || !loteId) return
    setCargando(true); setError(''); setFilas(null); setAvance('Leyendo las filas del fichero…')
    try {
      const hojas = leerFilas(await fichero.arrayBuffer())
      const r = await cargarFilas(loteId, hojas, (hoja, hechas, total) =>
        setAvance(`Cargando ${hoja}: ${hechas.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')} filas…`))
      setFilas(r)
      cargarLotes()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido cargar las filas.')
    } finally {
      setCargando(false); setAvance('')
    }
  }

  return (
    <div className="s-pagina" data-prueba="laboral-importar">
      <Tarjeta titulo="Importar el historial de personal"
        apoyo="Del paquete de Cegid (lab_paquete_personal.xlsx), en dos pasos. Primero se leen solo las cabeceras de cada hoja, para comprobar que el fichero es el que se espera. Después, si lo es, se cargan sus filas en Sumied tal cual, para pasarlas a las fichas. El fichero se lee en este navegador y no se guarda; las filas, con sus datos personales, solo las ve el administrador de la cuenta." />

      <Tarjeta titulo="Leer las cabeceras" nivel={3}
        accion={<Boton variante="principal" icono="importar" onClick={leer} disabled={!fichero || leyendo} data-prueba="importar-leer">
          {leyendo ? 'Leyendo…' : 'Leer solo las cabeceras'}</Boton>}>
        <label className="s-campo"><span className="s-campo-etiqueta">Fichero de Cegid (.xlsx)</span>
          <input className="s-control" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { setFichero(e.target.files?.[0] ?? null); setComparacion(null); setHecho(''); setError('') }}
            data-prueba="importar-fichero" />
        </label>
      </Tarjeta>

      {hecho && <p className="s-aviso-lista" data-tono={comparacion?.completa ? 'seguro' : 'duda'} role="status" data-prueba="importar-hecho">{hecho}</p>}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert" data-prueba="importar-error">{error}</p>}

      {comparacion && (
        <Tarjeta titulo={comparacion.completa ? 'Las cabeceras son las que se esperan' : 'Las cabeceras no son del todo las que se esperan'} nivel={3}
          apoyo={comparacion.completa ? 'Ya se pueden cargar sus filas (abajo).' : 'Mira lo que falta o cambia en cada hoja. Puede que el paquete sea de otra versión: así no se cargan sus filas.'}>
          <table className="s-tabla" data-prueba="importar-hojas">
            <thead><tr><th>Hoja</th><th>Filas</th><th>Cabeceras</th><th>Qué pasa</th></tr></thead>
            <tbody>
              {comparacion.hojas.map((h) => (
                <tr key={`${h.id ?? 'x'}-${h.nombre}`} data-prueba={`importar-hoja-${h.id ?? 'otra'}`}>
                  <td>{h.nombre}</td>
                  <td className="s-num">{h.filas.toLocaleString('es-ES')}</td>
                  <td><Chip tono={ESTADO[h.estado].tono}>{ESTADO[h.estado].texto}</Chip></td>
                  <td>
                    {h.faltan.length > 0 && h.estado !== 'falta' && <span>Faltan: {h.faltan.join(', ')}. </span>}
                    {h.nuevas.length > 0 && <span>{h.estado === 'sobra' ? 'Trae' : 'Nuevas'}: {h.nuevas.join(', ')}.</span>}
                    {h.estado === 'falta' && <span>El fichero no trae esta hoja.</span>}
                    {h.estado === 'igual' && <span>Todas las columnas, en su sitio.</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}

      {comparacion?.completa && loteId && (
        <Tarjeta titulo="Cargar las filas" nivel={3}
          apoyo={`Las ${comparacion.filas.toLocaleString('es-ES')} filas de las nueve hojas, tal cual. Si ya las habías cargado de este mismo fichero, se ponen al día sin duplicar nada.`}
          accion={<Boton variante="principal" icono="subir" onClick={cargar} disabled={cargando} data-prueba="importar-cargar">
            {cargando ? 'Cargando…' : 'Cargar las filas en Sumied'}</Boton>}>
          {avance && <p className="s-apoyo" role="status" data-prueba="importar-avance">{avance}</p>}
          {filas && <p className="s-aviso-lista" data-tono={filas.completo ? 'seguro' : 'falta'} role="status" data-prueba="importar-filas">{resumenFilas(filas)}</p>}
        </Tarjeta>
      )}

      {/* N1 · PR 1: con todas las filas cargadas, el tercer paso. */}
      {loteId && filas?.completo && <VolcadoTarjeta key={loteId} loteId={loteId} />}

      <Tarjeta titulo={`Lotes leídos · ${lotes.length}`} nivel={3}
        apoyo={lotes.length ? undefined : 'Aún no se ha leído ningún fichero en esta cuenta.'}>
        {lotes.length > 0 && (
          <ul className="s-importar-lotes" data-prueba="importar-lotes">
            {lotes.map((l) => (
              <li key={l.id}>
                {l.ficheroNombre} · {fechaYHora(l.subidoAt)} · {l.hojas.length} hojas, {l.hojas.reduce((n, h) => n + h.filas, 0).toLocaleString('es-ES')} filas
                {' '}<Chip tono={l.completa ? 'seguro' : 'duda'}>{l.completa ? 'Cabeceras como se esperaban' : 'Cabeceras distintas'}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  )
}
