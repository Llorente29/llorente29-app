// src/modules/conta/bancos/HechoPorFolvy.tsx
//
// B01 · «Lo que ha hecho Folvy» (sin maqueta, en el estilo de N17): todo lo
// que Folvy hizo solo en el mes, con su porqué literal y «Deshacer» mientras
// siga vivo. Con «Y lo de las personas», el registro entero del mes (quién
// confirmó, quién deshizo, qué ticket se subió). Es el registro de
// bank_activity_log, sin resumir: lo que se enseña es lo que se escribió.

import { useState } from 'react'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { fechaLarga } from '@/modules/conta/lib/formato'
import { useLeer } from '@/modules/conta/libros/contexto'
import { nombreMes } from '@/modules/conta/lib/bancosVista'
import { bancos as nucleo } from '@/modules/conta/services/bancosService'
import { leerHechos } from '@/modules/conta/services/bancosPantallas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { useBancos } from '@/modules/conta/bancos/contexto'

const ACCION: Record<string, string> = {
  importado: 'Extracto subido', casado: 'Casado', enlazado: 'Enlazado', propuesto: 'Propuesto', por_aclarar: 'Por aclarar',
  validado: 'Validado', deshecho: 'Deshecho', ignorado: 'Apartado', regla: 'Regla',
  cierre: 'Cierre del mes', reabierto: 'Mes reabierto', agente: 'Pasada del agente',
}
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })

export function HechoPorFolvy() {
  const { accountId, companyId, mes, vuelta, recargar } = useBancos()
  const [todo, setTodo] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const hechos = useLeer(() => leerHechos(accountId, companyId, mes), `${companyId}:${mes}:${vuelta}`)

  if (hechos.error) return <ErrorConReintento mensaje={hechos.error} reintentar={hechos.recargar} />
  if (!hechos.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando lo que ha hecho Folvy">{[0, 1, 2].map((i) => <Hueso key={i} alto={44} />)}</div>
  const deFolvy = hechos.datos.filter((h) => h.porQuien === 'folvy')
  const vistos = todo ? hechos.datos : deFolvy
  const casados = deFolvy.filter((h) => h.accion === 'casado')

  return (
    <section className="cxb-seccion" aria-labelledby="cxb-hecho-titulo">
      <div className="cxl-seccion">
        <div><h2 id="cxb-hecho-titulo">Lo que ha hecho Folvy</h2><p className="cx-ayuda">En {nombreMes(mes).toLowerCase()}, con el porqué de cada cosa.</p></div>
        <div className="cxl-segmento" role="group" aria-label="Qué ver">
          <button type="button" aria-pressed={!todo} onClick={() => setTodo(false)}>Solo Folvy · {deFolvy.length}</button>
          <button type="button" aria-pressed={todo} onClick={() => setTodo(true)}>Y lo de las personas · {hechos.datos.length}</button>
        </div>
      </div>
      <div className="cxb-banda" role="note">
        <span className="cx-ia-punto" aria-hidden="true" />
        <div className="cxb-banda-texto">
          <strong>{casados.length ? `He casado yo ${casados.length} ${casados.length === 1 ? 'movimiento' : 'movimientos'} este mes, ${casados.filter((h) => h.casadoVivo).length} siguen como los dejé.` : 'Este mes no he casado nada solo.'}</strong>
          <span>Deshacer quita el asiento si aún está propuesto, o lo anula con contraasiento si ya está validado. Nunca se borra nada del libro.</span>
        </div>
      </div>
      {aviso && <div className={aviso.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>{aviso.texto}</div>}
      <div className="cx-tarjeta cxb-lista">
        {vistos.length === 0 && <p className="cx-ayuda">Nada en {nombreMes(mes).toLowerCase()}.</p>}
        {vistos.map((h) => (
          <div key={h.id} className="cxb-lista-fila">
            <span className="cxb-lista-texto">
              <strong>{h.resumen}</strong>
              <span className="cx-ayuda">{fechaLarga(h.fecha)} {hora(h.fecha)} · {ACCION[h.accion] ?? h.accion} · {h.porQuien === 'folvy' ? 'Folvy' : h.quien ?? 'una persona'}{h.accion === 'casado' && !h.casadoVivo ? ' · ya deshecho' : ''}</span>
            </span>
            {h.accion === 'casado' && h.casadoVivo && h.casadoId && (
              <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={async () => {
                setOcupado(h.id); setAviso(null)
                try {
                  await nucleo.deshacer(h.casadoId!, 'Deshecho desde «Lo que ha hecho Folvy»')
                  setAviso({ tipo: 'ok', texto: `Deshecho: «${h.resumen}». El movimiento vuelve a estar sin casar.` })
                  refrescarCuentasMenu(); recargar(); hechos.recargar()
                } catch (e) { setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }) } finally { setOcupado(null) }
              }}>{ocupado === h.id ? 'Deshaciendo…' : 'Deshacer'}</button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
