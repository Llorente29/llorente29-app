// src/modules/conta/gestoria/g05/Cobro.tsx
//
// G05 · Tarea 4 · «REVISAR EL COBRO», fiel a la maqueta aprobada por Julio
// (Cobro.dc.html, nº 29): los cuatro pasos, la cabecera con los recibos y el
// total frente al mes anterior, «Con cambios» uno a uno (con «Lo he mirado,
// aprobar» si cambia más de un 30 %), «Igual que …» de una vez, «No entran en
// este cobro», la barra de «Enviar el cobro» con lo que falta y el aviso antes
// de enviar; y, ya enviado, «Cómo va cada recibo» con sus cuatro cifras.
// Solo pinta: recibe el modelo (modeloCobro.ts) y lo que hacer al pulsar.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { nombreDelMes, mesAnterior } from '../../../../../supabase/functions/_shared/cobro/recibo'
import { botonDeAprobar, type ReciboEnRevision } from '../../../../../supabase/functions/_shared/cobro/revision'
import { euros } from '../../../../../supabase/functions/_shared/tarifa/precio'
import type { ModeloCobro } from './modeloCobro'

export interface PropsCobro {
  modelo: ModeloCobro
  empresa: string
  rutaVolver: string
  rutaFicha: (clienteId: string) => string
  /** «Ponerle la cuota»: a la ficha, con «+ Añadir» abierto. */
  rutaPonerCuota: (clienteId: string) => string
  /** Cada acción devuelve su frase (regla 8: confirma con contenido o falla en pantalla). */
  alPreparar: () => Promise<string>
  alDecidir: (reciboId: string, decision: 'pendiente' | 'aprobado' | 'este_mes_no') => Promise<string>
  alAprobarIguales: () => Promise<string>
  /** nº 46 · «Volver a cobrar» un recibo que paró su cliente desde el portal. */
  alReanudar?: (reciboId: string) => Promise<string>
  alEnviar: () => Promise<string>
}

const PASOS: [string, string][] = [['Revisar', 'Lo que cambia'], ['Enviar el cobro', 'Aviso el día 2'], ['Cobrado', 'Cargo el día 4'], ['Facturado', 'Sale solo']]
const idDe = (x: ReciboEnRevision) => x.recibo.clave
/** nº 46 · El principio de la marca de un recibo que paró su cliente (conta_recibo_parar, 1500). */
export const MARCA_CLIENTE = 'El cliente no está de acuerdo'
const antes = (x: ReciboEnRevision) => (x.recibo.anteriorCent ? euros(x.recibo.anteriorCent) : 'nuevo')
const porque = (x: ReciboEnRevision) => x.recibo.cambios.map((c) => c.texto).join(' ')

