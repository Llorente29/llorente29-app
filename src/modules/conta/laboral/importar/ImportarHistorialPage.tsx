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

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { compararCabeceras, resumenComparacion, type Comparacion, type ComparacionHoja } from './cegidCabeceras'
import { huellaDelFichero, leerCabeceras } from './leerCabeceras'
import { guardarCabeceras, leerLotes, type LoteImportacion } from './importarService'

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

  const cargarLotes = useCallback(() => {
    if (!activeAccountId) return
    leerLotes(activeAccountId).then(setLotes).catch((e: Error) => setError(e.message))
  }, [activeAccountId])
  useEffect(() => { cargarLotes() }, [cargarLotes])

  async function leer() {
    if (!fichero || !activeAccountId) return
    setLeyendo(true); setError(''); setHecho(''); setComparacion(null)
    try {
      const bytes = await fichero.arrayBuffer()
      const hojas = leerCabeceras(bytes)
      const c = compararCabeceras(hojas)
      const lote = await guardarCabeceras(activeAccountId, fichero.name, await huellaDelFichero(bytes), hojas, c)
      setComparacion(c)
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

  return (
    <div className="s-pagina" data-prueba="laboral-importar">
      <Tarjeta titulo="Importar el historial de personal"
        apoyo="Del paquete de Cegid (lab_paquete_personal.xlsx). Primer paso: leer solo las cabeceras de cada hoja, para comprobar que el fichero es el que se espera. El fichero se lee en este navegador: no se sube, y a Sumied solo llegan los nombres de las columnas y cuántas filas tiene cada hoja." />

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
          apoyo={comparacion.completa ? 'Con esto se puede preparar la lectura de las filas (siguiente paso).' : 'Mira lo que falta o cambia en cada hoja. Puede que el paquete sea de otra versión.'}>
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
