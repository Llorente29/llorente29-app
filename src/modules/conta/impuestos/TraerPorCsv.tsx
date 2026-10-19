// src/modules/conta/impuestos/TraerPorCsv.tsx
//
// I01c · P1 definitiva · «Ya lo presenté fuera · pegar CSV», como en Diez: se
// pega el CSV y Sumied trae de Hacienda el justificante ORIGINAL
// (conta-justificante-csv), lo lee (lib/justificanteAeat.ts) y enseña la ficha
// con el PDF al lado para revisarla antes de guardar. Si se sube un PDF (un
// reimpreso de Diez, que no se lee), se saca su CSV y se hace lo mismo.
//
// Nada se guarda hasta «Guardar en Presentados». En los errores (formato,
// Hacienda no lo tiene, no responde, es de otra empresa, Sumied aún no lee ese
// modelo) tampoco, y se dice en una frase (justificantes.ts).
// El formato se comprueba aquí ANTES de llamar: la AEAT tiene un tope diario
// de intentos fallidos. Si Hacienda lo da y Sumied aún no lo lee, «Escribirlo a
// mano» (el mismo diálogo de «Subir justificantes») lo guarda con ese PDF.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { csvValido, limpiarCsv, tituloJustificante, type Justificante } from '@/modules/conta/lib/justificanteAeat'
import { eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { apuntarJustificante, leerJustificantePdf, repasarJustificantes, traerJustificanteCsv } from '@/modules/conta/services/impuestosService'
import { datosDe, fraseDeHacienda, fraseNoSeLee, motivoEnPalabras, pideDevolucion, resultadoEnPalabras, type DatosJustificante, type Mirado } from './justificantes'
import { DialogoAMano } from './SubirJustificantes'

type Paso =
  | { que: 'pegar' }
  | { que: 'trayendo' }
  | { que: 'elegir'; candidatos: string[] }
  // Con pdf: Hacienda lo dio (o se subió) pero Sumied no lo lee: se puede escribir a mano y guardar con ese PDF.
  | { que: 'error'; mensaje: string; pdf?: Blob; nombre?: string; leido?: Partial<Justificante> }
  | { que: 'apuntando' }
  | { que: 'ficha'; j: Justificante; pdf: Blob; mirado: Mirado }
  | { que: 'guardando'; j: Justificante; pdf: Blob; mirado: Mirado }

export function TraerPorCsv({ companyId, alCerrar, alGuardar }: {
  companyId: string; alCerrar: () => void; alGuardar: (texto: string, ok: boolean) => void
}) {
  const [csv, setCsv] = useState('')
  const [paso, setPaso] = useState<Paso>({ que: 'pegar' })
  const limpio = limpiarCsv(csv)
  const valido = csvValido(limpio)
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => { campo.current?.focus() }, [])

  const traer = async (c: string) => {
    if (!csvValido(c)) { setPaso({ que: 'error', mensaje: fraseDeHacienda({ motivo: 'formato', mensaje: '' }) }); return }
    setCsv(c)
    setPaso({ que: 'trayendo' })
    const t = await traerJustificanteCsv(companyId, c)
    if (!t.ok) { setPaso({ que: 'error', mensaje: fraseDeHacienda(t) }); return }
    const l = await leerJustificantePdf(t.pdf, `${c}.pdf`)
    if (!l.ok) { setPaso({ que: 'error', mensaje: fraseNoSeLee(l, true), pdf: t.pdf, nombre: `${c}.pdf`, leido: { ...l.parcial, csv: l.parcial.csv ?? c } }); return }
    const [m] = await repasarJustificantes(companyId, [datosDe(l.datos, null, false, true)]).catch((e: unknown) => [{ i: 0, estado: 'error', motivo: e instanceof Error ? e.message : String(e), declaracion: null } as Mirado])
    if (m.estado === 'error') { setPaso({ que: 'error', mensaje: motivoEnPalabras(m.motivo) }); return }
    setPaso({ que: 'ficha', j: l.datos, pdf: t.pdf, mirado: m })
  }

  const subirPdf = async (f: File) => {
    setPaso({ que: 'trayendo' })
    const l = await leerJustificantePdf(f)
    const visto = l.csvVisto ?? { csv: null, candidatos: [] }
    if (visto.csv) { await traer(visto.csv); return }
    if (visto.candidatos.length > 1) { setPaso({ que: 'elegir', candidatos: visto.candidatos }); return }
    setPaso({ que: 'error', mensaje: l.ok || l.causa !== 'no_pdf' ? fraseNoSeLee({ motivo: '', parcial: {} }, false) : l.motivo })
  }

  const guardar = async (j: Justificante, pdf: Blob, mirado: Mirado, devolucion: boolean) => {
    setPaso({ que: 'guardando', j, pdf, mirado })
    try {
      alGuardar(await apuntarJustificante(companyId, datosDe(j, null, devolucion, true), pdf), true)
    } catch (e) {
      setPaso({ que: 'error', mensaje: `No se ha guardado: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  // «Escribirlo a mano»: se repasa con la base (otra empresa, ya estaba) y se guarda con el PDF de Hacienda.
  // Sin la marca de «traído de Hacienda»: las cifras las ha escrito una persona, no están comprobadas.
  const [aMano, setAMano] = useState<{ pdf: Blob; nombre: string; leido: Partial<Justificante> } | null>(null)
  const guardarAMano = async (d: DatosJustificante, pdf: Blob) => {
    setAMano(null)
    setPaso({ que: 'apuntando' })
    try {
      const [m] = await repasarJustificantes(companyId, [d])
      if (m?.estado === 'error') { setPaso({ que: 'error', mensaje: motivoEnPalabras(m.motivo) }); return }
      alGuardar(await apuntarJustificante(companyId, d, pdf), true)
    } catch (e) {
      setPaso({ que: 'error', mensaje: `No se ha guardado: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const ocupado = paso.que === 'trayendo' || paso.que === 'guardando' || paso.que === 'apuntando'
  return (
    <Tarjeta titulo="Ya lo presenté fuera" apoyo="Pega el CSV del justificante y Sumied lo trae de Hacienda: el original, con todas sus casillas. Lo revisas y lo guardas."
      accion={<Boton variante="enlace" onClick={alCerrar}>Cerrar</Boton>}>
      <form className="s-csv-traer" onSubmit={(e) => { e.preventDefault(); if (valido && !ocupado) void traer(limpio) }}>
        <label className="s-csv-etiqueta" htmlFor="s-csv-campo">CSV del justificante</label>
        <div className="s-csv-fila">
          <input id="s-csv-campo" ref={campo} className="s-control s-csv-campo" value={csv} onChange={(e) => setCsv(e.target.value)}
            autoComplete="off" spellCheck={false} placeholder="16 letras y números" maxLength={24} disabled={ocupado}
            aria-invalid={csv !== '' && !valido} aria-describedby="s-csv-nota" />
          <Boton variante="principal" type="submit" disabled={!valido || ocupado}>Traer de Hacienda</Boton>
        </div>
        <p id="s-csv-nota" className="s-apoyo s-csv-nota">
          {csv !== '' && !valido ? 'Son 16 letras y números, como aparecen arriba en el justificante.' : 'Está en la primera página del justificante, como «Código Seguro de Verificación».'}
        </p>
        <label className="s-csv-pdf">
          <span>¿Tienes el PDF, aunque sea reimpreso? <span className="s-csv-pdf-enlace">Súbelo y saco el CSV</span></span>
          <input type="file" accept="application/pdf,.pdf" className="cx-oculto" disabled={ocupado} aria-label="Subir el PDF del justificante para sacar su CSV"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void subirPdf(f) }} />
        </label>
      </form>

      {paso.que === 'trayendo' && (
        <p className="s-csv-trayendo" role="status" aria-live="polite"><span className="s-csv-rueda" aria-hidden="true" />Trayendo el justificante de Hacienda…</p>
      )}
      {paso.que === 'apuntando' && (
        <p className="s-csv-trayendo" role="status" aria-live="polite"><span className="s-csv-rueda" aria-hidden="true" />Guardando en Presentados…</p>
      )}
      {paso.que === 'error' && <p className="s-impuestos-fallo s-csv-error" role="alert">{paso.mensaje}</p>}
      {paso.que === 'error' && paso.pdf && (
        <Boton variante="enlace" onClick={() => setAMano({ pdf: paso.pdf!, nombre: paso.nombre ?? 'justificante.pdf', leido: paso.leido ?? {} })}>Escribirlo a mano</Boton>
      )}
      {aMano && (
        <DialogoAMano nombre={aMano.nombre} leido={aMano.leido} noSeLeyo accion="Guardar en Presentados" alCerrar={() => setAMano(null)}
          alGuardar={(d) => void guardarAMano(d, aMano.pdf)} />
      )}
      {paso.que === 'elegir' && (
        <div className="s-csv-elegir" role="group" aria-label="Elige el CSV">
          <p className="s-apoyo">En ese PDF hay {paso.candidatos.length} códigos que pueden ser el CSV. ¿Cuál es el de arriba en la primera página?</p>
          {paso.candidatos.map((c) => <Boton key={c} onClick={() => void traer(c)}>{c}</Boton>)}
        </div>
      )}
      {(paso.que === 'ficha' || paso.que === 'guardando') && (
        <Ficha j={paso.j} pdf={paso.pdf} mirado={paso.mirado} guardando={paso.que === 'guardando'}
          alGuardar={(devolucion) => void guardar(paso.j, paso.pdf, paso.mirado, devolucion)} alCancelar={() => { setPaso({ que: 'pegar' }); setCsv('') }} />
      )}
    </Tarjeta>
  )
}

function Ficha({ j, pdf, mirado, guardando, alGuardar, alCancelar }: {
  j: Justificante; pdf: Blob; mirado: Mirado; guardando: boolean; alGuardar: (devolucion: boolean) => void; alCancelar: () => void
}) {
  // El 303 del último periodo que sale negativo: compensar o devolver lo pidió quien lo presentó.
  const preguntar = pideDevolucion({ modelo: j.modelo, periodo: j.periodo, resultado: j.resultado?.importe ?? null })
  const [devolucion, setDevolucion] = useState(false)
  const url = useMemo(() => URL.createObjectURL(pdf), [pdf])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const [fecha, hora] = j.presentada.split('T')
  const res = resultadoEnPalabras(j)
  const casillas = Object.entries(j.casillas).sort(([a], [b]) => Number(a) - Number(b))
  const yaEstaba = mirado.estado === 'ya_estaba'
  return (
    <div className="s-csv-ficha" data-prueba="ficha-traida">
      <div className="s-csv-datos">
        <div className="s-csv-cabeza">
          <h3 className="s-csv-titulo">{tituloJustificante(j)}</h3>
          <Chip tono="seguro">Traído de Hacienda</Chip>
        </div>
        <dl className="s-csv-dl">
          <dt>Modelo</dt><dd>{j.modelo}</dd>
          <dt>Periodo</dt><dd>{j.periodo} de {j.ejercicio}</dd>
          <dt>Presentado</dt><dd>el {fechaLarga(fecha)} a las {hora}</dd>
          <dt>Nº de justificante</dt><dd className="s-cifra">{j.justificante ?? '—'}</dd>
          <dt>CSV</dt><dd className="s-impuestos-csv">{j.csv}</dd>
          <dt>Expediente</dt><dd>{j.expediente ?? '—'}</dd>
          <dt>Presentador</dt><dd>{j.presentador ? `${j.presentador.nombre} (${j.presentador.nif})` : '—'}</dd>
          <dt>Resultado</dt><dd data-prueba="resultado"><span className="s-cifra">{res.importe}</span> · {res.que}{res.compensado && <span className="s-csv-compensado">{res.compensado}</span>}</dd>
        </dl>
        {casillas.length > 0 && (
          <details className="s-csv-casillas" open>
            <summary>{casillas.length} casillas del impreso</summary>
            <table className="s-tabla s-justificantes-dif-tabla">
              <thead><tr><th scope="col">Casilla</th><th scope="col" className="s-tabla-cifra">Importe</th></tr></thead>
              <tbody>{casillas.map(([k, v]) => (
                <tr key={k}><td><span className="s-impuestos-casilla">[{k}]</span></td><td className="s-tabla-cifra">{eurosExactos(v)}</td></tr>
              ))}</tbody>
            </table>
          </details>
        )}
        {mirado.estado === 'completa' && (mirado.diferencias?.length ?? 0) > 0 && (
          <p className="s-apoyo">Sumied lo había calculado y {mirado.diferencias!.length} casillas no coinciden: al guardar, mandan las del justificante y las diferencias quedan apuntadas.</p>
        )}
        {yaEstaba && <p className="s-apoyo">{mirado.motivo}</p>}
        {preguntar && (
          <fieldset className="s-csv-devolucion">
            <legend>Sale negativo en el último periodo del año: ¿qué se pidió?</legend>
            <label><input type="radio" name="s-csv-dev" checked={!devolucion} onChange={() => setDevolucion(false)} /> Compensar en el siguiente</label>
            <label><input type="radio" name="s-csv-dev" checked={devolucion} onChange={() => setDevolucion(true)} /> La devolución</label>
          </fieldset>
        )}
        <div className="s-csv-acciones">
          <Boton onClick={alCancelar} disabled={guardando}>Cancelar</Boton>
          <Boton variante="principal" onClick={() => alGuardar(devolucion)} disabled={guardando}>
            {guardando ? 'Guardando…' : yaEstaba ? (mirado.falta_pdf ? 'Guardar el PDF' : 'Guardar igualmente') : 'Guardar en Presentados'}
          </Boton>
        </div>
      </div>
      <iframe className="s-csv-pdf-visor" src={url} title={`Justificante de Hacienda: ${tituloJustificante(j)}`} />
    </div>
  )
}
