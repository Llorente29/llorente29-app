// src/modules/conta/pagos/ResultadoPago.tsx
//
// B01 · Cola 1e · Maqueta v2, pantalla 4: «Pagado: la confirmación dice qué ha
// pasado». Debajo de «Pagadas N facturas · X € desde Revolut · el cargo se
// casará solo», cada factura del pago con lo que dice Revolut y su justificante:
//   · «Salió»: el justificante, «Ver»;
//   · «Pendiente en el banco»: «Saldrá cuando Revolut confirme»;
//   · rechazado: por qué, y la factura sigue por pagar.
// Se lee del lote (conta_pago_lote_ver) y de conta_pago_justificante (RLS).
// «Preguntar a Revolut» vuelve a mirar (regla 8: dice lo que ha pasado).

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { enlaceJustificante } from '@/modules/conta/lib/justificante'
import { preguntarEstado, queDiceElBanco, verLote } from '@/modules/conta/pagos/pagarService'
import { tabla } from '@/modules/conta/services/bd'

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''

async function justificantesDe(salidas: string[]): Promise<Map<string, string>> {
  if (!salidas.length) return new Map()
  const { data, error } = await tabla('conta_pago_justificante').select('salida_id, clave').in('salida_id', salidas)
  if (error) return new Map() // Antes de la 2140 en este entorno: sin justificantes todavía.
  return new Map(((data ?? []) as unknown as { salida_id: string; clave: string }[]).map((j) => [j.salida_id, j.clave]))
}

export function ResultadoPago({ empresaId, lote }: { empresaId: string; lote: string }) {
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [preguntando, setPreguntando] = useState(false)
  const datos = useLeer(async () => {
    const l = await verLote(lote)
    return { l, js: await justificantesDe(l.pagos.map((p) => p.id)) }
  }, `resultado-pago:${lote}:${vuelta}`)
  if (datos.error) return <p className="s-apoyo">No se ha podido leer cómo va el pago: {datos.error}</p>
  if (!datos.datos) return null
  const { l, js } = datos.datos
  const banco = l.desde.banco
  const pendientes = l.pagos.some((p) => !['pagada', 'rechazada', 'devuelta', 'cancelada'].includes(p.estado))
  const preguntar = async () => {
    setPreguntando(true); setAviso(null)
    const r = await preguntarEstado(empresaId, lote)
    setPreguntando(false); setAviso(r.texto); setVuelta((v) => v + 1)
  }
  return (
    <section className="pg-resultado" aria-label="Cómo va el pago" data-prueba="resultado-pago">
      <table className="pg-resultado-tabla">
        <thead><tr><th scope="col">Factura</th><th scope="col" className="s-lista-cifra">Importe</th><th scope="col">{banco} dice</th><th scope="col">Justificante</th></tr></thead>
        <tbody>
          {l.pagos.map((p) => {
            const q = queDiceElBanco(p.estado, banco)
            const clave = js.get(p.id)
            return (
              <tr key={p.id} data-prueba="resultado-fila" data-estado={p.estado}>
                <td>{p.beneficiario}{p.concepto ? <span className="s-apoyo"> · {p.concepto}</span> : null}</td>
                <td className="s-lista-cifra s-cifra">{eurosExactos(p.importe)}</td>
                <td><span className="s-chip" data-tono={q.tono}>{q.texto}</span></td>
                <td>{clave
                  ? <a href={enlaceJustificante(URL_BASE, clave)} target="_blank" rel="noreferrer" data-prueba="resultado-ver">Ver</a>
                  : <span className="s-apoyo">{p.estado === 'pagada' ? 'Se está haciendo' : q.tono === 'falta' ? '—' : `Saldrá cuando ${banco} confirme`}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {pendientes && (
        <div className="pg-resultado-pie">
          <p className="s-apoyo">«Pendiente en {banco}»: Sumied le vuelve a preguntar cada hora; si lo rechaza, la factura vuelve a «Por pagar» y te avisa.</p>
          <Boton onClick={() => void preguntar()} disabled={preguntando}>{preguntando ? 'Preguntando…' : `Preguntar a ${banco}`}</Boton>
        </div>
      )}
      {aviso && <p className="s-aviso-lista" role="status">{aviso}</p>}
    </section>
  )
}
