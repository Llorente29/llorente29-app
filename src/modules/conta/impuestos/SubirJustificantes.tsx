// src/modules/conta/impuestos/SubirJustificantes.tsx
//
// I01c · P1 · Impuestos › Presentados › «Subir justificantes».
//   1. Una zona grande donde se arrastran uno o varios PDF (o se eligen).
//   2. Sumied los lee en el navegador (lib/justificanteAeat.ts) y la base los
//      mira (conta_impuesto_justificantes_repasar): la lista de repaso, en
//      palabras («IVA del trimestre · 1T 2026»), con un chip por fila (Leído,
//      Ya estaba o No se pudo leer), el porqué y, si Sumied lo había
//      calculado, las diferencias casilla a casilla.
//   3. Lo que no se pudo leer se puede escribir a mano, con su motivo.
//   4. «Guardar»: uno a uno (conta_impuesto_justificante_apuntar y su PDF), y
//      se dice qué se ha guardado y qué no (regla 8).
// En el móvil la lista va en tarjetas (la tabla de impuestos.css).

import { useRef, useState } from 'react'
import { Boton, Campo, Chip, Dialogo, Fecha, Selector, Tarjeta, Texto, textoDeImporte } from '@/modules/conta/diseno'
import { eurosExactos } from '@/modules/conta/lib/formato'
import type { Lectura } from '@/modules/conta/lib/justificanteAeat'
import { apuntarJustificante, leerJustificantePdf, repasarJustificantes, traerJustificanteCsv } from '@/modules/conta/services/impuestosService'
import {
  casillaResultado, casillasEscritas, chipDe, datosDe, fraseDeHacienda, fraseNoSeLee, lineaDe, pideDevolucion, resumenGuardado, tituloDe, type DatosJustificante, type Mirado,
} from './justificantes'

interface Fila {
  clave: string
  fichero: File
  lectura: Lectura | null // null: leyendo
  /** El PDF no se leía (un reimpreso) y se trajo el original de Hacienda por su CSV: fichero es ya el original. */
  traido?: boolean
  datos: DatosJustificante | null
  mirado: Mirado | null
  resultadoMano: string
  devolucion: boolean
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const sePuedeGuardar = (f: Fila) => !!f.datos && !!f.mirado && (f.mirado.estado === 'nuevo' || f.mirado.estado === 'completa' || (f.mirado.estado === 'ya_estaba' && !!f.mirado.falta_pdf))

export function SubirJustificantes({ companyId, alCerrar, alGuardar }: { companyId: string; alCerrar: () => void; alGuardar: (texto: string, ok: boolean) => void }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [sobre, setSobre] = useState(false)
  const [ocupado, setOcupado] = useState<'leyendo' | 'guardando' | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aMano, setAMano] = useState<Fila | null>(null)
  const n = useRef(0)

  /** Vuelve a pedir a la base el repaso de todo lo leído (después de leer, de escribir a mano o de dar el resultado). */
  const repasar = async (fs: Fila[]) => {
    const conDatos = fs.filter((f) => f.datos)
    if (!conDatos.length) { setFilas(fs); return }
    try {
      const m = await repasarJustificantes(companyId, conDatos.map((f) => f.datos!))
      setFilas(fs.map((f) => { const k = conDatos.indexOf(f); return k < 0 ? { ...f, mirado: null } : { ...f, mirado: m[k] ?? null } }))
      setFallo(null)
    } catch (e) {
      setFilas(fs)
      setFallo(`No se ha podido repasar con la base: ${msg(e)}`)
    }
  }

