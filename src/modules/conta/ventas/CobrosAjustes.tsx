// src/modules/conta/ventas/CobrosAjustes.tsx
//
// PC01 · Entrega 4 · Ajustes › Cobros: los recordatorios que se mandan solos.
//   · si se mandan o están apagados, y qué días respecto al vencimiento (por
//     defecto 3 días antes, el día que vence y a los 7 y 15 días), dicho en
//     palabras mientras se escribe;
//   · los clientes a los que no se les mandan, con «Volver a mandarle» (se
//     apagan desde Ventas › Cobros › Recordatorios);
//   · «Cómo te pagan» (E4, punto 2): tarjeta y Bizum por Stripe (ComoTePagan) y,
//     S01, por el TPV del banco (Redsys), con sus datos para guardar.
// Guardar confirma o falla en pantalla, con la frase de la base (regla 8).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaCobros } from '@/config/navegacion'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Boton, Campo, Selector, Tarjeta, Texto } from '@/modules/conta/diseno'
import { leerDias, textoDias } from '@/modules/conta/lib/cobros'
import { guardarAjustesCobro, leerRecordatorios, recordatoriosCliente } from '@/modules/conta/services/cobrosService'
import { ComoTePagan } from './ComoTePagan'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CobrosAjustes() {
  const { activa } = useEmpresas()
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(activa ? () => leerRecordatorios(activa.id) : null, `${activa?.id}:${vuelta}:ajustes-cobros`)
  const d = datos.datos
  // Lo escrito; null mientras no se toca (se ve lo guardado).
  const [escrito, setEscrito] = useState<{ activos: 'si' | 'no'; dias: string } | null>(null)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const activos = escrito?.activos ?? (d?.activos === false ? 'no' : 'si')
  const dias = escrito?.dias ?? (d?.dias.join(', ') ?? '')
  const setActivos = (v: 'si' | 'no') => setEscrito({ activos: v, dias })
  const setDias = (x: string) => setEscrito({ activos, dias: x })

  const leidos = leerDias(dias)
  const fuera = leidos?.some((x) => x < -30 || x > 90) ?? false
  const problema = !leidos ? 'Escribe los días con números, separados por comas: «-3, 0, 7, 15».'
    : leidos.length > 6 ? 'Como mucho, seis días.'
    : fuera ? 'Cada día, entre 30 antes de vencer (-30) y 90 después.' : null
  const cambiado = d && leidos ? (d.activos !== (activos === 'si') || d.dias.join(',') !== leidos.join(',')) : false

  const guardar = async () => {
    if (!activa || !leidos || problema) return
    setOcupado(true); setAviso(null)
    try { const r = await guardarAjustesCobro(activa.id, activos === 'si', leidos); setAviso({ ok: true, texto: r.frase }); setEscrito(null); setVuelta((v) => v + 1) }
    catch (e) { setAviso({ ok: false, texto: `No se ha guardado: ${msg(e)}` }) }
    finally { setOcupado(false) }
  }
  const encender = async (id: string, nombre: string) => {
    if (!activa) return
    setOcupado(true); setAviso(null)
    try { const r = await recordatoriosCliente(activa.id, id, false); setAviso({ ok: true, texto: r.frase }); setVuelta((v) => v + 1) }
    catch (e) { setAviso({ ok: false, texto: `No se ha cambiado ${nombre}: ${msg(e)}` }) }
    finally { setOcupado(false) }
  }

  if (datos.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer los ajustes de cobro: {datos.error}</p>
  if (!d) return <div className="s-lista" aria-busy="true" aria-label="Cargando los ajustes de cobro"><div className="s-lista-cargando" /></div>

  return (
    <div className="pg-dialogo-campos" data-prueba="ajustes-cobros">
      {activa && <ComoTePagan empresaId={activa.id} editar />}
      <Tarjeta titulo="Recordatorios"
        apoyo="Se mandan solos a las facturas por cobrar que no se cobran por remesa ni por una plataforma, con el nombre de tu empresa y la factura en PDF. Se paran solos cuando cobras."
        accion={<Boton variante="principal" onClick={() => void guardar()} disabled={ocupado || !cambiado || problema !== null}>{ocupado ? 'Guardando…' : 'Guardar'}</Boton>}>
        <div className="pg-dialogo-campos">
          <Campo etiqueta="¿Se mandan?">{(c) => (
            <Selector {...c} valor={activos} alCambiar={(v) => { setActivos(v === 'no' ? 'no' : 'si'); setAviso(null) }}
              opciones={[{ valor: 'si', texto: 'Sí, se mandan solos' }, { valor: 'no', texto: 'No, apagados' }]} />
          )}</Campo>
          <Campo etiqueta="Qué días" ayuda={problema ?? `Respecto al día que vence: negativo, antes. Así: ${leidos ? textoDias(leidos) : ''}.`}>{(c) => (
            <Texto {...c} valor={dias} alCambiar={(x) => { setDias(x); setAviso(null) }} disabled={activos === 'no'} inputMode="text" placeholder="-3, 0, 7, 15" />
          )}</Campo>
          {d.cambiado && <p className="pg-dialogo-nota">Cambiado por {d.cambiado.por ?? 'alguien'} el {d.cambiado.at.slice(8, 10)}/{d.cambiado.at.slice(5, 7)}/{d.cambiado.at.slice(0, 4)}.</p>}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Clientes sin recordatorios"
        apoyo={<>Se apagan desde <Link className="pg-enlace" to={rutaCobros()}>Ventas › Cobros</Link> › Recordatorios.</>}>
        {d.clientesApagados.length === 0
          ? <p className="s-lista-vacia">A todos se les mandan.</p>
          : <ul className="pg-lista-simple">
            {d.clientesApagados.map((c) => (
              <li key={c.id}>
                <strong>{c.nombre}</strong>{c.por ? ` · apagados por ${c.por}` : ''}{' '}
                <button type="button" className="pg-enlace" disabled={ocupado} onClick={() => void encender(c.id, c.nombre)}>Volver a mandarle</button>
              </li>
            ))}
          </ul>}
      </Tarjeta>

      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'seguro' : 'falta'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
    </div>
  )
}
