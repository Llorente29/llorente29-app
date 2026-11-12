// src/modules/conta/gestoria/g05/FichaFactura.tsx
//
// G05 · Tarea 4 · La ficha de una factura que sale de un recibo, fiel a la
// maqueta aprobada (Factura.dc.html): «← Cobro de …», «Factura N» con su
// estado y cliente · mes · total; a la izquierda la factura (su PDF, el modelo
// «Sumied»); a la derecha «Descargar PDF», «Reenviar al cliente» y «Hacer un
// abono», «Lo que ha pasado» y «En la contabilidad».
// Solo pinta: recibe el modelo (modeloFicha.ts) y lo que hacer al pulsar.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ModeloFicha } from './modeloFicha'

export interface PropsFichaFactura {
  modelo: ModeloFicha
  rutaVolver: string
  rutaAsiento: (id: string) => string
  /** La factura: su PDF guardado, o cómo es (el modelo «Sumied» hecho aquí). */
  documento: ReactNode
  /** Lo que ha pasado al pulsar (regla 8). */
  aviso: { ok: boolean; texto: string } | null
  descargar: string | null
  alReenviar: () => void
  /** Null si ya no se puede (anulada, o ya tiene su rectificativa). */
  alAbono: (() => void) | null
  /** Lo que va debajo (Con Hacienda, si la AEAT la rechaza). */
  debajo?: ReactNode
}

export function FichaFactura(p: PropsFichaFactura) {
  const m = p.modelo
  return (
    <div className="g4 g5 g5-ficha" data-pantalla="factura-g05">
      <Link className="g4-enlace" to={p.rutaVolver}>{m.volver.texto}</Link>
      <header className="g5-ficha-cabeza">
        <div className="g5-ficha-titulos">
          <h1 className="g4-titulo g5-ficha-titulo">{m.titulo}</h1>
          <span className="g5-etiqueta" data-tono={m.chip.tono}>{m.chip.texto}</span>
        </div>
        <div className="g5-apoyo">{m.subtitulo}</div>
      </header>

      {p.aviso && <p role={p.aviso.ok ? 'status' : 'alert'} className="g5-frase" data-tono={p.aviso.ok ? 'bien' : 'mal'}>{p.aviso.texto}</p>}

      <div className="g5-ficha-cuerpo">
        <div className="g5-ficha-papel">{p.documento}</div>

        <aside className="g5-ficha-lado" aria-label="Qué ha pasado con esta factura">
          <div className="g4-bloque g5-ficha-acciones">
            {p.descargar
              ? <a className="g4-boton g5-ficha-principal" data-tipo="primario" href={p.descargar} download>Descargar PDF</a>
              : <button type="button" className="g4-boton g5-ficha-principal" data-tipo="primario" disabled title="Aún no tiene su PDF guardado">Descargar PDF</button>}
            <div className="g5-ficha-dos">
              <button type="button" className="g4-boton" onClick={p.alReenviar}>Reenviar al cliente</button>
              <button type="button" className="g4-boton" onClick={p.alAbono ?? undefined} disabled={!p.alAbono}>Hacer un abono</button>
            </div>
          </div>

          <section className="g4-bloque g5-ficha-hitos" aria-labelledby="g5-lo-que-ha-pasado">
            <h2 id="g5-lo-que-ha-pasado" className="g5-ficha-h2">Lo que ha pasado</h2>
            <ol className="g5-hitos">
              {m.hitos.map((h) => (
                <li key={h.titulo} className="g5-hito">
                  <span className="g5-hito-raya" aria-hidden="true"><span className="g5-hito-bola" data-bola={h.bola}>{h.icono}</span><span className="g5-hito-linea" /></span>
                  <span className="g5-hito-textos"><b>{h.titulo}</b><span>{h.detalle}</span></span>
                </li>
              ))}
            </ol>
          </section>

          <section className="g4-bloque g5-ficha-conta" aria-labelledby="g5-en-la-contabilidad">
            <h2 id="g5-en-la-contabilidad" className="g5-ficha-h2">En la contabilidad</h2>
            {m.asientos.length === 0 && <p className="g5-apoyo">Aún no tiene asientos.</p>}
            {m.asientos.map((a) => (
              <div key={a.id} className="g5-asiento">
                <Link className="g5-asiento-t" to={p.rutaAsiento(a.id)}>{a.titulo}</Link>
                <table className="g5-asiento-tabla">
                  <thead className="g5-oculto"><tr><th scope="col">Cuenta</th><th scope="col">Debe</th><th scope="col">Haber</th></tr></thead>
                  <tbody>
                    {a.lineas.map((l, i) => <tr key={i}><td>{l.cuenta}</td><td>{l.debe}</td><td>{l.haber}</td></tr>)}
                  </tbody>
                </table>
              </div>
            ))}
            {m.notas.map((n) => <p key={n} className="g5-ficha-nota">{n}</p>)}
          </section>
          {p.debajo}
        </aside>
      </div>
    </div>
  )
}
