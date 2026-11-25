// src/modules/conta/gestoria/q10/FacturasDelMes.tsx
//
// Q10 · «Las facturas de noviembre», en borrador. Pinta, no lee nada (así se
// prueba y se captura con datos inventados): la línea de arriba frente a
// GoCardless, las facturas con su número propuesto y su PDF, lo que está
// «Pendiente de revisar» con su motivo y lo que GoCardless no cobró. Con el
// estilo de Clientes y cuotas (clientesG04.css) y lo suyo en facturasQ10.css.
//
// Emitir no está aquí: va en el PR siguiente, cuando Julio dé el diseño del PDF
// por cerrado. El botón se ve y dice por qué aún no (regla 8).

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
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export function FacturasDelMes(p: PropsQ10) {
  const m = p.modelo
  const [aviso, setAviso] = useState<string | null>(null)
  const [abriendo, setAbriendo] = useState<number | null>(null)
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
          <button type="button" className="g4-boton" disabled title="Va en el PR siguiente, cuando el diseño del PDF esté cerrado">Emitir las de {p.mes}</button>
        </div>
      </header>

      <p className="q10-frase" data-prueba="cabecera" data-tono={m.cuadra ? 'bien' : 'mal'} role="status">{m.frase}</p>
      <p className="q10-nota">En borrador: nada se ha emitido ni enviado. «Emitir» llega cuando el diseño del PDF esté cerrado.</p>

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
