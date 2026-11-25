// src/modules/conta/gestoria/q10/FacturasDelMes.tsx
//
// Q10 · «Las facturas de noviembre», lo cobrado por GoCardless cobro a cobro.
// Pinta, no lee nada (así se prueba y se captura con datos inventados): la línea
// de arriba frente a GoCardless, lo cobrado con su PDF de muestra, lo que está
// «Pendiente de revisar» con su motivo y lo que GoCardless no cobró. Con el
// estilo de Clientes y cuotas (clientesG04.css) y lo suyo en facturasQ10.css.
//
// Respuesta 1 al Q10 (25/11): las facturas las emite Cegid, con Verifactu;
// Sumied no emite ni numera. Debajo de la línea de arriba va lo de Cegid (la
// lectura, los códigos de cliente y la tabla de equivalencias: CegidQ10.tsx).

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { eurQ10, type MesQ10 } from './facturasDelMes'

export interface PropsQ10 {
  empresa: string
  mes: string
  modelo: MesQ10
  /** Lo de la facturación de Cegid (la lectura, los códigos de cliente y la tabla de equivalencias). */
  cegid: ReactNode
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
      </header>

      <p className="q10-frase" data-prueba="cabecera" data-tono={m.cuadra ? 'bien' : 'mal'} role="status">{m.frase}</p>
      <p className="q10-nota">Las facturas las emite Cegid, con Verifactu: Sumied no emite ni numera. Aquí se prepara lo que falta y se cuadra.</p>

      {p.cegid}

      <section className="g4-bloque" aria-labelledby="q10-facturas">
        <h2 id="q10-facturas" className="g4-bloque-titulo">Cobrado y con todo para facturar ({m.facturas.length}) · {eurQ10(m.facturasCent)}</h2>
        {aviso && <p className="q10-linea" data-tono="mal" role="alert">{aviso}</p>}
        {m.facturas.length === 0 ? <p className="q10-linea">Ninguna, de momento: mira lo pendiente de revisar.</p> : (
          <div className="q10-tabla-caja">
            <table className="q10-tabla" aria-label="Facturas">
              <thead><tr><th>Número</th><th>Cliente</th><th>Qué es</th><th>Cobrada el</th><th className="q10-num">Base</th><th className="q10-num">IVA</th><th className="q10-num">Retención</th><th className="q10-num">Total</th><th /></tr></thead>
              <tbody>
                {m.facturas.map((f, i) => (
                  <tr key={f.cobro.gcId} data-cobro={f.cobro.gcId}>
                    <td className="q10-numero">La numera Cegid</td>
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
