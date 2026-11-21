// src/modules/conta/compras/LineaSocio.tsx
//
// S01p·18 · punto 1 (Julio, 12/11; maqueta aprobada en la Respuesta S01p·18.1).
// Una línea de la transacción del socio que no es ninguna de las dos facturas
// ya no bloquea para siempre: se PREGUNTA en el sitio del aviso rojo, con
// botones, y cada botón confirma con contenido (regla 8):
//   · «Género que te cobrará el mes que viene»: Debe su 430 / Haber 4009;
//   · «Género del mes pasado que ya te cobra»: el contrario, nunca por más de
//     lo pendiente con él en ese local (no se fuerza el cuadre);
//   · «Otra cosa: la apunto yo a mano»: sin asiento.
// Lo que se contesta se recuerda por socio y concepto (compras_socio_regla_guardar)
// y se cambia aquí («Cambiar lo que es») y en la ficha del socio.

import { useState } from 'react'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { nombreMes } from '@/modules/conta/lib/compras'
import { Tarjeta } from '@/modules/conta/ui/piezas'
import {
  claveLinea, contestar, puedeSer, QUE_ES_LINEA,
  type LineaSocio, type LiquidacionLeida, type QueEsLinea,
} from '@/modules/conta/lib/lectorLiquidacionMensual'
import { guardarReglaSocio, TEXTO_QUE_ES, type ReglaSocio } from '@/modules/conta/compras/reglasSocio'

/** El mes siguiente al de la liquidación, en palabras («noviembre»). */
function mesSiguiente(hasta: string | undefined): string {
  if (!hasta) return 'el mes que viene'
  const [y, m] = hasta.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  return nombreMes(d.toISOString().slice(0, 10))
}
function fechaCorta(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}

/** Lo que se dice cuando una línea ya sabe qué es: con contenido, no un visto. */
function frases(l: LineaSocio, ctx: { socio: string; local: string; mesQueViene: string; pendiente: number; regla?: ReglaSocio }): { titulo: string; detalle: string; pie?: string } {
  if (l.queEs === 'pendiente_facturar') {
    return {
      titulo: l.porque === 'regla' && ctx.regla
        ? `Ya sé qué es: «${l.concepto}» es género que te cobrará el mes que viene (lo dijiste el ${fechaCorta(ctx.regla.fecha)}).`
        : `Apuntado: ${eurosExactos(l.importe)} de género que ${ctx.socio} te facturará en ${ctx.mesQueViene}.`,
      detalle: `Queda como deuda pendiente de facturar con ${ctx.socio}, de ${ctx.local}. Se cancela sola cuando su factura de ${ctx.mesQueViene} traiga ese género.`,
      pie: l.porque === 'contestada' ? `La próxima vez que ${ctx.socio} traiga esta línea, la apunto igual sin preguntar.` : undefined,
    }
  }
  if (l.queEs === 'cancela_pendiente') {
    const queda = Math.round((ctx.pendiente + l.importe) * 100) / 100
    return {
      titulo: l.porque === 'regla' && ctx.regla
        ? `Ya sé qué es: «${l.concepto}» es el género del mes pasado que ya te cobra (lo dijiste el ${fechaCorta(ctx.regla.fecha)}).`
        : `Su factura trae el género pendiente del mes pasado: ${eurosExactos(-l.importe)}. Lo doy por facturado.`,
      detalle: `La deuda pendiente de facturar con ${ctx.socio} en ${ctx.local} queda a ${eurosExactos(queda)}.`,
      pie: l.porque === 'contestada' ? `La próxima vez que ${ctx.socio} traiga esta línea, la apunto igual sin preguntar.` : undefined,
    }
  }
  return {
    titulo: l.porque === 'regla' && ctx.regla
      ? `Ya sé qué es: «${l.concepto}» la apuntas tú a mano (lo dijiste el ${fechaCorta(ctx.regla.fecha)}).`
      : `La apuntas tú: «${l.concepto}», ${eurosExactos(l.importe)}.`,
    detalle: 'Se guarda la liquidación y esta línea no va en ningún asiento: la factura que le haces lo dice en «Mira esto», en «Para revisar».',
    pie: l.porque === 'contestada' ? `La próxima vez que ${ctx.socio} traiga esta línea, te lo recordaré igual.` : undefined,
  }
}

