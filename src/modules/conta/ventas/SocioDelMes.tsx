// src/modules/conta/ventas/SocioDelMes.tsx
//
// V01 · Entrega 3 · Lo que añade Ventas › Liquidaciones a la ficha mensual del
// socio de marca (CTB), como lo pidió Julio el 24/10:
//
//   · Los albaranes del mes y del local que pagó el socio: SOPORTE, no se
//     contabilizan. Y su factura de compra (FV) contra ellos: coincide, o la
//     diferencia y qué albaranes faltan o sobran (lib/socioDelMes.ts).
//   · Sus asientos (los de licensed_settlement: su FV a la 600, la AF a la 705
//     y la compensación), con «Validar» aquí: ya no salen en Contabilidad ›
//     Asientos. Si aún no están, «Proponer sus asientos».
//   · El cobro del saldo, por banco o por factoring: los movimientos del
//     mismo importe desde el fin del mes, y «Casar» (bank_casar a su 430, como
//     en Bancos). No se envía nada a Diez: entra en el traspaso del mes.
// Cada botón dice lo que ha hecho, o por qué no (regla 8).
// Nombres dentro de cadenas (regla 40): journal_entry (source_type,
// source_id, status, number, concept, entry_date), bank_movement, bank_casar.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento } from '@/config/navegacion'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Tarjeta } from '@/modules/conta/ui/piezas'
import { eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { diaConNombre } from '@/modules/conta/lib/compras'
import { baseFv, contrastarFv } from '@/modules/conta/lib/socioDelMes'
import type { FacturaLeida } from '@/modules/conta/lib/lectorLiquidacionMensual'
import { albaranesDeLiquidacion } from '@/modules/conta/services/comprasService'
import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { validar } from '@/modules/conta/services/diarioService'
import { cargarContexto, proponerPendientes } from '@/modules/conta/services/propuestasLibroService'
import { candidatosCobro, type MovimientoCandidato } from '@/modules/conta/services/liquidacionesVentasService'
import { VerPapel } from '@/modules/conta/compras/VerPapel'

type Fila = Record<string, unknown>
interface AsientoSocio { id: string; estado: string; numero: number | null; concepto: string; fecha: string }

async function asientosDe(accountId: string, liqId: string): Promise<AsientoSocio[]> {
  const { data, error } = await tabla('journal_entry').select('id, status, number, concept, entry_date')
    .eq('account_id', accountId).eq('source_type', 'licensed_settlement').eq('source_id', liqId).neq('status', 'anulado').order('entry_date')
  if (error) throw new Error(mensaje('No se han podido leer sus asientos', error))
  return ((data ?? []) as Fila[]).map((e) => ({ id: String(e.id), estado: String(e.status), numero: e.number == null ? null : Number(e.number), concepto: String(e.concept ?? ''), fecha: String(e.entry_date) }))
}

export function SocioDelMes({ accountId, companyId, liq, recibida, quien }: {
  accountId: string; companyId: string | null; quien: string | null
  liq: { id: string; status: string; period_from: string; period_to: string; net_settlement: number | null; party_id: string | null }
  recibida: FacturaLeida | null
}) {
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const albaranes = useLeer(() => albaranesDeLiquidacion(liq.id), `${liq.id}:albaranes`)
  const asientos = useLeer(() => asientosDe(accountId, liq.id), `${liq.id}:asientos:${vuelta}`)
  const saldo = liq.net_settlement == null ? null : Number(liq.net_settlement)
  const cobro = useLeer(companyId && saldo !== null && saldo > 0 ? () => candidatosCobro(accountId, companyId, saldo, liq.period_to) : null, `${liq.id}:cobro:${vuelta}`)
  const confirmada = liq.status !== 'borrador'

  const c = albaranes.datos ? contrastarFv(baseFv(recibida), albaranes.datos.map((a) => ({ id: a.recepcion, codigo: a.codigo, fecha: a.fecha, base: a.base }))) : null
  const sobra = new Set(c?.sobran.length === 1 ? c.sobran[0].map((a) => a.id) : [])

  async function hacer(clave: string, f: () => Promise<string>) {
    setOcupado(clave); setAviso(null)
    try { setAviso({ ok: true, texto: await f() }); setVuelta((v) => v + 1) }
    catch (e) { setAviso({ ok: false, texto: e instanceof Error ? e.message : String(e) }) }
    setOcupado(null)
  }

  async function casar(m: MovimientoCandidato): Promise<string> {
    if (!companyId || !liq.party_id) throw new Error('La liquidación no dice su socio: no sé a qué 430 va el cobro.')
    const ctx = await cargarContexto(accountId, companyId)
    const c430 = ctx.enlace('customer', liq.party_id, 'principal')
    if (!c430) throw new Error('El socio no tiene su cuenta de cliente (430): ponla en Contactos.')
    await rpc('bank_casar', {
      p_movement: m.id, p_destino: { tipo: 'cuenta', tercero_id: liq.party_id, concepto: 'Cobro de la liquidación del socio', lineas: [{ cuenta: c430, importe: m.importe }] },
      p_confianza: 'seguro', p_porque: `Casado desde Ventas › Liquidaciones: el saldo de la liquidación (${eurosExactos(m.importe)}), llegado el ${m.fecha.split('-').reverse().join('/')}.`,
      p_razones: [], p_por: 'persona', p_regla: null,
    })
    return `Cobro casado: ${eurosExactos(m.importe)} del ${m.fecha.split('-').reverse().join('/')}${m.banco ? ` en ${m.banco}` : ''}, con su asiento del banco contra la ${c430}.`
  }

  return (
    <>
      {aviso && <div className={aviso.ok ? 'cx-guardado' : 'cx-error'} role={aviso.ok ? 'status' : 'alert'} data-prueba="resultado-socio">{aviso.texto}</div>}

      <Tarjeta titulo="Su factura (FV) y los albaranes del mes">
        <p className="cx-ayuda" style={{ marginTop: 0 }}>Los albaranes de los proveedores que le facturan a él no se contabilizan: se guardan aquí como soporte, por mes y por local. Su factura sí se apunta como compra (600): lo que llega del socio se usa en todas las marcas.</p>
        {albaranes.error && <div className="cx-error" role="alert">{albaranes.error}</div>}
        {!albaranes.datos && !albaranes.error && <p className="cx-ayuda" aria-busy="true">Leyendo los albaranes…</p>}
        {c && <p className={c.estado === 'coincide' ? 'cx-guardado' : 'cx-aviso'} data-prueba="fv-albaranes" data-estado={c.estado}>{c.texto}</p>}
        {albaranes.datos && albaranes.datos.length > 0 && (
          <ul className="cxc-albaranes" aria-label="Albaranes del mes">
            {albaranes.datos.map((a) => (
              <li key={a.recepcion} data-sobra={sobra.has(a.recepcion) ? 'si' : undefined}>
                <span>{diaConNombre(a.fecha)} · {a.base == null ? 'sin importe' : eurosExactos(a.base)} <span className="cxc-cosa-codigo">{a.codigo}</span>{sobra.has(a.recepcion) ? ' · sobra' : ''}</span>
                <VerPapel recepcion={a.recepcion} tipo="albaran" titulo={`Albarán · ${diaConNombre(a.fecha)}`} />
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta titulo="Sus asientos">
        {asientos.error && <div className="cx-error" role="alert">{asientos.error}</div>}
        {asientos.datos && asientos.datos.length === 0 && (
          <p className="cx-ayuda" style={{ marginTop: 0 }}>
            {confirmada ? 'Aún no se han propuesto: su factura a la 600, la tuya a la 705 y la compensación.' : 'Se proponen al contabilizarla.'}{' '}
            {confirmada && companyId && (
              <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => void hacer('proponer', async () => {
                const r = await proponerPendientes(accountId, companyId, liq.period_from, hoyEnMadrid(), quien)
                return `Propuesto lo pendiente desde el ${liq.period_from.split('-').reverse().join('/')}: ${r.propuestas} ${r.propuestas === 1 ? 'asiento' : 'asientos'} nuevos${r.yaEstaban ? `, ${r.yaEstaban} ya estaban` : ''}.${r.sinPropuesta.length ? ` Sin propuesta: ${r.sinPropuesta.slice(0, 3).map((x) => `${x.que} (${x.porque})`).join('; ')}.` : ''}`
              })}>{ocupado === 'proponer' ? 'Proponiendo…' : 'Proponer sus asientos'}</button>
            )}
          </p>
        )}
        {asientos.datos && asientos.datos.length > 0 && (
          <ul className="cxc-albaranes" aria-label="Sus asientos">
            {asientos.datos.map((e) => (
              <li key={e.id}>
                <span><Link to={rutaAsiento(e.id)}>{e.numero ? `Nº ${e.numero.toLocaleString('es-ES')}` : 'Propuesto'}</Link> · {e.fecha.split('-').reverse().join('/')} · {e.concepto}</span>
                {e.estado === 'propuesto'
                  ? <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => void hacer(e.id, async () => {
                      const v = await validar(e.id, quien)
                      return `Validado el asiento nº ${v.numero.toLocaleString('es-ES')} (${e.concepto}). Entra en el traspaso del mes.`
                    })}>{ocupado === e.id ? 'Validando…' : 'Validar'}</button>
                  : <span className="cx-ayuda">{e.estado === 'validado' ? 'Validado' : e.estado}</span>}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {saldo !== null && saldo > 0 && (
        <Tarjeta titulo="El cobro">
          <p className="cx-ayuda" style={{ marginTop: 0 }}>Te paga {eurosExactos(saldo)}, por banco o por factoring. Los movimientos de ese importe desde el fin del mes y sin casar:</p>
          {cobro.error && <div className="cx-error" role="alert">{cobro.error}</div>}
          {cobro.datos && cobro.datos.length === 0 && <p className="cx-ayuda">Ninguno: aún no ha llegado, llegó por otro importe o ya está casado en Bancos.</p>}
          {cobro.datos && cobro.datos.length > 0 && (
            <ul className="cxc-albaranes" aria-label="Movimientos que pueden ser su cobro">
              {cobro.datos.map((m) => (
                <li key={m.id}>
                  <span>{m.fecha.split('-').reverse().join('/')} · {eurosExactos(m.importe)} · {m.concepto}{m.banco ? ` · ${m.banco}` : ''}</span>
                  <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => void hacer(m.id, () => casar(m))}>{ocupado === m.id ? 'Casando…' : 'Casar'}</button>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      )}
    </>
  )
}
