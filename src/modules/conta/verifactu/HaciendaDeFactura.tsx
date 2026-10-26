// src/modules/conta/verifactu/HaciendaDeFactura.tsx
//
// V03 · Entrega 2 · Una factura emitida con Hacienda (tablero 27):
//   · RECHAZADA: qué falta, en palabras de la calle; si es el porqué de una
//     venta sin IVA, «¿Qué le has vendido?» aquí mismo; «Corregir y reenviar»
//     (la base escribe la subsanación: la factura del cliente no cambia), y
//     «Lo que dijo Hacienda», plegado, con su código y su texto.
//   · «Cómo va con Hacienda»: cada paso con su hora (emitida, enviada,
//     recibida o rechazada, reenvío).
//   · E3 · «Me he equivocado en…» (MeHeEquivocado): rectificar, anular o
//     subsanar, diciendo antes qué va a pasar.

import { useState } from 'react'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { useLeer } from '@/modules/conta/libros/contexto'
import { aTipoVenta, porqueNoVale, zonaDelCliente, type PorqueSinIva as Porque } from '@/modules/conta/lib/ventasSinIva'
import { lineaDeTiempo, porQueRechazo } from '@/modules/conta/lib/verifactu/estado'
import { historiaHacienda, reenviarAHacienda } from '@/modules/conta/services/verifactuService'
import { PorqueSinIva } from '@/modules/conta/ventas/FacturaVentaBloques'
import { MeHeEquivocado } from './MeHeEquivocado'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const hora = (iso: string | null) => {
  if (!iso) return 'pendiente de ti'
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)
  const p = (t: string) => f.find((x) => x.type === t)?.value ?? ''
  return `${p('day')}/${p('month')} ${p('hour')}:${p('minute')}`
}

export function HaciendaDeFactura({ accountId, factura, quien, alRectificar, alCambiar }: {
  accountId: string
  factura: { id: string; numero: string | null; emitidaEl: string | null; porque: Porque | null; sinIva: boolean; pais: string | null; anulada: boolean }
  quien: string | null
  /** E3 · abre la rectificativa (el «Corregir» de la ficha); null si no se rectifica. */
  alRectificar?: (() => void) | null
  /** E3 · se ha anulado o subsanado: la ficha vuelve a leer. */
  alCambiar?: () => void
}) {
  const [vuelta, setVuelta] = useState(0)
  const h = useLeer(() => historiaHacienda(accountId, factura.id), `${accountId}:${factura.id}:hacienda:${vuelta}`)
  const [porque, setPorque] = useState<Porque | null>(factura.porque)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  if (h.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer cómo va con Hacienda: {h.error}</p>
  const d = h.datos
  const avisoReenvio = aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'} role="status" data-prueba="aviso-reenvio">{aviso.texto}</p>
  // Mientras vuelve a leer (después de reenviar), el aviso sigue a la vista (regla 8).
  if (!d || d.registros.length === 0) return avisoReenvio || null
  const e = d.estado
  const rechazada = e?.estado === 'incorrecto'
  const r = rechazada ? porQueRechazo(e.codigo, e.descripcion) : null
  const zona = zonaDelCliente(factura.pais)
  const noVale = r?.tipoVenta ? porqueNoVale(porque, zona) : null
  const cambia = r?.tipoVenta && porque !== factura.porque
  const reenviar = () => {
    setOcupado(true); setAviso(null)
    void reenviarAHacienda(factura.id, cambia ? aTipoVenta(porque) : null, quien)
      .then((x) => {
        setAviso({ ok: true, texto: `Reenviada la ${x.num_serie} a Hacienda: sale en el próximo envío. Tu cliente no nota nada: su factura no cambia.` })
        setVuelta((v) => v + 1)
      })
      .catch((err) => setAviso({ ok: false, texto: msg(err) }))
      .finally(() => setOcupado(false))
  }
  const pasos = lineaDeTiempo(factura.emitidaEl, d.registros)
  return (
    <>
      {rechazada && r && (
        <Tarjeta tono="falta">
          <div className="cxvf-rechazo" data-prueba="factura-rechazada">
            <p><Chip tono="falta">Rechazada por Hacienda</Chip> <span className="s-tarjeta-apoyo">{hora(e.respondido)} · tu factura es válida, solo falla su registro</span></p>
            <h2 className="cxvf-rechazo-titulo">{r.titulo}</h2>
            <p>{r.texto}</p>
            {r.tipoVenta && factura.sinIva && (
              <PorqueSinIva zona={zona} porque={porque} noVale={noVale} alElegir={setPorque} />
            )}
            <div>
              <Boton variante="principal" disabled={ocupado || (r.tipoVenta && (!porque || !!noVale))} onClick={reenviar}>{ocupado ? 'Reenviando…' : 'Corregir y reenviar'}</Boton>
              <p className="s-tarjeta-apoyo">Se reenvía el registro. La factura que tiene tu cliente no cambia.</p>
            </div>
            <details data-prueba="lo-que-dijo-hacienda">
              <summary>Lo que dijo Hacienda</summary>
              <p className="s-tarjeta-apoyo">{e.codigo ? `Código ${e.codigo}: ` : ''}{e.descripcion ?? 'Sin texto.'}</p>
            </details>
          </div>
        </Tarjeta>
      )}
      {avisoReenvio}
      <Tarjeta titulo="Cómo va con Hacienda">
        <ol className="cxvf-linea" data-prueba="como-va-con-hacienda">
          {pasos.map((p, i) => (
            <li key={i}>
              <span className="cxvf-punto" data-tono={p.tono === 'espera' ? undefined : p.tono} aria-hidden="true" />
              <span>{p.texto}</span>
              <span className="cxvf-linea-cuando">{hora(p.cuando)}</span>
            </li>
          ))}
        </ol>
        {r?.tipoVenta && <p className="s-tarjeta-apoyo">Desde ahora Sumied lo pregunta antes de emitir una factura sin IVA: no te volverá a pasar.</p>}
        {!factura.anulada && (
          <MeHeEquivocado factura={{ id: factura.id, numero: factura.numero }} quien={quien} alRectificar={alRectificar ?? null}
            alHacer={(texto) => { setAviso({ ok: true, texto }); setVuelta((v) => v + 1); alCambiar?.() }} />
        )}
      </Tarjeta>
    </>
  )
}