const EXPLICA: Record<QueEsLinea, string> = {
  pendiente_facturar: 'Pedidos de este mes que aún no te ha facturado. Queda como deuda con él hasta que llegue su factura.',
  cancela_pendiente: 'Cancela lo que quedó pendiente el mes anterior.',
  a_mano: 'Se guarda la liquidación y esta línea queda en «Para revisar» con su importe, sin asiento.',
}

/**
 * Las líneas de la transacción que no son ninguna de las dos facturas: la
 * pregunta, o lo que ya se sabe de ellas. Va en el sitio del aviso rojo.
 */
export function LineasDelSocio({ lectura, empresa, proveedor, socio, local, pendiente, reglas, alCambiar }: {
  lectura: LiquidacionLeida; empresa: string | null; proveedor: string; socio: string; local: string
  pendiente: number; reglas: Readonly<Record<string, ReglaSocio>>; alCambiar: (l: LiquidacionLeida, regla?: ReglaSocio | null) => void
}) {
  const [fallo, setFallo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<number | null>(null)
  const mesQueViene = mesSiguiente(lectura.periodo?.hasta)

  async function elegir(i: number, q: QueEsLinea) {
    const l = lectura.lineasSocio[i]
    setGuardando(i); setFallo(null)
    try {
      const r = l.implicita || !empresa ? null
        : await guardarReglaSocio(empresa, proveedor, l.concepto, q)
      alCambiar(contestar(lectura, i, q), r)
    } catch (e) {
      setFallo(`No he podido recordar lo que es «${l.concepto}»: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setGuardando(null) }
  }

  return (
    <>
      {lectura.lineasSocio.map((l, i) => l.queEs === null ? (
        <section key={`${l.concepto}-${i}`} className="cxc-pregunta" aria-labelledby={`cxc-pregunta-${i}`} data-prueba="pregunta-linea">
          <div className="cxc-pregunta-cabeza">
            <strong id={`cxc-pregunta-${i}`}>¿Qué es esta línea?</strong>
            <span>«{l.concepto}» · <span className="cx-cifra cxc-pregunta-importe">{l.importe > 0 ? '+' : ''}{eurosExactos(l.importe)}</span></span>
          </div>
          <p className="cx-ayuda" style={{ margin: 0 }}>
            {l.nota ?? `${socio} te la ${l.importe > 0 ? 'suma al' : 'resta del'} saldo y no sale en ninguna de las dos facturas.`} Dime qué es y la apunto. Lo que digas lo recordaré para esta línea de {socio}.
          </p>
          <div className="cxc-ops">
            {QUE_ES_LINEA.map((q) => {
              const no = puedeSer(l, q, pendiente, socio)
              const sugerida = (q === 'pendiente_facturar' && l.importe > 0) || (q === 'cancela_pendiente' && !no)
              return (
                <button key={q} type="button" className={sugerida ? 'cxc-op cxc-op-sug' : 'cxc-op'} disabled={!!no || guardando !== null}
                  onClick={() => void elegir(i, q)} aria-describedby={`cxc-op-${i}-${q}`}>
                  <span className="cxc-op-t">{TEXTO_QUE_ES[q]}{sugerida && <span className="cxc-chip">lo más probable</span>}</span>
                  <span className="cxc-op-e" id={`cxc-op-${i}-${q}`}>{no ?? EXPLICA[q]}</span>
                </button>
              )
            })}
          </div>
          {guardando === i && <p role="status" style={{ margin: 0 }}>Apuntando…</p>}
        </section>
      ) : (
        <Contestada key={`${l.concepto}-${i}`} l={l} {...frases(l, { socio, local, mesQueViene, pendiente, regla: reglas[claveLinea(l.concepto)] })}
          alCambiar={l.implicita ? undefined : () => alCambiar(contestar(lectura, i, null))} />
      ))}
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </>
  )
}

function Contestada({ titulo, detalle, pie, alCambiar }: { l: LineaSocio; titulo: string; detalle: string; pie?: string; alCambiar?: () => void }) {
  return (
    <section className="cxc-hecho" role="status" data-prueba="linea-contestada">
      <span className="cxc-hecho-t">{titulo}</span>
      <span>{detalle}</span>
      {pie && <span className="cx-ayuda">{pie}</span>}
      {alCambiar && <button type="button" className="cx-enlace" style={{ justifySelf: 'start' }} onClick={alCambiar}>Cambiar lo que es</button>}
    </section>
  )
}

/** La cuenta que te manda, línea a línea, con las que no son ninguna de las dos facturas marcadas. */
export function CuentaQueTeManda({ lectura }: { lectura: LiquidacionLeida }) {
  const t = lectura.transaccion
  if (!t || (lectura.lineasSocio ?? []).length === 0) return null
  const otras = new Set(lectura.lineasSocio.filter((l) => !l.implicita).map((l) => claveLinea(l.concepto)))
  return (
    <Tarjeta titulo="La cuenta que te manda">
      <div className="cxc-lineas">
        {t.lineas.filter((l) => Math.round(l.importe * 100) !== 0).map((l, i) => (
          <span key={i} className="cxc-fila-cuenta" data-otra={otras.has(claveLinea(l.concepto)) || undefined}>
            <span>{l.concepto}</span><span className="cx-cifra">{eurosExactos(l.importe)}</span>
          </span>
        ))}
        {lectura.lineasSocio.filter((l) => l.implicita).map((l, i) => (
          <span key={`imp-${i}`} className="cxc-fila-cuenta" data-otra><span>{l.concepto} (sin línea: cuadra el saldo)</span><span className="cx-cifra">{eurosExactos(l.importe)}</span></span>
        ))}
        {t.saldo && <><span className="cxc-lineas-total">Saldo</span><span className="cxc-lineas-total cx-cifra">{eurosExactos(t.saldo.importe)}</span></>}
      </div>
    </Tarjeta>
  )
}

/** Lo que apuntará al contabilizar: los tres de siempre y, si hay, el de lo pendiente de facturar. */
export function LoQueApuntara({ lectura, socio }: { lectura: LiquidacionLeida; socio: string }) {
  const lineas = lectura.lineasSocio ?? []
  if (lineas.length === 0 || lineas.some((l) => l.queEs === null)) return null
  const e = lectura.emitida; const r = lectura.recibida
  const suma = (q: QueEsLinea) => Math.round(lineas.filter((l) => l.queEs === q).reduce((t, l) => t + l.importe * 100, 0)) / 100
  const pend = suma('pendiente_facturar'); const canc = suma('cancela_pendiente')
  const mesQueViene = mesSiguiente(lectura.periodo?.hasta)
  const menor = e?.total != null && r?.total != null ? Math.min(e.total, r.total) : null
  return (
    <Tarjeta titulo="Lo que apuntará al contabilizar">
      <div className="cxc-asientos">
        {e && <div className="cxc-asiento"><span className="cxc-asiento-t">Le facturas · {e.numero}</span><span className="cx-ayuda">{e.total != null ? eurosExactos(e.total) : '—'} de servicio y mercaderías aportadas</span></div>}
        {r && <div className="cxc-asiento"><span className="cxc-asiento-t">Te factura · {r.numero}</span><span className="cx-ayuda">{r.total != null ? eurosExactos(r.total) : '—'} de género</span></div>}
        {menor != null && <div className="cxc-asiento"><span className="cxc-asiento-t">Compensación de las dos</span><span className="cx-ayuda">{eurosExactos(menor)} que se restan de lo que te debe</span></div>}
        {pend !== 0 && <div className="cxc-asiento cxc-asiento-nuevo"><span className="cxc-asiento-t">Género pendiente de facturar</span><span className="cx-ayuda">{eurosExactos(pend)} más que te paga, a cuenta de su factura de {mesQueViene}</span></div>}
        {canc !== 0 && <div className="cxc-asiento cxc-asiento-nuevo"><span className="cxc-asiento-t">Se cancela lo pendiente del mes pasado</span><span className="cx-ayuda">{eurosExactos(-canc)}, contra lo que te paga este mes</span></div>}
      </div>
      {lectura.transaccion?.saldo && (
        <p className="cx-ayuda" style={{ margin: 0 }}>
          Con esto, lo que te debe {socio} de este mes son {eurosExactos(lectura.transaccion.saldo.importe)}, lo mismo que dice la transacción. El cobro del banco lo deja a cero.
        </p>
      )}
    </Tarjeta>
  )
}
