// src/modules/conta/gestoria/q10/BancoCegidQ10.tsx
//
// Q10 · respuesta 7 (27/11) · «Facturas del mes» › LO COBRADO POR EL BANCO Y CON TARJETA, A CEGID, y el cuadre del mes
// por vía. Las reglas, en _shared/cegidBanco.ts; el servidor (conta-cegid-mandar, «mandar_banco») las vuelve a
// comprobar con las facturas de Cegid leídas en ese momento.
//   · «Se mandan»: los cobros que pagan recibos de GoCardless devueltos (con el mes en la descripción si no es el de
//     noviembre y el recargo como 0018) y los que Julio decidió facturar, cada uno con «Mandar este».
//   · «Para Julio»: lo que no paga ningún recibo (transferencias sueltas, traspasos, la DEH, los «por confirmar») y los
//     pagos con tarjeta ya atados, una línea por cobro, con «Paga una factura que ya existe», «Facturar con este
//     concepto» (con el concepto y el cliente) y «No es un cobro». Lo decidido queda apuntado, con quién y cuándo.
//   · «No salen»: lo que paga facturas que ya existen (regla 1) y lo que aún espera, con su porqué.
//   · El cuadre: lo cobrado en el mes por cada vía = lo mandado + lo que paga facturas que ya existen + lo que no es
//     cobro, cliente a cliente. Hasta que dé 0,00 €, no se genera nada en Cegid.

import { useMemo, useState } from 'react'
import { cuadreVias, nombreMes, planCobro, proponerFactura, type CobroBanco, type FacturaParaCruce, type PlanCobro, type QueDecide } from '../../../../../supabase/functions/_shared/cegidBanco'
import { CONCEPTOS_CEGID, type CobroParaMandar } from '../../../../../supabase/functions/_shared/cegidMandar'
import { decidirBancoCegid, leerBancoCegid, mandarBancoCegid, type IncidenciaMandada } from '@/modules/conta/services/cegidService'
import { eurQ10 } from './facturasDelMes'

const VIVAS = ['mandando', 'mandada', 'facturada']
const VIA: Record<string, string> = { transferencia: 'Transferencia', traspaso: 'Traspaso', otra: 'Otra', bizum: 'Bizum', cajero: 'Cajero', tarjeta: 'Tarjeta' }
const fecha = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

interface Props {
  empresaId: string
  mes: string
  /** Los cobros de GoCardless del mes (para el cuadre por vía); null mientras no se ha leído lo de Cegid. */
  cobrosGc: readonly CobroParaMandar[] | null
  mandadas: readonly IncidenciaMandada[]
  /** Las facturas de Cegid leídas (con el nombre de su cliente), para proponer qué factura paga un cobro sin recibo. */
  facturasCegid: readonly FacturaParaCruce[]
  /** Después de mandar: que la página vuelva a leer lo mandado. */
  alMandar: () => void
}
type Frase = { estado: 'trabajando' | 'bien' | 'mal'; frase: string }

