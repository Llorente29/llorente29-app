// src/modules/conta/gestoria/q10/FacturasDelMes.tsx
//
// Q10 · «Las facturas de noviembre», en borrador. Pinta, no lee nada (así se
// prueba y se captura con datos inventados): la línea de arriba frente a
// GoCardless, las facturas con su número propuesto y su PDF, lo que está
// «Pendiente de revisar» con su motivo y lo que GoCardless no cobró. Con el
// estilo de Clientes y cuotas (clientesG04.css) y lo suyo en facturasQ10.css.
//
// «Emitir las de noviembre» (Q10 · PR 2): con la serie comprobada en ERP10, pide
// confirmar con su contenido (cuántas, de qué número a cuál, la fecha y el
// total) y dice al acabar lo emitido, o hasta dónde llegó y por qué paró
// (regla 8). Sin poder, el botón dice por qué.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { eurQ10, type MesQ10 } from './facturasDelMes'

export interface Erp10Q10 {
  /** Mientras se lee, la frase de por dónde va; al acabar, lo leído; si falla, el porqué. */
  estado: 'sin_leer' | 'leyendo' | 'leido' | 'fallo'
  frase: string
  /** La comprobación de la serie (comprobarSerie), cuando ya se ha leído. */
  serie: { ok: boolean; frase: string } | null
}

