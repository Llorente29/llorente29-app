// src/modules/conta/documentos/LiquidacionesDeLaFactura.tsx
//
// D07 (camino B) · En la ficha de la factura de comisión de una plataforma
// (Uber, cada semana, con su PDF): las liquidaciones de su semana, marcadas,
// cuánto suman contra su total, y «Enlazar». Lo enlazado se dice en palabras
// (regla 8). Si su proveedor no es una plataforma, no sale.

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { BloqueFicha } from '@/modules/conta/diseno/plantillas'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { enlazarConLiquidaciones, liquidacionesDeLaSemana } from '@/modules/conta/services/liquidacionSemanaService'

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function LiquidacionesDeLaFactura({ accountId, supplierId, invoiceId, fecha, total, soloLectura, quien }: {
  accountId: string | null
  supplierId: string | null
  invoiceId: string
  fecha: string | null
  total: number | null
  soloLectura: boolean
  quien: string | null
}) {
  const [vuelta, setVuelta] = useState(0)
  const ls = useLeer(accountId && supplierId && fecha ? () => liquidacionesDeLaSemana(accountId, supplierId, invoiceId, fecha) : null,
    `${accountId}:${supplierId}:${invoiceId}:${fecha}:semana:${vuelta}`)
  const [quitadas, setQuitadas] = useState<Set<string>>(new Set())
  const [enlazando, setEnlazando] = useState(false)
  const [mensaje, setMensaje] = useState<{ texto: string; tono: 'ok' | 'duda' | 'falta' } | null>(null)
  if (ls.error) return <BloqueFicha titulo="Liquidaciones de su semana"><p className="s-apoyo">No se han podido leer: {ls.error}</p></BloqueFicha>
  if (!ls.datos) return null
  const todas = ls.datos
  const enlazadas = todas.filter((x) => x.enlazada)
  const libres = todas.filter((x) => !x.enlazada)
  const marcadas = libres.filter((x) => !quitadas.has(x.id))
  const suma = Math.round([...enlazadas, ...marcadas].reduce((t, x) => t + x.aFacturar, 0) * 100) / 100
  const cuadra = total !== null && Math.round(total * 100) === Math.round(suma * 100)
  const enlazar = async () => {
    setEnlazando(true); setMensaje(null)
    try {
      const r = await enlazarConLiquidaciones(invoiceId, [...enlazadas, ...marcadas].map((x) => x.id), quien)
      setMensaje({ texto: r.texto, tono: r.cuadra ? 'ok' : 'duda' }); setQuitadas(new Set()); setVuelta((v) => v + 1)
    } catch (e) {
      setMensaje({ texto: `No se ha enlazado: ${e instanceof Error ? e.message : String(e)}`, tono: 'falta' })
    } finally { setEnlazando(false) }
  }
  return (
    <BloqueFicha titulo="Liquidaciones de su semana">
      <div data-prueba="liquidaciones-de-la-factura">
        {todas.length === 0 && <p className="s-apoyo">Es la factura de comisión de una plataforma, pero no hay liquidaciones sin factura que acaben en los 13 días antes de su fecha.</p>}
        {enlazadas.length > 0 && <p className="s-apoyo">Enlazada con {enlazadas.length === 1 ? 'una liquidación' : `${enlazadas.length} liquidaciones`}: {enlazadas.map((x) => `${x.tienda ?? 'sin tienda'} (${ddmm(x.desde)}–${ddmm(x.hasta)})`).join(', ')}.</p>}
        {libres.length > 0 && !soloLectura && (
          <ul className="s-lista-simple">
            {libres.map((x) => (
              <li key={x.id}>
                <label>
                  <input type="checkbox" checked={!quitadas.has(x.id)} onChange={(e) => setQuitadas((q) => { const n = new Set(q); if (e.target.checked) n.delete(x.id); else n.add(x.id); return n })} />
                  {' '}{x.tienda ?? 'Sin tienda'} · del {ddmm(x.desde)} al {ddmm(x.hasta)} · {eurosExactos(x.aFacturar)}
                </label>
              </li>
            ))}
          </ul>
        )}
        {todas.length > 0 && (
          <p className={cuadra ? 's-apoyo' : 's-aviso-lista'} data-tono={cuadra ? undefined : 'duda'}>
            Suman {eurosExactos(suma)}{total !== null ? (cuadra ? ', como la factura.' : ` y la factura dice ${eurosExactos(total)}: revisa cuáles van.`) : '.'}
          </p>
        )}
        {!soloLectura && marcadas.length > 0 && (
          <Boton onClick={() => void enlazar()} disabled={enlazando}>
            {enlazando ? 'Enlazando…' : `Enlazar con ${marcadas.length + enlazadas.length === 1 ? 'esta liquidación' : `estas ${marcadas.length + enlazadas.length} liquidaciones`}`}
          </Boton>
        )}
        {mensaje && <p className="s-aviso-lista" data-tono={mensaje.tono} role="status">{mensaje.texto}</p>}
      </div>
    </BloqueFicha>
  )
}
