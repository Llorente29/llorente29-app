// src/modules/conta/documentos/BloqueComision.tsx
//
// S01i · En la ficha de la factura de comisión de una plataforma: «Se paga con
// la liquidación» (maqueta aprobada por Julio, 01/11). Ligada: su liquidación,
// sus facturas y lo que suman contra lo que factura (regla 7). Sin ligar: por
// qué, y las que encajan para elegir con un toque. Lo que se liga se dice en
// palabras (regla 8). Sustituye a «Liquidaciones de su semana» (D07), que
// dejaba marcadas todas las de los 13 días antes de la factura: las 8.
import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { cuadreLiquidacion, lineaCandidata, tituloComision, type EstadoComision } from '@/modules/conta/documentos/comision'
import { ligarComision } from '@/modules/conta/services/comisionService'

export function BloqueComision({ e, invoiceId, soloLectura, quien, alLigar }: {
  e: { datos: EstadoComision | null; error: string | null }
  invoiceId: string
  soloLectura: boolean
  quien: string | null
  alLigar: () => void
}) {
  const [ligando, setLigando] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ texto: string; tono: 'ok' | 'falta' } | null>(null)
  if (e.error) return <p className="cxf-error" role="status">No se ha podido saber con qué liquidación va: {e.error}</p>
  const d = e.datos
  if (!d || d.estado === 'no') return mensaje ? <p className="s-aviso-lista" data-tono={mensaje.tono} role="status">{mensaje.texto}</p> : null
  const { titulo, tono } = tituloComision(d)
  const ligar = async (id: string) => {
    setLigando(id); setMensaje(null)
    try {
      const r = await ligarComision(invoiceId, id, quien)
      setMensaje({ texto: r.texto, tono: 'ok' }); alLigar()
    } catch (x) {
      setMensaje({ texto: `No se ha ligado: ${x instanceof Error ? x.message : String(x)}`, tono: 'falta' })
    } finally { setLigando(null) }
  }
  return (
    <section className="s-bloque-ficha cxcm" data-tono={tono} aria-label="Se paga con la liquidación" data-prueba="comision" data-estado={d.estado}>
      <span className="cxcm-etiqueta">SE PAGA CON LA LIQUIDACIÓN</span>
      <strong>{titulo}</strong>
      {d.estado === 'ligada' && (() => {
        const l = d.liq
        const c = cuadreLiquidacion(l)
        const quien_ = [l.marca, l.local].filter(Boolean).join(' · ') || l.tienda
        return (
          <>
            <p className="s-apoyo">
              {quien_ ? `${quien_}. ` : ''}La liquidación factura {l.aFacturar === null ? '—' : eurosExactos(l.aFacturar)}
              {l.tePago !== null ? ` y te pagó ${eurosExactos(l.tePago)}` : ''}: la comisión se descuenta de lo que te paga, no se paga por banco.
            </p>
            <p className={c.diferencia ? 's-aviso-lista' : 's-apoyo'} data-tono={c.diferencia ? 'duda' : undefined} data-prueba="comision-cuadre">{c.texto}</p>
            {l.facturas.length > 1 && (
              <ul className="s-lista-simple">
                {l.facturas.map((f) => <li key={f.id}>{f.codigo ?? f.numero ?? 'Factura'}{f.numero && f.codigo ? ` · ${f.numero}` : ''} · {eurosExactos(f.total)}</li>)}
              </ul>
            )}
          </>
        )
      })()}
      {d.estado === 'fuera' && <p className="s-apoyo">{d.porque} No se paga por banco.</p>}
      {(d.estado === 'varias' || d.estado === 'sin_periodo' || d.estado === 'una') && (
        <>
          <p className="s-apoyo">{d.porque} Hasta que la elijas no sale en Pagos ni en Bancos.</p>
          {d.candidatas.length > 0 && (
            <ul className="cxcm-lista" aria-label="Liquidaciones que encajan">
              {d.candidatas.map((c) => (
                <li key={c.id} data-sugerida={c.id === d.sugerida ? 'si' : undefined}>
                  <span>{lineaCandidata(c)}{c.coincide ? ' · coincide al céntimo' : ''}</span>
                  {!soloLectura && (
                    <Boton variante={c.id === d.sugerida ? 'principal' : 'secundario'} onClick={() => void ligar(c.id)} disabled={ligando !== null}>
                      {ligando === c.id ? 'Ligando…' : 'Es esta'}
                    </Boton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {d.estado === 'falta' && <p className="s-apoyo">{d.porque} Mientras, no sale en Pagos ni en Bancos.</p>}
      {mensaje && <p className="s-aviso-lista" data-tono={mensaje.tono} role="status" data-prueba="comision-mensaje">{mensaje.texto}</p>}
    </section>
  )
}