export interface PropsQ10 {
  empresa: string
  mes: string
  modelo: MesQ10
  /** Los números que llevarían, en su orden (numerar), o null si aún no se sabe la serie. */
  numeros: string[] | null
  /** Solo la empresa que retiene (la autónoma) necesita ERP10 para preparar; las dos, para la serie. */
  erp10: Erp10Q10
  alLeerErp10: () => void
  /** Abre el PDF del borrador i; devuelve la frase si no se puede. */
  alVerPdf: (i: number) => Promise<string | null>
  rutaVolver: string
  rutaSinCliente: string
  emitir: { puede: boolean; porque: string; cuantas: number; primera: string | null; ultima: string | null; totalCent: number; fecha: string }
  /** Emite todas (por trozos); llama a `avance` con por dónde va. Devuelve la frase de lo hecho o lanza con lo que paró. */
  alEmitir: (avance: (frase: string) => void) => Promise<string>
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export function FacturasDelMes(p: PropsQ10) {
  const m = p.modelo
  const [aviso, setAviso] = useState<string | null>(null)
  const [abriendo, setAbriendo] = useState<number | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [emision, setEmision] = useState<{ estado: 'emitiendo' | 'hecho' | 'fallo'; frase: string } | null>(null)
  const emitir = async () => {
    setConfirmar(false)
    setEmision({ estado: 'emitiendo', frase: 'Emitiendo…' })
    try { setEmision({ estado: 'hecho', frase: await p.alEmitir((frase) => setEmision({ estado: 'emitiendo', frase })) }) }
    catch (e) { setEmision({ estado: 'fallo', frase: e instanceof Error ? e.message : String(e) }) }
  }
  const verPdf = async (i: number) => {
    setAbriendo(i); setAviso(null)
    try { setAviso(await p.alVerPdf(i)) } catch (e) { setAviso(e instanceof Error ? e.message : String(e)) } finally { setAbriendo(null) }
  }
  return (
    <div className="g4 q10" data-pantalla="facturas-q10">
      <header className="g4-cabecera">
        <div className="g4-cabecera-textos">
          <div className="g4-antetitulo"><Link to={p.rutaVolver}>Clientes y cuotas</Link> · {p.empresa}</div>
          <h1 className="g4-titulo">Las facturas de {p.mes}</h1>
        </div>
        <div className="g4-cabecera-acciones">
          <button type="button" className="g4-boton" data-tipo="primario" disabled={!p.emitir.puede || emision?.estado === 'emitiendo'}
            title={p.emitir.puede ? undefined : p.emitir.porque} onClick={() => setConfirmar(true)}>Emitir las de {p.mes}</button>
        </div>
      </header>

      <p className="q10-frase" data-prueba="cabecera" data-tono={m.cuadra ? 'bien' : 'mal'} role="status">{m.frase}</p>
      {!p.emitir.puede && !emision && <p className="q10-nota" data-prueba="por-que-no">{p.emitir.porque || 'En borrador: nada se ha emitido.'}</p>}
      {confirmar && (
        <section className="g4-bloque q10-confirmar" role="alertdialog" aria-labelledby="q10-confirmar" data-prueba="confirmar">
          <h2 id="q10-confirmar" className="g4-bloque-titulo">¿Emitir {p.emitir.cuantas} {p.emitir.cuantas === 1 ? 'factura' : 'facturas'} de {p.mes}?</h2>
          <p className="q10-linea">De la {p.emitir.primera} a la {p.emitir.ultima}, con fecha de hoy ({dmy(p.emitir.fecha)}), por {eurQ10(p.emitir.totalCent)}. Cada una queda atada a su cobro.</p>
          <p className="q10-linea">Una factura emitida no se borra: si algo está mal, se corrige con una rectificativa. Aún no se envía a nadie.</p>
          <div className="g4-cabecera-acciones">
            <button type="button" className="g4-boton" data-tipo="primario" onClick={() => void emitir()}>Sí, emitirlas</button>
            <button type="button" className="g4-boton" onClick={() => setConfirmar(false)}>No, volver</button>
          </div>
        </section>
      )}
      {emision && (
        <p className="q10-frase" data-prueba="emision" data-tono={emision.estado === 'hecho' ? 'bien' : emision.estado === 'fallo' ? 'mal' : undefined}
          role={emision.estado === 'fallo' ? 'alert' : 'status'}>{emision.frase}</p>
      )}

      <section className="g4-bloque q10-erp10" aria-labelledby="q10-erp10" data-prueba="erp10" data-estado={p.erp10.estado}>
        <h2 id="q10-erp10" className="g4-bloque-titulo">ERP10: la serie y las retenciones</h2>
        <p className="q10-linea" role={p.erp10.estado === 'fallo' ? 'alert' : undefined}>{p.erp10.frase}</p>
        {p.erp10.serie && <p className="q10-linea" data-tono={p.erp10.serie.ok ? 'bien' : 'mal'} data-prueba="serie">{p.erp10.serie.frase}</p>}
        {p.erp10.estado !== 'leyendo' && (
          <button type="button" className="g4-boton g4-boton-pequeno" onClick={p.alLeerErp10}>{p.erp10.estado === 'sin_leer' ? 'Leer de ERP10' : 'Volver a leer de ERP10'}</button>
        )}
      </section>

      <section className="g4-bloque" aria-labelledby="q10-facturas">
        <h2 id="q10-facturas" className="g4-bloque-titulo">Facturas ({m.facturas.length}) · {eurQ10(m.facturasCent)}</h2>
        {aviso && <p className="q10-linea" data-tono="mal" role="alert">{aviso}</p>}
        {m.facturas.length === 0 ? <p className="q10-linea">Ninguna, de momento: mira lo pendiente de revisar.</p> : (
          <div className="q10-tabla-caja">
            <table className="q10-tabla" aria-label="Facturas">
              <thead><tr><th>Número</th><th>Cliente</th><th>Qué es</th><th>Cobrada el</th><th className="q10-num">Base</th><th className="q10-num">IVA</th><th className="q10-num">Retención</th><th className="q10-num">Total</th><th /></tr></thead>
              <tbody>
                {m.facturas.map((f, i) => (
                  <tr key={f.cobro.gcId} data-cobro={f.cobro.gcId}>
                    <td className="q10-numero">{p.numeros?.[i] ?? 'Sin número'}</td>
                    <td><div className="q10-cliente">{f.ficha.nombre}</div><div className="g4-pequeno">NIF {f.ficha.nif}</div></td>
                    <td>{f.concepto}</td>
                    <td>{dmy(f.cobro.fecha)}</td>
                    <td className="q10-num">{eurQ10(f.baseCent)}</td>
                    <td className="q10-num">{eurQ10(f.ivaCent)}</td>
                    <td className="q10-num">{f.retencion ? `−${eurQ10(f.retencion.cent)} (${f.retencion.pct} %)` : '—'}</td>
                    <td className="q10-num q10-total">{eurQ10(f.totalCent)}</td>
                    <td><button type="button" className="g4-boton g4-boton-pequeno" disabled={abriendo !== null} onClick={() => void verPdf(i)}>{abriendo === i ? 'Abriendo…' : 'PDF'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {m.emitidas.length > 0 && (
        <section className="g4-bloque" aria-labelledby="q10-emitidas" data-prueba="emitidas">
          <h2 id="q10-emitidas" className="g4-bloque-titulo">Ya emitidas ({m.emitidas.length}) · {eurQ10(m.emitidas.reduce((t, x) => t + x.totalCent, 0))}</h2>
          <ul className="q10-lista">
            {m.emitidas.map((x) => (
              <li key={x.cobro.gcId}>
                <span className="q10-cliente">{x.numero} · {x.ficha?.nombre ?? ''}</span>
                <span className="q10-importe">{eurQ10(x.totalCent)} · cobrada el {dmy(x.cobro.fecha)}{x.concepto ? ` · ${x.concepto}` : ''}</span>
                <span className="q10-porque">Atada a su cobro de GoCardless.</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="g4-bloque" aria-labelledby="q10-pendientes" data-prueba="pendientes">
        <h2 id="q10-pendientes" className="g4-bloque-titulo">Pendiente de revisar ({m.pendientes.length}) · {eurQ10(m.pendientesCent)}</h2>
        {m.pendientes.length === 0 ? <p className="q10-linea">Nada: todo lo cobrado tiene su factura.</p> : (
          <>
            {m.pendientes.some((x) => x.motivo === 'sin_cliente') && <p className="q10-linea"><Link to={p.rutaSinCliente}>Atar los cobros sin cliente →</Link></p>}
            <ul className="q10-lista">
              {m.pendientes.map((x) => (
                <li key={x.cobro.gcId} data-motivo={x.motivo}>
                  <span className="q10-cliente">{x.ficha?.nombre ?? x.gcClienteId ?? 'Cliente de GoCardless sin saber'}</span>
                  <span className="q10-importe">{eurQ10(Math.round(x.cobro.importe * 100))} · {dmy(x.cobro.fecha)}{x.concepto ? ` · ${x.concepto}` : ''}</span>
                  <span className="q10-porque">{x.porque}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="g4-bloque" aria-labelledby="q10-sin" data-prueba="sin-factura">
        <h2 id="q10-sin" className="g4-bloque-titulo">Sin factura: GoCardless no lo cobró ({m.sinFactura.length})</h2>
        {m.sinFactura.length === 0 ? <p className="q10-linea">Ninguno.</p> : (
          <ul className="q10-lista">
            {m.sinFactura.map((x) => (
              <li key={x.cobro.gcId} data-estado={x.cobro.estado}>
                <span className="q10-cliente">{x.ficha?.nombre ?? x.gcClienteId ?? 'Cliente de GoCardless sin saber'}</span>
                <span className="q10-importe">{eurQ10(Math.round(x.cobro.importe * 100))} · {dmy(x.cobro.fecha)}{x.concepto ? ` · ${x.concepto}` : ''}</span>
                <span className="q10-porque">{x.porque}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
