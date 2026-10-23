// src/modules/conta/documentos/IvaNoDeducibleFicha.tsx
//
// D07 · En la ficha de la recibida: «Su IVA no se deduce», con su motivo (no
// está a nombre de la empresa, ticket sin NIF u otro, con su texto). Caso:
// Orange S11/0177416578 del 05/10. Se guarda al momento (tanda 0850,
// conta_recibida_iva_no_deducible) y dice qué ha hecho (regla 8). Validada,
// solo se lee.

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { BloqueFicha } from '@/modules/conta/diseno/plantillas'
import { useLeer } from '@/modules/conta/libros/contexto'
import { MOTIVOS_NO_DEDUCIBLE, faltaParaGuardar, porQueNoDeducible, type MotivoNoDeducible } from '@/modules/conta/lib/ivaNoDeducible'
import { leerNoDeducible, marcarNoDeducible } from '@/modules/conta/services/ivaNoDeducibleService'

export function IvaNoDeducibleFicha({ accountId, invoiceId, soloLectura, quien, alGuardar }: {
  accountId: string | null
  invoiceId: string
  soloLectura: boolean
  quien: string | null
  /** Lo guardado ha cambiado su asiento: que la ficha lo vuelva a leer. */
  alGuardar: () => void
}) {
  const [vuelta, setVuelta] = useState(0)
  const leido = useLeer(accountId ? () => leerNoDeducible(accountId, invoiceId) : null, `${accountId}:${invoiceId}:no-deducible:${vuelta}`)
  const [borrador, setBorrador] = useState<{ clave: string; nd: boolean; motivo: MotivoNoDeducible | null; texto: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<{ texto: string; bien: boolean } | null>(null)
  const d = leido.datos
  const clave = `${invoiceId}:${vuelta}`
  const b = borrador?.clave === clave ? borrador : d ? { clave, nd: d.noDeducible, motivo: d.motivo, texto: d.texto ?? '' } : null
  if (leido.error) return <BloqueFicha titulo="IVA"><p className="s-apoyo">No se ha podido saber si su IVA se deduce: {leido.error}</p></BloqueFicha>
  if (!d || !b) return null
  const cambiado = b.nd !== d.noDeducible || (b.nd && (b.motivo !== d.motivo || (b.motivo === 'otro' && b.texto.trim() !== (d.texto ?? ''))))
  const falta = faltaParaGuardar(b.nd, b.motivo, b.texto)
  const guardar = async () => {
    setGuardando(true); setMensaje(null)
    try {
      const t = await marcarNoDeducible(invoiceId, b.nd, b.motivo, b.motivo === 'otro' ? b.texto.trim() : null, quien)
      setMensaje({ texto: t, bien: true }); setBorrador(null); setVuelta((v) => v + 1); alGuardar()
    } catch (e) {
      setMensaje({ texto: `No se ha guardado: ${e instanceof Error ? e.message : String(e)}`, bien: false })
    } finally { setGuardando(false) }
  }
  const porque = porQueNoDeducible(d.motivo, d.texto)
  if (soloLectura) {
    return d.noDeducible ? (
      <BloqueFicha titulo="IVA">
        <p className="s-apoyo" data-prueba="iva-no-deducible">Su IVA no se deduce{porque ? `: ${porque}` : ''}. Va a su gasto, en el libro de recibidas como no deducible y fuera del 303.</p>
      </BloqueFicha>
    ) : null
  }
  return (
    <BloqueFicha titulo="IVA">
      <div className="s-fila-campos" data-prueba="iva-no-deducible">
        <label className="s-casilla">
          <input type="checkbox" checked={b.nd} onChange={(e) => setBorrador({ ...b, nd: e.target.checked, motivo: e.target.checked ? b.motivo : null })} />
          {' '}Su IVA no se deduce
        </label>
        {b.nd && (
          <select className="s-control" aria-label="Por qué no se deduce" value={b.motivo ?? ''} onChange={(e) => setBorrador({ ...b, motivo: (e.target.value || null) as MotivoNoDeducible | null })}>
            <option value="">Por qué…</option>
            {MOTIVOS_NO_DEDUCIBLE.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
          </select>
        )}
        {b.nd && b.motivo === 'otro' && (
          <input className="s-control" aria-label="Cuál es el motivo" placeholder="Cuál" value={b.texto} onChange={(e) => setBorrador({ ...b, texto: e.target.value })} />
        )}
        {cambiado && <Boton onClick={() => void guardar()} disabled={guardando || !!falta}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>}
      </div>
      <p className="s-apoyo">
        {cambiado && falta ? falta
          : b.nd ? 'La cuota va a su gasto (no a la 472), sale en el libro de recibidas como no deducible y no entra en el 303.'
            : 'Su IVA se deduce: va a la 472 y al 303.'}
      </p>
      {mensaje && <p className="s-aviso-lista" data-tono={mensaje.bien ? 'ok' : 'falta'} role="status">{mensaje.texto}</p>}
    </BloqueFicha>
  )
}
