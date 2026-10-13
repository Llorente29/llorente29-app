// src/modules/conta/libro/ConDiez.tsx
//
// C04b · R15 · Las piezas «con Diez» del Libro: el diálogo «Validar y enviar a
// Diez» (cuántos y cuánto ANTES de enviar, y qué ha pasado con cada uno
// después, regla 8), la tarjeta del asiento (su estado en palabras, «Ver
// documento» y «Reintentar») y el chip de la fila. Caben tal cual en la
// pantalla N16 «Libros › Con Diez», cuando toque.

import { useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { Chip } from '@/modules/conta/ui/piezas'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { resumenSeleccion, textoResultado, type ConDiez, type EstadoDiez, type PasoEnvio } from '@/modules/conta/lib/conDiez'
import { urlDocumento, validarYEnviar } from '@/modules/conta/services/conDiezService'

export interface CandidatoDiez { id: string; concepto: string; fecha: string; estado: string; cobro: number; estadoDiez: EstadoDiez }

const tonoChip = (t: EstadoDiez['tono']) => (t === 'verde' ? 'ia' : t === 'azul' ? 'azul' : t === 'ambar' ? 'ambar' : 'neutro')

/** El chip de la fila del libro (corto, una línea); la frase entera, en su title. */
export function ChipDiez({ e }: { e: EstadoDiez }) {
  return <span title={e.texto} aria-label={e.texto}><Chip tono={tonoChip(e.tono)}>{e.corto}</Chip></span>
}

/** «Ver documento»: abre el PDF guardado (URL firmada de cinco minutos). */
export function VerDocumento({ ruta, alFallar }: { ruta: string; alFallar: (t: string) => void }) {
  const [abriendo, setAbriendo] = useState(false)
  async function ver() {
    setAbriendo(true)
    // La ventana se abre YA (en el clic) y se le pone la dirección después: si
    // no, el navegador la bloquea por no venir de un clic.
    const v = window.open('', '_blank')
    try {
      const url = await urlDocumento(ruta)
      if (v) v.location.href = url; else window.location.assign(url)
    } catch (e) { v?.close(); alFallar(e instanceof Error ? e.message : 'No se ha podido abrir el documento.') }
    finally { setAbriendo(false) }
  }
  return <button type="button" className="cx-boton-sec" onClick={ver} disabled={abriendo}>{abriendo ? 'Abriendo…' : 'Ver documento'}</button>
}

/** La tarjeta «Con Diez» del asiento: dónde está, su documento y Reintentar. */
export function TarjetaDiez({ a, d, e, quien, alHacer, alFallar }: {
  a: { id: string; concepto: string; estado: string }; d: ConDiez; e: EstadoDiez; quien: string | null
  alHacer: (t: string) => void; alFallar: (t: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  async function reintentar() {
    setOcupado(true)
    try { const [p] = await validarYEnviar([a], quien); alHacer(p.texto) }
    catch (x) { alFallar(x instanceof Error ? x.message : 'No se ha podido reintentar.') }
    finally { setOcupado(false) }
  }
  return (
    <section className="cx-tarjeta" aria-label="Con Diez">
      <h2 className="cx-tarjeta-titulo">Con Diez</h2>
      <p className={e.enDiez ? 'cxt-verde' : e.tono === 'ambar' ? 'cxt-ambar' : undefined} role="status">{e.texto}</p>
      {d.envio?.errorDocumento && !e.enDiez && <p className="cx-ayuda">El documento: {d.envio.errorDocumento}</p>}
      <p className="cx-ayuda">
        {d.documento
          ? `Su documento, el «Resumen de ventas» de ${d.nombreCanal}, guardado en Folvy el ${diaMesCorto(d.documento.creadoEn.slice(0, 10))}${d.documento.creadoPor ? ` por ${d.documento.creadoPor}` : ''}.`
          : a.estado === 'validado' ? 'Aún no tiene su documento guardado: sin él no se da por enviado.' : 'Al validarlo, Folvy guarda su «Resumen de ventas» y lo envía a Diez con la factura.'}
      </p>
      <div className="cxd-dialogo-acciones">
        {d.documento && <VerDocumento ruta={d.documento.ruta} alFallar={alFallar} />}
        {e.reintentar && a.estado === 'validado' && <button type="button" className="cx-boton" onClick={reintentar} disabled={ocupado}>{ocupado ? 'Reintentando…' : 'Reintentar'}</button>}
      </div>
    </section>
  )
}

/**
 * «Validar y enviar a Diez»: varios a la vez. Antes de enviar, cuántos y el
 * total (lo que cobra la plataforma); después, qué ha pasado con cada uno.
 */
export function EnviarADiezDialogo({ candidatos, quien, alCerrar, alTerminar }: {
  candidatos: CandidatoDiez[]; quien: string | null; alCerrar: () => void; alTerminar: (t: string) => void
}) {
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(candidatos.filter((c) => c.estado !== 'validado').map((c) => c.id)))
  const [paso, setPaso] = useState<number | null>(null)
  const [pasos, setPasos] = useState<PasoEnvio[] | null>(null)
  const elegidos = candidatos.filter((c) => marcados.has(c.id))
  const r = resumenSeleccion(elegidos.map((c) => ({ importe: c.cobro })))
  const cambiar = (id: string) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function ir() {
    setPaso(0)
    const p = await validarYEnviar(elegidos, quien, setPaso)
    setPasos(p); setPaso(null)
    alTerminar(textoResultado(p))
  }

  if (pasos) {
    return (
      <Dialogo titulo="Validar y enviar a Diez · hecho" alCerrar={alCerrar}>
        <p role="status"><strong>{textoResultado(pasos)}</strong></p>
        <ul className="cxd-diez-lista">
          {pasos.map((p, i) => (
            <li key={i} className={p.enDiez ? 'cxt-verde' : 'cxt-ambar'}><strong>{p.concepto}</strong> · {p.texto}</li>
          ))}
        </ul>
        <div className="cxd-dialogo-acciones"><button type="button" className="cx-boton" onClick={alCerrar}>Cerrar</button></div>
      </Dialogo>
    )
  }
  return (
    <Dialogo titulo="Validar y enviar a Diez" alCerrar={() => { if (paso === null) alCerrar() }}>
      <p className="cx-ayuda">Cada asiento se valida, se guarda su «Resumen de ventas» en Folvy y se envía a Diez con su factura. Sin el documento adjunto en Diez no se da por enviado.</p>
      <ul className="cxd-diez-lista" aria-label="Asientos para validar y enviar">
        {candidatos.map((c) => (
          <li key={c.id}>
            <label className="cxd-diez-opcion">
              <input type="checkbox" checked={marcados.has(c.id)} onChange={() => cambiar(c.id)} disabled={paso !== null} />
              <span className="cxd-diez-concepto">{diaMesCorto(c.fecha)} · {c.concepto}<span className="cx-ayuda"> · {c.estadoDiez.texto}</span></span>
              <span className="cxd-importe">{eurosExactos(c.cobro)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p role="status"><strong>{r.n} {r.n === 1 ? 'asiento' : 'asientos'} · {eurosExactos(r.total)}</strong> en total, lo que cobran las plataformas.</p>
      <div className="cxd-dialogo-acciones">
        <button type="button" className="cx-boton-sec" onClick={alCerrar} disabled={paso !== null}>Cancelar</button>
        <button type="button" className="cx-boton" onClick={ir} disabled={paso !== null || r.n === 0}>
          {paso !== null ? `Validando y enviando ${paso + 1} de ${r.n}…` : `Validar y enviar ${r.n} a Diez`}
        </button>
      </div>
    </Dialogo>
  )
}