  const cargar = async (lista: FileList | File[]) => {
    const nuevos = Array.from(lista)
    if (!nuevos.length) return
    setOcupado('leyendo')
    let fs = [...filas, ...nuevos.map((f) => ({ clave: `j${n.current++}`, fichero: f, lectura: null, datos: null, mirado: null, resultadoMano: '', devolucion: false }))]
    setFilas(fs)
    for (const f of fs.filter((x) => x.lectura === null)) {
      const lectura = await leerJustificantePdf(f.fichero)
      let cambio: Partial<Fila> = { lectura, datos: lectura.ok ? datosDe(lectura.datos) : null }
      if (!lectura.ok) {
        // No se lee (un reimpreso de Diez, o un modelo que Sumied aún no lee): si se ve su CSV, se trae el
        // original de Hacienda. Lo que no salga se dice en UNA frase (fraseNoSeLee, fraseDeHacienda).
        const csv = lectura.causa === 'no_pdf' ? null : lectura.csvVisto?.csv
        const t = csv ? await traerJustificanteCsv(companyId, csv) : null
        const l2 = t?.ok ? await leerJustificantePdf(t.pdf, `${csv}.pdf`) : null
        if (t?.ok && l2?.ok) {
          cambio = { lectura: l2, datos: datosDe(l2.datos, null, false, true), traido: true, fichero: new File([t.pdf], f.fichero.name.replace(/\.pdf$/i, '') + '-original.pdf', { type: 'application/pdf' }) }
        } else {
          const frase = t && !t.ok ? fraseDeHacienda(t) : l2 && !l2.ok ? fraseNoSeLee(l2, true) : fraseNoSeLee(lectura, false)
          cambio = { lectura: { ok: false, parcial: (l2 && !l2.ok ? l2.parcial : null) ?? lectura.parcial, causa: (l2 && !l2.ok ? l2.causa : null) ?? lectura.causa, motivo: frase }, datos: null }
        }
      }
      fs = fs.map((x) => (x.clave === f.clave ? { ...x, ...cambio } : x))
      setFilas(fs)
    }
    await repasar(fs)
    setOcupado(null)
  }

  const cambiar = (clave: string, c: Partial<Fila>, otraVez = false) => {
    const fs = filas.map((f) => (f.clave === clave ? { ...f, ...c } : f))
    if (otraVez) void repasar(fs)
    else setFilas(fs)
  }

  const guardables = filas.filter(sePuedeGuardar)
  const guardar = async () => {
    setOcupado('guardando')
    const r: { ok: boolean; titulo: string; mensaje: string }[] = []
    for (const f of guardables) {
      const titulo = tituloDe(f.datos!)
      try { r.push({ ok: true, titulo, mensaje: await apuntarJustificante(companyId, f.datos!, f.fichero) }) } catch (e) { r.push({ ok: false, titulo, mensaje: msg(e) }) }
    }
    setOcupado(null)
    const sinGuardar = filas.length - guardables.length
    alGuardar(resumenGuardado(r) + (sinGuardar ? ` ${sinGuardar === 1 ? 'Otro no se ha guardado' : `Otros ${sinGuardar} no se han guardado`}: no se pudieron leer o ya estaban.` : ''),
      r.every((x) => x.ok))
  }