export function BancoCegidQ10(p: Props) {
  const [leido, setLeido] = useState<{ clave: string; cobros: CobroBanco[]; facturados: Record<string, string[]>; frase: string } | null>(null)
  const [lectura, setLectura] = useState<Frase | null>(null)
  const [frases, setFrases] = useState<Record<string, Frase>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [concepto, setConcepto] = useState<Record<string, string>>({})
  const [cliente, setCliente] = useState<Record<string, string>>({})
  const clave = `${p.empresaId}:${p.mes}`
  const datos = leido?.clave === clave ? leido : null

  const planes = useMemo<PlanCobro[] | null>(() => {
    if (!datos) return null
    const vivas = new Set(p.mandadas.filter((m) => VIVAS.includes(m.estado)).map((m) => m.gcCobroId))
    return datos.cobros.map((c) => planCobro(p.mes, c, (cli, m) => (datos.facturados[String(cli)] ?? []).includes(m), vivas))
  }, [datos, p.mandadas, p.mes])
  const cuadre = useMemo(() => planes && p.cobrosGc
    ? cuadreVias(p.mes, p.cobrosGc, planes, p.mandadas.filter((m) => VIVAS.includes(m.estado)).map((m) => ({ clave: m.gcCobroId, cliente: m.cliente, totalCent: Math.round(m.total * 100) })))
    : null, [planes, p.cobrosGc, p.mandadas, p.mes])

  const leer = async () => {
    setLectura({ estado: 'trabajando', frase: 'Leyendo lo cobrado por el banco y, de Cegid, las facturas de cada cliente…' })
    try {
      const r = await leerBancoCegid(p.empresaId, p.mes)
      setLeido({ clave, ...r })
      setLectura({ estado: 'bien', frase: r.frase })
    } catch (e) { setLectura({ estado: 'mal', frase: e instanceof Error ? e.message : String(e) }) }
  }
  const mandar = async (k: string) => {
    setOcupado(k); setFrases((f) => ({ ...f, [k]: { estado: 'trabajando', frase: 'Mandando a Cegid…' } }))
    try { const f = await mandarBancoCegid(p.empresaId, p.mes, k); setFrases((x) => ({ ...x, [k]: { estado: 'bien', frase: f } })) }
    catch (e) { setFrases((x) => ({ ...x, [k]: { estado: 'mal', frase: e instanceof Error ? e.message : String(e) } })) }
    finally { setOcupado(null); p.alMandar() }
  }
  const decidir = async (c: CobroBanco, decision: QueDecide) => {
    const k = c.clave
    const con = decision === 'facturar' ? (concepto[k] ?? '') : null
    const cli = decision === 'facturar' ? Number(cliente[k] ?? c.decision?.cliente ?? c.codigo ?? 0) : null
    const fra = decision === 'paga_factura' ? proponerFactura(c, p.facturasCegid)?.factura ?? null : null
    if (decision === 'facturar' && (!con || !cli)) { setFrases((x) => ({ ...x, [k]: { estado: 'mal', frase: 'Para facturar, elige el concepto y escribe el cliente de Cegid.' } })); return }
    setOcupado(k); setFrases((f) => ({ ...f, [k]: { estado: 'trabajando', frase: 'Apuntando…' } }))
    try {
      const f = await decidirBancoCegid(p.empresaId, k, decision, con, cli, null, fra)
      setLeido((d) => d && { ...d, cobros: d.cobros.map((x) => x.clave === k ? { ...x, decision: { decision, concepto: con, cliente: cli, texto: null, factura: fra, quien: 'tú', at: new Date().toISOString() } } : x) })
      setFrases((x) => ({ ...x, [k]: { estado: 'bien', frase: f } }))
    } catch (e) { setFrases((x) => ({ ...x, [k]: { estado: 'mal', frase: e instanceof Error ? e.message : String(e) } })) }
    finally { setOcupado(null) }
  }

  const seMandan = planes?.filter((x) => ['listo', 'ya_mandado'].includes(x.estado)) ?? []
  const paraJulio = planes?.filter((x) => x.estado === 'para_julio' || (x.cobro.decision && x.estado !== 'listo' && x.estado !== 'ya_mandado')) ?? []
  const noSalen = planes?.filter((x) => !seMandan.includes(x) && !paraJulio.includes(x)) ?? []
  const frase = (k: string) => frases[k] && <span className="q10-linea" data-prueba="banco-frase" data-tono={frases[k].estado === 'mal' ? 'mal' : frases[k].estado === 'bien' ? 'bien' : undefined} role="status">{frases[k].frase}</span>

  return (
    <section className="g4-bloque q10-banco" aria-labelledby="q10-banco" data-prueba="banco">
      <h2 id="q10-banco" className="g4-bloque-titulo">Paso 3 · Lo cobrado por el banco y con tarjeta</h2>
      <p className="q10-linea">En {nombreMes(p.mes)} se factura todo lo cobrado, por cualquier vía, en una sola factura por cliente. Lo que paga un recibo de un mes ya facturado en Cegid no sale nunca.</p>
      <button type="button" className="g4-boton" disabled={lectura?.estado === 'trabajando' || ocupado !== null} onClick={() => void leer()}>
        {datos ? 'Volver a leer lo cobrado por el banco' : 'Leer lo cobrado por el banco'}</button>
      {lectura && <p className="q10-linea" data-prueba="banco-lectura" data-tono={lectura.estado === 'mal' ? 'mal' : undefined} role="status">{lectura.frase}</p>}

      {planes && (
        <>
          <h3 className="q10-subtitulo">Se mandan ({seMandan.length})</h3>
          <div className="q10-tabla-caja">
            <table className="q10-tabla" aria-label="Cobros del banco que se mandan">
              <thead><tr><th>Fecha</th><th>Vía</th><th className="q10-num">Cobrado</th><th>Cliente</th><th>Líneas</th><th /></tr></thead>
              <tbody>
                {seMandan.map((x) => (
                  <tr key={x.cobro.clave} data-clave={x.cobro.clave} data-estado={x.estado}>
                    <td>{fecha(x.cobro.fecha)}</td><td>{VIA[x.cobro.via] ?? x.cobro.via}</td><td className="q10-num">{eurQ10(Math.round(x.cobro.importe * 100))}</td>
                    <td>{x.cliente ?? '—'}</td>
                    <td>{x.lineas.map((l) => <span key={l.clave} className="q10-linea">{l.concepto.codigo} · {l.texto} · {eurQ10(l.totalCent)}</span>)}{x.porque && <span className="g4-pequeno">{x.porque}</span>}</td>
                    <td>{x.estado === 'ya_mandado' ? <span className="q10-linea" data-tono="bien">Mandado</span>
                      : <button type="button" className="g4-boton" data-tipo="primario" disabled={ocupado !== null} onClick={() => void mandar(x.cobro.clave)}>Mandar este</button>}
                      {frase(x.cobro.clave)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="q10-subtitulo">Para Julio ({paraJulio.length})</h3>
          <div className="q10-tabla-caja">
            <table className="q10-tabla" aria-label="Cobros que decide Julio">
              <thead><tr><th>Fecha</th><th>Vía</th><th className="q10-num">Cobrado</th><th>Lo que dice el banco</th><th>Concepto y cliente</th><th>Qué es</th></tr></thead>
              <tbody>
                {paraJulio.map((x) => {
                  const c = x.cobro, k = c.clave, d = c.decision
                  const propuesta = d ? null : proponerFactura(c, p.facturasCegid)
                  return (
                    <tr key={k} data-clave={k} data-estado={x.estado}>
                      <td>{fecha(c.fecha)}</td><td>{VIA[c.via] ?? c.via}</td><td className="q10-num">{eurQ10(Math.round(c.importe * 100))}</td>
                      <td className="q10-cliente">{c.texto ?? '—'}</td>
                      <td>
                        <select className="g4-boton" aria-label="Concepto de Cegid" value={concepto[k] ?? d?.concepto ?? ''} disabled={ocupado !== null} onChange={(e) => setConcepto((m) => ({ ...m, [k]: e.target.value }))}>
                          <option value="">Concepto…</option>
                          {Object.values(CONCEPTOS_CEGID).map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo} · {o.nombre}</option>)}
                        </select>
                        <input className="g4-boton" aria-label="Cliente de Cegid" inputMode="numeric" size={6} placeholder="Cliente" disabled={ocupado !== null}
                          value={cliente[k] ?? String(d?.cliente ?? c.codigo ?? '')} onChange={(e) => setCliente((m) => ({ ...m, [k]: e.target.value.replace(/\D/g, '') }))} />
                      </td>
                      <td>
                        {propuesta && <span className="q10-linea" data-prueba="banco-propuesta" data-factura={propuesta.factura}>{propuesta.frase}</span>}
                        <button type="button" className="g4-boton" data-tipo={propuesta ? 'primario' : undefined} disabled={ocupado !== null} onClick={() => void decidir(c, 'paga_factura')}>
                          {propuesta ? `Paga la factura ${propuesta.factura}, que ya existe` : 'Paga una factura que ya existe'}</button>
                        <button type="button" className="g4-boton" data-tipo="primario" disabled={ocupado !== null} onClick={() => void decidir(c, 'facturar')}>Facturar con este concepto</button>
                        <button type="button" className="g4-boton" disabled={ocupado !== null} onClick={() => void decidir(c, 'no_es_cobro')}>No es un cobro</button>
                        {d && <span className="g4-pequeno" data-prueba="banco-decidido">{x.porque}</span>}
                        {!d && <span className="g4-pequeno">{x.porque}</span>}
                        {frase(k)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {noSalen.length > 0 && (
            <details className="q10-pendientes" data-prueba="banco-no-salen">
              <summary>No salen ({noSalen.length}), con su porqué</summary>
              <ul className="q10-lista">
                {noSalen.map((x) => <li key={x.cobro.clave} data-clave={x.cobro.clave} data-estado={x.estado}>{fecha(x.cobro.fecha)} · {VIA[x.cobro.via] ?? x.cobro.via} · {eurQ10(Math.round(x.cobro.importe * 100))}{x.cliente ? ` · cliente ${x.cliente}` : ''}: {x.porque}</li>)}
              </ul>
            </details>
          )}

          {cuadre && (
            <div className="q10-paso" data-prueba="cuadre-vias">
              <h3 className="q10-subtitulo">El cuadre del mes, por vía</h3>
              <p className="q10-frase" data-prueba="cuadre-vias-frase" data-tono={cuadre.cuadra ? 'bien' : 'mal'}>{cuadre.frase}</p>
              <div className="q10-tabla-caja">
                <table className="q10-tabla" aria-label="Cuadre por vía">
                  <thead><tr><th>Vía</th><th className="q10-num">Cobrado</th><th className="q10-num">Mandado a Cegid</th><th className="q10-num">Paga facturas que ya existen</th><th className="q10-num">No es cobro</th><th className="q10-num">Diferencia</th></tr></thead>
                  <tbody>
                    {[...cuadre.vias, cuadre.total].map((f) => (
                      <tr key={f.via} data-via={f.via}><td>{f.via}</td><td className="q10-num">{eurQ10(f.cobradoCent)}</td><td className="q10-num">{eurQ10(f.mandadoCent)}</td>
                        <td className="q10-num">{eurQ10(f.pagaFacturaCent)}</td><td className="q10-num">{eurQ10(f.noCobroCent)}</td><td className="q10-num">{eurQ10(f.diferenciaCent)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cuadre.clientes.length > 0 && (
                <details className="q10-pendientes" data-prueba="cuadre-vias-clientes">
                  <summary>Clientes con diferencia ({cuadre.clientes.length})</summary>
                  <ul className="q10-lista">{cuadre.clientes.map((k) => <li key={k.cliente}>Cliente {k.cliente}: cobrado {eurQ10(k.cobradoCent)}, mandado {eurQ10(k.mandadoCent)}, paga facturas {eurQ10(k.pagaFacturaCent)} · diferencia {eurQ10(k.diferenciaCent)}</li>)}</ul>
                </details>
              )}
              {cuadre.sinCliente.length > 0 && (
                <details className="q10-pendientes" data-prueba="cuadre-vias-sin-cliente">
                  <summary>Sin cliente ({cuadre.sinCliente.length})</summary>
                  <ul className="q10-lista">{cuadre.sinCliente.map((x) => <li key={x.clave}>{eurQ10(x.cent)}: {x.porque}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
