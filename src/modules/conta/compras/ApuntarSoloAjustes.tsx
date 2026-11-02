// src/modules/conta/compras/ApuntarSoloAjustes.tsx
//
// S01o · Ajustes › Contabilidad › Apuntar solo lo seguro: el interruptor de la
// empresa (company_purchase_setting.post_safe_invoices, D01), que hasta hoy no
// tenía pantalla. Encendido, hace dos cosas, y las dos se dicen aquí:
//   · la tarea programada (a las :07 y las :37) apunta sola, en el servidor, la
//     factura de comisión de una plataforma que esté segura al 100 % (S01o), y
//     la deja en Facturas recibidas › «Apuntadas solas» con su porqué y «Deshacer»;
//   · al abrir una factura aprobada cuya lectura llegó «segura» y cuya propuesta
//     es segura y sin avisos, se valida sola (D01, en la pantalla).
// Guardar confirma o falla en pantalla, con su contenido (regla 8).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaDocumentos } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { fechaLarga } from '@/modules/conta/lib/formato'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { TarjetaCargando } from '@/modules/conta/ui/piezas'
import { guardarApuntarSolo, leerAjusteApuntarSolo } from '@/modules/conta/services/apuntaSoloService'
import { useIsMobile } from '@/shell/useIsMobile'

export function ApuntarSoloAjustes() {
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(accountId && activa ? () => leerAjusteApuntarSolo(accountId, activa.id) : null, `${activa?.id}:${vuelta}:apuntar-solo`)
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const d = datos.datos

  if (!activa) return null
  if (!d && !datos.error) return <TarjetaCargando />

  async function cambiar(encendido: boolean) {
    if (!d || !activa) return
    setOcupado(true); setHecho(null); setFallo(null)
    try {
      await guardarApuntarSolo(activa.id, d, encendido, userName ?? null)
      setHecho(encendido
        ? 'Encendido. En la próxima media hora Sumied apunta solas las facturas de plataforma que tiene seguras; las verás en Facturas recibidas › «Apuntadas solas».'
        : 'Apagado. Sumied ya no apunta nada solo; lo que ya apuntó sigue en «Apuntadas solas», con «Deshacer».')
      setVuelta((v) => v + 1)
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }

  const on = d?.apuntarSolo === true
  return (
    <TarjetaApartado titulo="Apuntar solo lo seguro" movil={movil}>
      <label className="cx-campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" role="switch" checked={on} disabled={ocupado || !d} aria-describedby="apuntar-solo-ayuda" data-prueba="apuntar-solo"
          onChange={(e) => { void cambiar(e.target.checked) }} />
        <span className="cx-etiqueta" style={{ margin: 0 }}>{on ? 'Encendido' : 'Apagado'}</span>
      </label>
      <div className="cx-ayuda" id="apuntar-solo-ayuda" style={{ margin: 0 }}>
        <p style={{ margin: 0 }}>{on ? 'Sumied apunta solo lo que sabe al 100 %:' : 'Si lo enciendes, Sumied apunta solo lo que sabe al 100 %:'}</p>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          <li>las facturas de comisión de las plataformas que van con su liquidación y cuadran, y sus abonos, cada media hora. Las ves en <Link to={rutaDocumentos('solas')}>Facturas recibidas › «Apuntadas solas»</Link>, con su porqué y «Deshacer»;</li>
          <li>la factura aprobada que se leyó segura y cuya propuesta no tiene ningún aviso, al abrirla.</li>
        </ul>
        <p style={{ margin: '4px 0 0' }}>Lo demás se queda en «Por revisar», con una frase de por qué la miras tú.</p>
      </div>
      {d?.quien && d.cuando && <p className="cx-ayuda" style={{ margin: 0 }}>Lo cambió {d.quien} el {fechaLarga(d.cuando.slice(0, 10))}.</p>}
      {datos.error && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer si está encendido: {datos.error}</p>}
      <Resultado hecho={hecho} fallo={fallo} />
    </TarjetaApartado>
  )
}
