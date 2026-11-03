// src/modules/conta/pagos/Justificante.tsx
//
// B01 · Cola 1e · El justificante de un pago, en la ficha de la factura
// (Julio, 02/11, B01·7 y B01·8). Lo hace Sumied cuando el banco confirma que
// el pago ha salido (la API de Revolut no da comprobante de una transferencia).
//
// Como la maqueta v2 (pantalla 5, «pagada, con su justificante»):
//   · «Justificante de pago»: cuándo salió, desde dónde y el importe;
//   · «Descargar el PDF», por su enlace público (30 días);
//   · «Enviar por WhatsApp»: wa.me con su teléfono y el enlace. Sin teléfono,
//     «Pon el teléfono de … para enviarlo por WhatsApp» lleva a sus contactos;
//   · «Mandar al proveedor» (correo): solo sale si su ficha tiene marcada
//     «Mandar el justificante al pagar»; si no, una línea lleva a marcarla.
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
/** «02/11 13:04», en la hora de Madrid. */
function diaHora(iso: string): string {
  const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${v('day').padStart(2, '0')}/${v('month').padStart(2, '0')} ${v('hour')}:${v('minute')}`
}

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
    <BloqueFicha titulo="Justificante de pago">
      {js.map((j) => {
        const enlace = enlaceJustificante(URL_BASE, j.clave)
        const wa = enlaceWhatsApp(j.telefono, textoWhatsApp({ empresa, numero, importe: j.importe, enlace, pagadoAt: j.pagadoAt }))
        const caducado = haCaducado(j.caduca)
        return (
          <div key={j.id} className="pg-justificante" data-prueba="justificante">
            <dl className="pg-justificante-datos">
              <div><dt>Salió</dt><dd>{diaHora(j.pagadoAt)}</dd></div>
              <div><dt>Desde</dt><dd>{[j.banco ?? 'el banco', j.desdeIban4 ? `···${j.desdeIban4}` : null].filter(Boolean).join(' ')}</dd></div>
              <div><dt>Importe</dt><dd className="s-cifra">{eurosExactos(j.importe)}</dd></div>
            </dl>
            <div className="pg-justificante-botones">
              {!caducado && <a className="s-boton s-boton-principal" href={enlace} target="_blank" rel="noreferrer" data-prueba="justificante-ver">Descargar el PDF</a>}
              {!caducado && wa && <a className="s-boton s-boton-secundario" href={wa} target="_blank" rel="noreferrer" data-prueba="justificante-whatsapp">Enviar por WhatsApp</a>}
              {j.alPagar && (
                <Boton variante="secundario" onClick={() => void mandar(j.id)} disabled={mandando === j.id} data-prueba="justificante-correo">
                  {mandando === j.id ? 'Mandando…' : j.correoAt ? 'Mandar otra vez al proveedor' : 'Mandar al proveedor'}
                </Boton>
              )}
            </div>
            {!caducado && !wa && (
              <Link className="pg-justificante-falta" to={`${rutaFichaProveedor(j.supplierId, 'contactos')}?nuevo=1`} data-prueba="justificante-whatsapp-sin-telefono">
                Pon el teléfono de {j.proveedor} para enviarlo por WhatsApp
              </Link>
            )}
            {j.correoAt && <p className="s-apoyo" data-prueba="justificante-mandado">Mandado por correo a {j.correoA} el {diaMes(j.correoAt)}.</p>}
            {!j.correoAt && j.correoTexto && <p className="s-apoyo" data-prueba="justificante-sin-mandar">{j.correoTexto}</p>}
            {!j.alPagar && (
              <p className="s-apoyo">«Mandar al proveedor» no sale: su ficha no tiene marcado «Mandar el justificante al pagar». <Link to={rutaFichaProveedor(j.supplierId, 'contabilidad')} data-prueba="justificante-correo-marcar">Marcarlo</Link></p>
            )}
            <p className="s-apoyo">{caducado ? 'El enlace para WhatsApp ha caducado; el PDF sigue en Sumied.' : `${caducaEn(j.caduca)}.`}</p>
          </div>
        )
      })}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono === 'falta' ? 'alert' : 'status'} data-prueba="justificante-aviso">{aviso.texto}</p>}
    </BloqueFicha>
  )
}
