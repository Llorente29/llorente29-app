// src/modules/conta/pagos/Justificante.tsx
//
// B01 · Cola 1e · El justificante de un pago, en la ficha de la factura
// (Julio, 02/11, B01·7 y B01·8). Lo hace Sumied cuando el banco confirma que
// el pago ha salido (la API de Revolut no da comprobante de una transferencia).
//
//   · «Ver el justificante»: el PDF, por su enlace público (30 días).
//   · «Mandar al proveedor»: por correo, solo si su ficha tiene marcada
//     «Mandar el justificante al pagar»; si no, lo dice y lleva a marcarla.
//   · «Enviar por WhatsApp»: wa.me con su teléfono y el enlace. Sin teléfono,
//     el botón lo dice y lleva a ponerlo en sus contactos.
// Cada botón confirma o falla en pantalla (regla 8).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaFichaProveedor } from '@/config/navegacion'
import { Boton } from '@/modules/conta/diseno'
import { BloqueFicha } from '@/modules/conta/diseno/plantillas'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { caducaEn, haCaducado, enlaceJustificante, enlaceWhatsApp, textoWhatsApp } from '@/modules/conta/lib/justificante'
import { leerJustificantes, mandarJustificanteAlProveedor } from '@/modules/conta/pagos/justificanteService'

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const diaMes = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))

export function BloqueJustificantes({ facturaId, numero, empresa, quien }: { facturaId: string; numero: string | null; empresa: string; quien: string | null }) {
  const [vuelta, setVuelta] = useState(0)
  const lista = useLeer(() => leerJustificantes(facturaId), `justificantes:${facturaId}:${vuelta}`)
  const [aviso, setAviso] = useState<{ tono: 'seguro' | 'falta'; texto: string } | null>(null)
  const [mandando, setMandando] = useState<string | null>(null)
  if (lista.error) return <p className="s-apoyo" data-prueba="justificante-error">No se ha podido leer el justificante del pago: {lista.error}</p>
  const js = lista.datos ?? []
  if (!js.length) return null

  async function mandar(id: string) {
    setAviso(null); setMandando(id)
    try {
      const r = await mandarJustificanteAlProveedor(id, quien)
      setAviso({ tono: r.enviado ? 'seguro' : 'falta', texto: r.texto })
      if (r.enviado) setVuelta((x) => x + 1)
    } catch (e) {
      setAviso({ tono: 'falta', texto: `No se ha mandado: ${e instanceof Error ? e.message : String(e)}` })
    } finally { setMandando(null) }
  }

  return (
    <BloqueFicha titulo="Justificante del pago">
      {js.map((j) => {
        const enlace = enlaceJustificante(URL_BASE, j.clave)
        const wa = enlaceWhatsApp(j.telefono, textoWhatsApp({ empresa, numero, importe: j.importe, enlace }))
        const caducado = haCaducado(j.caduca)
        return (
          <div key={j.id} className="pg-justificante" data-prueba="justificante">
            <p className="pg-justificante-que">
              <strong>{eurosExactos(j.importe)}</strong> pagados a {j.proveedor} el {diaMes(j.pagadoAt)}, confirmado por el banco.
              {' '}<span className="s-apoyo">{caducaEn(j.caduca)} (el PDF sigue aquí).</span>
            </p>
            {j.correoAt && <p className="s-apoyo" data-prueba="justificante-mandado">Mandado a {j.correoA} el {diaMes(j.correoAt)}.</p>}
            {!j.correoAt && j.correoTexto && <p className="s-apoyo" data-prueba="justificante-sin-mandar">{j.correoTexto}</p>}
            <div className="pg-justificante-botones">
              {!caducado && <a className="cx-boton-sec" href={enlace} target="_blank" rel="noreferrer" data-prueba="justificante-ver">Ver el justificante</a>}
              {j.alPagar
                ? <Boton variante="secundario" onClick={() => void mandar(j.id)} disabled={mandando === j.id} data-prueba="justificante-correo">
                    {mandando === j.id ? 'Mandando…' : j.correoAt ? 'Mandar otra vez al proveedor' : 'Mandar al proveedor'}
                  </Boton>
                : <Link className="cx-boton-sec" to={rutaFichaProveedor(j.supplierId, 'contabilidad')} data-prueba="justificante-correo-marcar"
                    title="Su ficha no tiene marcada «Mandar el justificante al pagar»">Mandar al proveedor: márcalo en su ficha</Link>}
              {caducado
                ? <span className="s-apoyo">El enlace para WhatsApp ha caducado.</span>
                : wa
                  ? <a className="cx-boton-sec" href={wa} target="_blank" rel="noreferrer" data-prueba="justificante-whatsapp">Enviar por WhatsApp</a>
                  : <Link className="cx-boton-sec" to={`${rutaFichaProveedor(j.supplierId, 'contactos')}?nuevo=1`} data-prueba="justificante-whatsapp-sin-telefono">
                      Enviar por WhatsApp: falta su teléfono, ponlo
                    </Link>}
            </div>
          </div>
        )
      })}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono === 'falta' ? 'alert' : 'status'} data-prueba="justificante-aviso">{aviso.texto}</p>}
    </BloqueFicha>
  )
}