  return (
    <Tarjeta titulo="Subir justificantes de Hacienda"
      apoyo="Los PDF que da la Sede al presentar (303, 111, 115 y 202). Sumied los lee aquí, te enseña lo que ha leído y no guarda nada hasta que lo confirmes."
      accion={<Boton variante="enlace" onClick={alCerrar}>Cerrar</Boton>}>
      <label className={`s-justificantes-zona${sobre ? ' s-justificantes-zona-sobre' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setSobre(true) }} onDragLeave={() => setSobre(false)}
        onDrop={(e) => { e.preventDefault(); setSobre(false); void cargar(e.dataTransfer.files) }}>
        <input type="file" multiple accept="application/pdf,.pdf" className="cx-oculto" aria-label="Elegir los justificantes en PDF"
          onChange={(e) => { const fs = e.target.files ? Array.from(e.target.files) : []; e.target.value = ''; void cargar(fs) }} />
        <span className="s-justificantes-zona-titulo">{ocupado === 'leyendo' ? 'Leyendo los justificantes…' : 'Arrastra aquí los justificantes en PDF'}</span>
        <span className="s-apoyo">o toca para elegirlos. Uno o varios a la vez.</span>
      </label>
      {fallo && <p className="s-impuestos-fallo" role="alert">{fallo}</p>}
      {filas.length > 0 && (
        <>
          <table className="s-tabla s-impuestos-tabla s-justificantes-tabla">
            <thead><tr><th scope="col">Justificante</th><th scope="col">Lo que ha leído Sumied</th><th scope="col"><span className="cx-oculto">Quitar</span></th></tr></thead>
            <tbody>
              {filas.map((f) => <FilaRepaso key={f.clave} f={f} cambiar={cambiar} aMano={() => setAMano(f)}
                quitar={() => void repasar(filas.filter((x) => x.clave !== f.clave))} />)}
            </tbody>
          </table>
          <div className="s-justificantes-pie">
            <span className="s-apoyo">
              {guardables.length === 0 ? 'Nada que guardar todavía.' : `${guardables.length === 1 ? 'Se guardará 1' : `Se guardarán ${guardables.length}`} como presentados fuera, con su PDF.`}
            </span>
            <Boton onClick={() => setFilas([])} disabled={ocupado !== null}>Vaciar</Boton>
            <Boton variante="principal" disabled={!guardables.length || ocupado !== null} onClick={() => void guardar()}>
              {ocupado === 'guardando' ? 'Guardando…' : guardables.length === 1 ? 'Confirmar y guardar 1' : `Confirmar y guardar ${guardables.length}`}
            </Boton>
          </div>
        </>
      )}
      {aMano && (
        <DialogoAMano f={aMano} alCerrar={() => setAMano(null)}
          alGuardar={(datos) => { const k = aMano.clave; setAMano(null); cambiar(k, { datos }, true) }} />
      )}
    </Tarjeta>
  )
}

function FilaRepaso({ f, cambiar, aMano, quitar }: { f: Fila; cambiar: (k: string, c: Partial<Fila>, otraVez?: boolean) => void; aMano: () => void; quitar: () => void }) {
  if (!f.lectura) {
    return (
      <tr><td data-titulo="Justificante"><span className="s-impuestos-nombre">{f.fichero.name}</span></td>
        <td data-titulo="Lo que ha leído Sumied"><span className="s-apoyo">Leyendo…</span></td><td /></tr>
    )
  }
  const d = f.datos
  const leidoMal = !d || f.mirado?.estado === 'error'
  const base = d && !f.mirado ? { tono: 'neutro' as const, texto: 'Repasando…' } : chipDe(d ? f.mirado : null)
  const chip = f.traido && base.texto === 'Leído' ? { ...base, texto: 'Traído de Hacienda' } : base
  const sinResultado = !!d && f.lectura.ok && !f.lectura.datos.resultado && !d.a_mano
  const motivo = !d ? (f.lectura.ok ? null : f.lectura.motivo) : f.mirado?.motivo
  const dif = f.mirado?.diferencias ?? []
  return (
    <tr className={leidoMal ? 's-justificantes-mal' : undefined}>
      <td data-titulo="Justificante">
        <span className="s-impuestos-nombre">{d ? tituloDe(d) : 'No se ha podido leer'}</span>
        {d && <span className="s-tabla-apoyo">{lineaDe(d, f.devolucion)}{d.a_mano ? ' · escrito a mano' : ''}</span>}
        <span className="s-tabla-apoyo s-justificantes-fichero">{f.fichero.name}</span>
      </td>
      <td data-titulo="Lo que ha leído Sumied">
        <Chip tono={chip.tono}>{chip.texto}</Chip>
        {motivo && <span className="s-justificantes-motivo">{motivo}</span>}
        {sinResultado && (
          <div className="s-justificantes-mano">
            <Campo etiqueta={`Resultado${casillaResultado(d.modelo) ? ` (casilla [${casillaResultado(d.modelo)}])` : ''}`} ayuda="Cópialo del justificante, con su signo.">
              {(p) => <Texto {...p} valor={f.resultadoMano} alCambiar={(v) => cambiar(f.clave, { resultadoMano: v })} inputMode="decimal"
                onBlur={() => { const v = Number(f.resultadoMano.replace(/\./g, '').replace(',', '.').replace('−', '-')); cambiar(f.clave, { datos: { ...d, resultado: f.resultadoMano.trim() && Number.isFinite(v) ? v : null, motivo: 'El PDF no traía el resultado' } }, true) }} />}
            </Campo>
          </div>
        )}
        {d && pideDevolucion(d) && (
          <Campo etiqueta="Lo que pediste">
            {(p) => <Selector {...p} valor={f.devolucion ? 'si' : 'no'} opciones={[{ valor: 'no', texto: 'Compensar en los siguientes' }, { valor: 'si', texto: 'La devolución' }]}
              alCambiar={(v) => cambiar(f.clave, { devolucion: v === 'si', datos: { ...d, devolucion: v === 'si' } }, true)} />}
          </Campo>
        )}
        {leidoMal && !(f.mirado?.estado === 'error' && d && !d.a_mano && /NIF/.test(f.mirado.motivo ?? '')) && (
          <Boton variante="enlace" onClick={aMano}>Escribirlo a mano</Boton>
        )}
        {dif.length > 0 && (
          <details className="s-justificantes-dif" open>
            <summary>{dif.length === 1 ? '1 casilla distinta de lo que calculó Sumied' : `${dif.length} casillas distintas de lo que calculó Sumied`}</summary>
            <table className="s-tabla s-justificantes-dif-tabla">
              <thead><tr><th scope="col">Casilla</th><th scope="col" className="s-tabla-cifra">Sumied</th><th scope="col" className="s-tabla-cifra">Presentado</th></tr></thead>
              <tbody>
                {dif.map((x) => (
                  <tr key={x.casilla}>
                    <td data-titulo="Casilla"><span className="s-impuestos-casilla">[{x.casilla}]</span></td>
                    <td data-titulo="Sumied" className="s-tabla-cifra">{eurosExactos(x.sumied)}</td>
                    <td data-titulo="Presentado" className="s-tabla-cifra">{x.presentado === null ? 'vacía' : eurosExactos(x.presentado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </td>
      <td className="s-impuestos-accion"><Boton variante="enlace" onClick={quitar}>Quitar</Boton></td>
    </tr>
  )
}

const MODELOS = [{ valor: '303', texto: 'IVA (303)' }, { valor: '111', texto: 'Retenciones (111)' }, { valor: '115', texto: 'Alquiler (115)' }, { valor: '202', texto: 'Pago a cuenta de sociedades (202)' }]
const PERIODOS: Record<string, string[]> = { '303': ['1T', '2T', '3T', '4T'], '111': ['1T', '2T', '3T', '4T'], '115': ['1T', '2T', '3T', '4T'], '202': ['1P', '2P', '3P'] }

function DialogoAMano({ f, alCerrar, alGuardar }: { f: Fila; alCerrar: () => void; alGuardar: (d: DatosJustificante) => void }) {
  const p = f.lectura && !f.lectura.ok ? f.lectura.parcial : f.datos ?? {}
  const [modelo, setModelo] = useState(p.modelo && PERIODOS[p.modelo] ? p.modelo : '303')
  const [ejercicio, setEjercicio] = useState(String(p.ejercicio ?? new Date().getFullYear()))
  const [periodo, setPeriodo] = useState(p.periodo ?? '1T')
  const [fecha, setFecha] = useState(p.presentada?.slice(0, 10) ?? '')
  const [csv, setCsv] = useState(p.csv ?? '')
  const [numero, setNumero] = useState(p.justificante ?? '')
  // El importe ya leído (la línea del NRC del 202, aunque el impreso sea imagen), con coma decimal.
  const leido = typeof p.resultado === 'number' ? p.resultado : p.resultado?.importe ?? null
  const [resultado, setResultado] = useState(leido !== null ? textoDeImporte(leido) : '')
  const [casillas, setCasillas] = useState('')
  const [motivo, setMotivo] = useState(f.lectura && !f.lectura.ok ? 'El PDF no se pudo leer' : 'Escrito a mano del justificante')
  const [fallo, setFallo] = useState<string | null>(null)
  const periodos = PERIODOS[modelo]
  const guardar = () => {
    const c = casillasEscritas(casillas)
    if (!c.ok) { setFallo(`No entiendo «${c.linea}»: una casilla por línea, su número y su importe («27 9.855,66»).`); return }
    const r = Number(resultado.replace(/\./g, '').replace(',', '.').replace('−', '-'))
    if (!resultado.trim() || !Number.isFinite(r)) { setFallo('Escribe el resultado, con su signo.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setFallo('Escribe la fecha de presentación.'); return }
    if (!motivo.trim()) { setFallo('Di por qué se escribe a mano.'); return }
    const caja = casillaResultado(modelo)
    alGuardar({
      modelo, ejercicio: Number(ejercicio), periodo: periodos.includes(periodo) ? periodo : periodos[0], presentada: `${fecha}T00:00:00`,
      csv: csv.replace(/\s/g, '').toUpperCase(), justificante: numero.trim() || null, nif: '', resultado: r,
      casillas: caja && !(caja in c.casillas) ? { ...c.casillas, [caja]: r } : c.casillas, a_mano: true, motivo: motivo.trim(),
    })
  }
  return (
    <Dialogo titulo="Escribirlo a mano" alCerrar={alCerrar}
      explicacion={`«${f.fichero.name}»: copia los datos del justificante. Queda apuntado que se escribió a mano, con tu nombre y el motivo.`}
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" onClick={guardar}>Repasar</Boton></>}>
      {fallo && <p className="s-impuestos-fallo" role="alert">{fallo}</p>}
      <div className="s-justificantes-mano-grid">
        <Campo etiqueta="Impuesto">{(q) => <Selector {...q} valor={modelo} alCambiar={(v) => { setModelo(v); setPeriodo(PERIODOS[v][0]) }} opciones={MODELOS} />}</Campo>
        <Campo etiqueta="Ejercicio">{(q) => <Texto {...q} valor={ejercicio} alCambiar={setEjercicio} inputMode="numeric" />}</Campo>
        <Campo etiqueta="Periodo">{(q) => <Selector {...q} valor={periodo} alCambiar={setPeriodo} opciones={periodos.map((x) => ({ valor: x, texto: x }))} />}</Campo>
        <Campo etiqueta="Presentado el">{(q) => <Fecha {...q} valor={fecha} alCambiar={setFecha} />}</Campo>
        <Campo etiqueta="CSV">{(q) => <Texto {...q} valor={csv} alCambiar={setCsv} autoComplete="off" />}</Campo>
        <Campo etiqueta="Número de justificante">{(q) => <Texto {...q} valor={numero} alCambiar={setNumero} inputMode="numeric" />}</Campo>
        <Campo etiqueta={`Resultado${casillaResultado(modelo) ? ` [${casillaResultado(modelo)}]` : ''}`}>{(q) => <Texto {...q} valor={resultado} alCambiar={setResultado} inputMode="decimal" />}</Campo>
      </div>
      <Campo etiqueta="Casillas" ayuda="Una por línea: su número y su importe, como en el justificante («27 9.855,66»).">
        {(q) => <textarea {...q} className="s-control s-justificantes-casillas" rows={6} value={casillas} onChange={(e) => setCasillas(e.target.value)} />}
      </Campo>
      <Campo etiqueta="Por qué a mano">{(q) => <Texto {...q} valor={motivo} alCambiar={setMotivo} />}</Campo>
    </Dialogo>
  )
}
