// src/modules/conta/ventas/DialogosCobros.tsx
//
// PC01 · Entrega 3 · Los diálogos de Ventas › Cobros:
//   · «Enviarle el mandato para firmar»: prepara el mandato del cliente (su
//     referencia y un enlace de un solo uso que vale 30 días) y abre tu correo
//     con el enlace ya escrito, para que lo firme desde el móvil sin cuenta. El
//     enlace también se puede copiar. Nada sale solo: el correo lo mandas tú.
//   · «Lo ha devuelto el banco»: el motivo del banco; con el cargo de la
//     devolución ya en Bancos, se casa allí (PanelMovimiento).
// Cada uno dice lo que ha pasado con la frase que escribe la base (regla 8), o
// el fallo, dentro del diálogo.

import { useState } from 'react'
import { Boton, Campo, Dialogo, Texto } from '@/modules/conta/diseno'
import { correoDelMandato } from '@/modules/conta/lib/cobros'
import { prepararMandato } from '@/modules/conta/services/cobrosService'
import type { SinMandato } from '@/modules/conta/services/cobrosService'

const correoValido = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())

export function DialogoMandato({ empresaId, empresa = null, cliente, alCerrar }: {
  empresaId: string
  empresa?: string | null
  cliente: SinMandato
  alCerrar: (frase: string | null) => void
}) {
  const [correo, setCorreo] = useState(cliente.correo ?? '')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<{ frase: string; enlace: string; mailto: string } | null>(null)
  const [copiado, setCopiado] = useState(false)

  const preparar = async () => {
    if (correo.trim() && !correoValido(correo)) { setError('Ese correo no vale: revísalo.'); return }
    setOcupado(true); setError(null)
    try {
      const r = await prepararMandato(empresaId, cliente.id, correo.trim() || null)
      const enlace = `${window.location.origin}${r.enlace}`
      const c = correoDelMandato({ cliente: cliente.nombre, empresa, ref: r.ref, enlace, caduca: r.caduca })
      const mailto = `mailto:${encodeURIComponent(correo.trim())}?subject=${encodeURIComponent(c.asunto)}&body=${encodeURIComponent(c.cuerpo)}`
      setHecho({ frase: r.frase, enlace, mailto })
      if (correo.trim()) window.location.href = mailto
    } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }

  const copiar = async () => {
    if (!hecho) return
    try { await navigator.clipboard.writeText(hecho.enlace); setCopiado(true) } catch { setError('No se ha podido copiar: selecciona el enlace y cópialo a mano.') }
  }

  const fraseFinal = hecho ? `${hecho.frase}${correo.trim() ? ` Te he abierto el correo para ${correo.trim()} con el enlace: mándalo tú.` : ' Copia el enlace y mándaselo.'}` : null

  return (
    <Dialogo titulo={`Mandato de ${cliente.nombre}`} alCerrar={() => alCerrar(fraseFinal)}
      explicacion={`${cliente.nombre} paga por domiciliación y no tiene mandato firmado. Le preparo uno con un enlace para firmarlo desde el móvil, sin cuenta: escribe su nombre, su IBAN y acepta. Al firmar, su ficha de Contactos queda con el IBAN y el mandato.`}
      acciones={hecho
        ? <Boton variante="principal" onClick={() => alCerrar(fraseFinal)}>Hecho</Boton>
        : <>
          <Boton onClick={() => alCerrar(null)}>Cancelar</Boton>
          <Boton variante="principal" onClick={() => void preparar()} disabled={ocupado}>{ocupado ? 'Preparando…' : correo.trim() ? 'Preparar y abrir el correo' : 'Preparar el enlace'}</Boton>
        </>}>
      {!hecho && (
        <div className="pg-dialogo-campos">
          <Campo etiqueta="Su correo" ayuda={cliente.correo ? 'El de sus últimas facturas. Puedes cambiarlo.' : 'Si lo dejas vacío, te doy el enlace para que se lo mandes como quieras.'}>{(c) => (
            <Texto {...c} type="email" valor={correo} alCambiar={(x) => { setCorreo(x); setError(null) }} autoComplete="off" placeholder="administracion@cliente.es" />
          )}</Campo>
        </div>
      )}
      {hecho && (
        <div className="pg-dialogo-campos" data-prueba="mandato-preparado">
          <p className="s-aviso-lista" data-tono="seguro" role="status">{fraseFinal}</p>
          <Campo etiqueta="El enlace para firmar">{(c) => <Texto {...c} valor={hecho.enlace} alCambiar={() => undefined} readOnly />}</Campo>
          <span className="pg-aviso-acciones">
            <button type="button" className="pg-enlace" onClick={() => void copiar()}>{copiado ? 'Copiado' : 'Copiar el enlace'}</button>
            {correo.trim() && <a className="pg-enlace" href={hecho.mailto}>Abrir el correo otra vez</a>}
          </span>
        </div>
      )}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
    </Dialogo>
  )
}