export function Cobro(p: PropsCobro) {
  const { modelo: m } = p
  const r = m.revision
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [frase, setFrase] = useState<{ texto: string; mal: boolean } | null>(null)
  const [verIguales, setVerIguales] = useState(false)
  const [avisoAbierto, setAvisoAbierto] = useState(false)

  const hacer = async (que: string, fn: () => Promise<string>) => {
    setOcupado(que); setFrase(null)
    try { setFrase({ texto: await fn(), mal: false }) } catch (e) { setFrase({ texto: e instanceof Error ? e.message : String(e), mal: true }) } finally { setOcupado(null) }
  }
  const mesPasado = nombreDelMes(mesAnterior(m.mes))
  const igualesAprobados = m.igualesAprobados
  const pasosHechos = m.enviado ? m.pasosHechos : 0

  return (
    <div className="g4 g5" data-pantalla="cobro-g05">
      <Link className="g4-enlace" to={p.rutaVolver}>← Clientes y cuotas</Link>
      <header className="g4-cabecera">
        <div className="g4-cabecera-textos">
          <div className="g4-antetitulo">{p.empresa} · se cobra desde su cuenta de GoCardless</div>
          <h1 className="g4-titulo">{m.enviado ? `El cobro de ${nombreDelMes(m.mes)}` : 'Revisar el cobro'}</h1>
        </div>
      </header>

      <ol className="g5-pasos" aria-label="Los pasos del cobro">
        {PASOS.map(([t, d], i) => {
          const hecho = i < pasosHechos; const ahora = i === pasosHechos
          return (
            <li key={t} className="g5-paso" data-estado={hecho ? 'hecho' : ahora ? 'ahora' : 'luego'} aria-current={ahora ? 'step' : undefined}>
              <span className="g5-paso-bola">{hecho ? '✓' : i + 1}</span>
              <span className="g5-paso-textos"><span className="g5-paso-t">{t}</span><span className="g5-paso-d">{d}</span></span>
            </li>
          )
        })}
      </ol>

      {frase && <p role={frase.mal ? 'alert' : 'status'} className="g5-frase" data-tono={frase.mal ? 'mal' : 'bien'}>{frase.texto}</p>}
      {m.soloPruebas && <p className="g5-frase" data-tono="aviso">Esta empresa tiene conectada su cuenta real de GoCardless: por ahora el cobro solo se envía con una cuenta de pruebas. Con la real no se cobra nada.</p>}

      {m.vacio ? (
        <section className="g4-bloque" aria-label="Preparar el cobro">
          <h2 className="g4-bloque-titulo">El cobro de {nombreDelMes(m.mes)} aún no está preparado</h2>
          <p className="g5-apoyo">Sumied calcula el recibo de cada cliente con su tarifa y lo compara con {mesPasado}. Nada se cobra hasta que lo revises y pulses «Enviar el cobro».</p>
          <button type="button" className="g4-boton" data-tipo="primario" disabled={!!ocupado} onClick={() => hacer('preparar', p.alPreparar)}>{ocupado === 'preparar' ? 'Preparando…' : 'Preparar el cobro'}</button>
        </section>
      ) : !m.enviado ? (
        <>
          <section className="g4-banda" aria-labelledby="g5-cabeza">
            <div className="g4-banda-textos">
              <div className="g4-banda-ante">{m.antetitulo}</div>
              <h2 id="g5-cabeza" className="g4-banda-cifra">{r.titulo.split(' · ').slice(0, 2).join(' · ')}</h2>
              {r.frente && <div className="g4-banda-linea">{r.frente}</div>}
            </div>
            <div className="g5-grupos">
              <div><span className="g5-grupo-t">Igual que {mesPasado}</span><span className="g5-grupo-n">{r.igual.length}</span></div>
              <div><span className="g5-grupo-t">Con cambios</span><span className="g5-grupo-n">{r.conCambios.length}</span></div>
              <div><span className="g5-grupo-t">No entran</span><span className="g5-grupo-n">{r.noEntran.length}</span></div>
            </div>
            <button type="button" className="g4-banda-boton" disabled={!!ocupado} onClick={() => hacer('preparar', p.alPreparar)}>{ocupado === 'preparar' ? 'Recalculando…' : 'Volver a calcular'}</button>
          </section>

          <section className="g4-bloque" aria-labelledby="g5-cambios">
            <div className="g4-bloque-cabecera">
              <h2 id="g5-cambios" className="g4-bloque-titulo">Con cambios · revísalos uno a uno</h2>
              <span className="g5-estado" data-tono={r.porRevisar.n ? 'aviso' : 'bien'}>
                {r.porRevisar.n ? `${r.porRevisar.n} por revisar${r.porRevisar.fuertes ? ` · ${r.porRevisar.fuertes} cambia más de un 30 %` : ''}` : '✓ Todos revisados'}
              </span>
            </div>
            <p className="g5-apoyo">Cada cambio dice por qué. Si el importe sube o baja más de un 30 %, hay que mirarlo antes de aprobar.</p>
            {r.conCambios.length === 0 && <p className="g4-nada">Ningún recibo cambia este mes.</p>}
            <ul className="g5-lista">
              {[...r.conCambios, ...m.fueraDeEsteCobro].map((x) => {
                const id = m.idDe[idDe(x)]; const pendiente = x.decision === 'pendiente'
                return (
                  <li key={idDe(x)} className="g5-cambio" data-fuerte={pendiente && x.recibo.pideClic ? 'si' : undefined}>
                    <div className="g5-cambio-textos">
                      <div className="g5-cambio-cabeza">
                        <Link to={p.rutaFicha(x.recibo.clienteId)} className="g5-cambio-nombre">{x.cliente}</Link>
                        {x.recibo.pideClic && <span className="g5-etiqueta" data-tono="aviso">{x.recibo.pideClic}</span>}
                      </div>
                      <div className="g5-cambio-porque">{porque(x)}</div>
                    </div>
                    <div className="g5-cambio-importe"><span className="g5-antes">{antes(x)}</span><span aria-hidden="true">→</span><b>{euros(x.recibo.totalCent)}</b></div>
                    <div className="g5-cambio-acciones">
                      {pendiente ? (
                        <>
                          <button type="button" className="g4-boton" disabled={!!ocupado} onClick={() => hacer(id, () => p.alDecidir(id, 'este_mes_no'))}>Este mes no</button>
                          <button type="button" className="g4-boton" data-tipo="primario" disabled={!!ocupado} onClick={() => hacer(id, () => p.alDecidir(id, 'aprobado'))}>{botonDeAprobar(x)}</button>
                        </>
                      ) : (
                        <>
                          <span className="g5-hecho" data-tono={x.decision === 'aprobado' ? 'bien' : 'aviso'}>{x.decision === 'aprobado' ? '✓ Aprobado' : 'Fuera de este cobro'}</span>
                          <button type="button" className="g4-enlace" disabled={!!ocupado} onClick={() => hacer(id, () => p.alDecidir(id, 'pendiente'))}>Deshacer</button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          {r.igual.length > 0 && (
            <section className="g4-bloque" aria-labelledby="g5-iguales">
              <div className="g4-bloque-cabecera">
                <h2 id="g5-iguales" className="g4-bloque-titulo">Igual que {mesPasado} · {r.igual.length} {r.igual.length === 1 ? 'recibo' : 'recibos'} · {euros(r.igual.reduce((s, x) => s + x.recibo.totalCent, 0))}</h2>
                <div className="g4-cabecera-acciones">
                  <button type="button" className="g4-enlace" onClick={() => setVerIguales(!verIguales)} aria-expanded={verIguales}>{verIguales ? 'Ocultar la lista' : 'Ver la lista'}</button>
                  {igualesAprobados
                    ? <span className="g5-hecho" data-tono="bien">✓ Aprobados</span>
                    : <button type="button" className="g4-boton" data-tipo="primario" disabled={!!ocupado} onClick={() => hacer('iguales', p.alAprobarIguales)}>{r.igual.length === 1 ? 'Aprobar el que no cambia' : `Aprobar los ${r.igual.length}`}</button>}
                </div>
              </div>
              <p className="g5-apoyo">Mismo cliente, mismos servicios, mismo importe. Se aprueban de una vez.</p>
              {verIguales && (
                <ul className="g5-iguales">
                  {r.igual.map((x) => <li key={idDe(x)}><Link to={p.rutaFicha(x.recibo.clienteId)}>{x.cliente}</Link><span>{euros(x.recibo.totalCent)}</span></li>)}
                </ul>
              )}
            </section>
          )}

          {r.noEntran.length > 0 && (
            <section className="g4-bloque" aria-labelledby="g5-fuera">
              <h2 id="g5-fuera" className="g4-bloque-titulo">No entran en este cobro · {r.noEntran.length}</h2>
              <p className="g5-apoyo">Sumied los deja fuera solo. No hay que hacer nada para que no se cobren.</p>
              <ul className="g5-lista">
                {r.noEntran.map((z, i) => (
                  <li key={`${z.cliente}-${i}`} className="g5-fuera">
                    <div className="g5-cambio-textos"><span className="g5-cambio-nombre">{z.cliente}</span><span className="g5-cambio-porque">{z.porque}</span></div>
                    {(() => {
                      // nº 46 · Lo paró el cliente desde el portal: la gestoría lo revisa y lo devuelve al cobro.
                      const id = z.recibo ? m.idDe[z.recibo.recibo.clave] : undefined
                      if (p.alReanudar && id && z.recibo?.recibo.parado.some((x) => x.startsWith(MARCA_CLIENTE))) {
                        const alReanudar = p.alReanudar
                        return <button type="button" className="g4-boton" disabled={!!ocupado} onClick={() => hacer(id, () => alReanudar(id))}>Volver a cobrar</button>
                      }
                      const cliente = z.recibo?.recibo.clienteId ?? (z as { cliente_id?: string }).cliente_id ?? null
                      if (!z.boton || !cliente) return null
                      return <Link className="g4-boton" to={z.boton === 'Ponerle la cuota' ? p.rutaPonerCuota(cliente) : p.rutaFicha(cliente)}>{z.boton}</Link>
                    })()}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="g5-barra" aria-label="Enviar el cobro">
            <div className="g5-barra-textos"><b>{r.listos.texto}</b><span>{r.falta}</span></div>
            <button type="button" className="g5-enviar" disabled={!r.puedeEnviar || !!ocupado || m.soloPruebas} onClick={() => setAvisoAbierto(true)}>Enviar el cobro</button>
          </section>

          {avisoAbierto && m.aviso && (
            <div className="g5-velo" role="presentation" onClick={() => setAvisoAbierto(false)}>
              <div className="g5-aviso" role="dialog" aria-modal="true" aria-labelledby="g5-aviso-t" onClick={(e) => e.stopPropagation()}>
                <h2 id="g5-aviso-t" className="g4-bloque-titulo">{m.aviso.titulo}</h2>
                <dl className="g5-aviso-datos">
                  <div><dt>Se cobra a</dt><dd>{m.aviso.seCobraA}</dd></div>
                  <div><dt>En total</dt><dd>{m.aviso.enTotal}</dd></div>
                  <div><dt>Desde</dt><dd>{m.aviso.desde}</dd></div>
                  <div><dt>Aviso al cliente</dt><dd>{m.aviso.avisoAlCliente}</dd></div>
                  <div><dt>Cargo en su cuenta</dt><dd>{m.aviso.cargo}</dd></div>
                </dl>
                <p className="g5-apoyo">{m.aviso.nota}</p>
                <div className="g4-cabecera-acciones">
                  <button type="button" className="g4-boton" onClick={() => setAvisoAbierto(false)}>Volver a revisar</button>
                  <button type="button" className="g4-boton" data-tipo="primario" disabled={!!ocupado}
                    onClick={async () => { await hacer('enviar', p.alEnviar); setAvisoAbierto(false) }}>{ocupado === 'enviar' ? 'Enviando…' : `Sí, enviar ${m.aviso.enTotal}`}</button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <section className="g4-banda" aria-labelledby="g5-enviado">
            <div className="g4-banda-textos">
              <div className="g4-banda-ante">{m.enviadoTexto ?? m.antetitulo}</div>
              <h2 id="g5-enviado" className="g4-banda-cifra">{m.cifras[0].valor} cobrados de {m.seguimiento.length}</h2>
              <div className="g4-banda-linea">Cada cobro confirmado sale facturado solo, con Verifactu, y se envía al cliente por correo.</div>
            </div>
            <div className="g5-cifras-oscuras">
              {m.cifras.map((c) => <div key={c.titulo} data-tono={c.tono}><span className="g5-grupo-t">{c.titulo}</span><span className="g5-grupo-n">{c.valor}</span><span className="g5-grupo-d">{c.detalle}</span></div>)}
            </div>
          </section>
          <section className="g4-bloque" aria-labelledby="g5-seguimiento">
            <div className="g4-bloque-cabecera">
              <h2 id="g5-seguimiento" className="g4-bloque-titulo">Cómo va cada recibo</h2>
              <span className="g4-pequeno">Se actualiza solo en cuanto GoCardless avisa</span>
            </div>
            <div className="g5-tabla-caja">
              <table className="g5-tabla">
                <thead><tr><th scope="col">Cliente</th><th scope="col" className="g5-num">Importe</th><th scope="col">Cobro</th><th scope="col">Factura</th></tr></thead>
                <tbody>
                  {m.seguimiento.map((s) => (
                    <tr key={s.id}>
                      <td>{s.cliente}</td>
                      <td className="g5-num">{s.importe}</td>
                      <td><span className="g5-etiqueta" data-tono={s.tono}>{s.estado}</span> <span className="g5-detalle">{s.detalle}</span></td>
                      <td>{s.factura}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
