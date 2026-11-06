// src/modules/conta/gestoria/FichaCliente.tsx
//
// G01 · Tarea 4b · La ficha de un cliente en Clientes y cuotas. Deja HACER,
// no solo mirar (Julio, revisión de las capturas):
//   · lo que no cuadra, arriba, cada cosa con su botón para resolverla:
//     «Añadirla como línea» o «Es una baja: no la cuentes» (lo que cobra
//     GoCardless y no es ninguna línea), «Enlazar con una ficha» (quien está
//     en GoCardless sin ficha en Bitrix24) y «Ya lo he revisado» (con su porqué);
//   · cada servicio con su tarifa: el fijo, en una fila; el que se cobra por
//     trabajador, con cada trabajador y su «Dar de baja» (desde qué mes; ese
//     mes se cobra entero) y «+ Añadir trabajador»; «Cambiar la tarifa de este
//     cliente» abre Tarifas ya rellena;
//   · el total, lo que cobra hoy GoCardless y la diferencia en palabras;
//   · la forma de cobro, el mandato, los 6 últimos cobros y lo que dice Bitrix24.
// Cada cosa se confirma antes diciendo lo que va a pasar, y después dice lo que
// ha hecho con la frase de la base (regla 8); todo queda en el registro.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  FORMA_COBRO, comoResolver, euros, mesesDesde, palabrasDeServicios, textoCobro, textoMandato,
  type ClienteGestoria, type Diferencia, type Ficha,
} from '@/modules/conta/gestoria/vista'
import type { Linea, SuscripcionActiva } from '../../../../supabase/functions/conta-gocardless-leer/comparacion'
import type { Servicio } from '@/modules/conta/services/gestoriaService'

const SITUACION: Record<string, string> = { activo: 'Activo', baja: 'De baja', moroso: 'Moroso', solo_renta: 'Solo la renta' }
const fecha = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const nombreMes = (valor: string, opciones: { valor: string; texto: string }[]) => opciones.find((o) => o.valor === valor)?.texto ?? valor

export interface AccionesFicha {
  altaEmpleado: (empresa: string, cliente: string, servicio: string, empleado: string, desde: string) => Promise<string>
  bajaLinea: (linea: string, mes: string) => Promise<string>
  lineaDesdeGc: (empresa: string, suscripcion: string, servicio: string, empleado: string | null) => Promise<string>
  noContar: (empresa: string, suscripcion: string, motivo: string | null) => Promise<string>
  enlazar: (empresa: string, gcCliente: string, cliente: string) => Promise<string>
  revisada: (diferencia: string, motivo: string) => Promise<string>
}

/** Un paso con su confirmación: el botón lo abre, se rellena, se lee lo que va a pasar y se confirma. */
function Paso({ boton, principal, abierto, alAbrir, alCerrar, aviso, listo, confirmar, ocupado, alConfirmar, children }: {
  boton: string; principal?: boolean; abierto: boolean; alAbrir: () => void; alCerrar: () => void
  /** Lo que va a pasar, en una frase, antes de confirmar. */
  aviso: string; listo: boolean; confirmar: string; ocupado: boolean; alConfirmar: () => void; children?: ReactNode
}) {
  if (!abierto) return <button type="button" className={principal ? 'cxg-boton cxg-boton-principal' : 'cxg-boton'} onClick={alAbrir} disabled={ocupado}>{boton}</button>
  return (
    <div className="cxg-paso" role="group" aria-label={boton}>
      {children}
      <p className="cxg-paso-aviso">{aviso}</p>
      <div className="cxg-paso-botones">
        <button type="button" className="cxg-boton cxg-boton-principal" onClick={alConfirmar} disabled={!listo || ocupado}>{ocupado ? 'Guardando…' : confirmar}</button>
        <button type="button" className="cx-enlace" onClick={alCerrar} disabled={ocupado}>Cancelar</button>
      </div>
    </div>
  )
}

function Etiqueta({ texto, children }: { texto: string; children: ReactNode }) {
  return <label className="cxg-campo"><span>{texto}</span>{children}</label>
}

export function FichaCliente({ fila, ficha, mes, lineas, servicios, sinLinea, clientes, rutaTarifas, acciones, alHecho, alCerrar }: {
  fila: ClienteGestoria
  ficha: Ficha | null
  /** El mes que se mira («2026-11»). */
  mes: string
  /** Las líneas de este cliente con este emisor. */
  lineas: Linea[]
  /** Los servicios de este emisor. */
  servicios: Servicio[]
  /** Lo que cobra GoCardless a este cliente y no es ninguna línea en Sumied. */
  sinLinea: SuscripcionActiva[]
  /** Los clientes de la cuenta, para «Enlazar con una ficha». */
  clientes: { id: string; nombre: string }[]
  rutaTarifas: string | null
  acciones: AccionesFicha
  /** Después de hacer algo: la frase, y se vuelve a leer. */
  alHecho: (frase: string) => void
  alCerrar: () => void
}) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const [v, setV] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const meses = mesesDesde(mes, 13)
  const abrir = (id: string, iniciales: Record<string, string> = {}) => { setAbierto(id); setV(iniciales); setAviso(null) }
  const hacer = async (f: () => Promise<string>) => {
    setOcupado(true); setAviso(null)
    try { const frase = await f(); setAviso({ ok: true, texto: frase }); setAbierto(null); alHecho(frase) }
    catch (e) { setAviso({ ok: false, texto: `No se ha hecho: ${msg(e)}` }) } finally { setOcupado(false) }
  }
  const campo = (id: string) => v[id] ?? ''
  const poner = (id: string) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [id]: e.target.value }))
  const paso = (id: string) => ({ abierto: abierto === id, alCerrar: () => setAbierto(null), ocupado })

  const m = textoMandato(fila.mandato)
  const c = ficha?.comparacion
  const porEmpleado = servicios.filter((s) => s.forma === 'por_empleado')
  const nombreLinea = new Map(lineas.map((l) => [l.id, l.empleado ?? l.detalle ?? l.nombreServicio]))

  const resolver = (d: Diferencia) => comoResolver(d).flatMap((r) => {
    if (r === 'linea_o_baja') return sinLinea.map((s) => {
      const serv = servicios.find((x) => x.id === campo(`serv-${s.id}`))
      return (
        <div key={s.id} className="cxg-sus">
          <p className="cxg-sus-texto">GoCardless cobra <strong>«{s.nombre}»</strong> · {euros(s.alMesCent)} al mes</p>
          <div className="cxg-acciones">
            <Paso boton="Añadirla como línea" principal {...paso(`linea-${s.id}`)} alAbrir={() => abrir(`linea-${s.id}`, { [`serv-${s.id}`]: porEmpleado[0]?.id ?? servicios[0]?.id ?? '' })}
              aviso={`Se añade a ${fila.nombre} una línea de ${serv?.nombre.toLowerCase() ?? '…'}${serv?.forma === 'por_empleado' ? ` de ${campo(`emp-${s.id}`).toUpperCase() || '…'}` : ''} desde este mes, con lo que cobra GoCardless.`}
              listo={!!serv && (serv.forma !== 'por_empleado' || campo(`emp-${s.id}`).trim().length > 1)} confirmar="Añadir la línea"
              alConfirmar={() => void hacer(() => acciones.lineaDesdeGc(fila.emisorId, s.id, serv!.id, serv!.forma === 'por_empleado' ? campo(`emp-${s.id}`) : null))}>
              <Etiqueta texto="Servicio"><select value={campo(`serv-${s.id}`)} onChange={poner(`serv-${s.id}`)}>{servicios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Etiqueta>
              {serv?.forma === 'por_empleado' && <Etiqueta texto="Trabajador"><input value={campo(`emp-${s.id}`)} onChange={poner(`emp-${s.id}`)} placeholder="Nombre y apellidos" /></Etiqueta>}
            </Paso>
            <Paso boton="Es una baja: no la cuentes" {...paso(`baja-${s.id}`)} alAbrir={() => abrir(`baja-${s.id}`)}
              aviso={`Sumied deja de contar «${s.nombre}» (${euros(s.alMesCent)} al mes) al comparar. GoCardless la seguirá cobrando hasta que la canceles allí.`}
              listo confirmar="No contarla" alConfirmar={() => void hacer(() => acciones.noContar(fila.emisorId, s.id, campo('motivo').trim() || null))}>
              <Etiqueta texto="Por qué (queda apuntado)"><input value={campo('motivo')} onChange={poner('motivo')} placeholder="Se fue en octubre…" /></Etiqueta>
            </Paso>
          </div>
        </div>
      )
    })
    if (r === 'enlazar' && d.gcClienteId) {
      const elegido = clientes.find((x) => x.id === campo('cliente'))
      return [
        <Paso key="enlazar" boton="Enlazar con una ficha" principal {...paso(`enlazar-${d.id}`)} alAbrir={() => abrir(`enlazar-${d.id}`)}
          aviso={elegido ? `«${fila.nombre}» de GoCardless será ${elegido.nombre}: sus cobros saldrán en su ficha y la lectura de cada noche lo respetará.` : 'Elige el cliente de Sumied que es.'}
          listo={!!elegido} confirmar="Enlazar" alConfirmar={() => void hacer(() => acciones.enlazar(fila.emisorId, d.gcClienteId!, elegido!.id))}>
          <Etiqueta texto="Es el cliente"><select value={campo('cliente')} onChange={poner('cliente')}>
            <option value="">Elige…</option>{clientes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select></Etiqueta>
        </Paso>,
      ]
    }
    if (r === 'revisada') return [
      <Paso key="revisada" boton="Ya lo he revisado" {...paso(`revisada-${d.id}`)} alAbrir={() => abrir(`revisada-${d.id}`)}
        aviso="Deja de salir mientras siga igual; si cambia, vuelve a salir. Queda apuntado quién y por qué."
        listo={campo('motivo').trim().length > 2} confirmar="Darlo por revisado" alConfirmar={() => void hacer(() => acciones.revisada(d.id, campo('motivo')))}>
        <Etiqueta texto="Por qué está bien así"><input value={campo('motivo')} onChange={poner('motivo')} placeholder="Ha cambiado de banco…" /></Etiqueta>
      </Paso>,
    ]
    return []
  })

  return (
    <div className="cxg-ficha">
      <div className="cxg-ficha-cabeza">
        <div>
          <h2 className="cxg-ficha-titulo">{fila.nombre}</h2>
          <p className="cxg-apoyo">{[fila.nif, fila.emisor, palabrasDeServicios(lineas)].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" className="cx-enlace" onClick={alCerrar}>Cerrar</button>
      </div>

      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'seguro' : 'falta'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}

      {fila.diferencias.length > 0 && (
        <section aria-label="Lo que no cuadra" className="cxg-ficha-difs">
          <h3 className="cxg-ficha-sub">Lo que no cuadra</h3>
          {fila.diferencias.map((d) => (
            <div key={d.id} className="cxg-dif-caja">
              <p className="cxg-dif-texto">{d.porque}</p>
              <div className="cxg-acciones">{resolver(d)}</div>
            </div>
          ))}
        </section>
      )}

      {fila.clienteId && (
        <section aria-label="Servicios y tarifas">
          <h3 className="cxg-ficha-sub">Lo que se le cobra en Sumied</h3>
          {(!ficha || ficha.servicios.length === 0) && <p className="cxg-apoyo">Ninguna línea de alta este mes.</p>}
          {ficha?.servicios.map((s) => (
            <div key={s.servicio} className="cxg-servicio">
              <div className="cxg-servicio-cabeza"><strong>{s.nombre}</strong><span className="cxg-cifra">{s.total}</span></div>
              <p className="cxg-apoyo">{s.porEmpleado ? `Por trabajador: ${s.tarifa}` : s.tarifa}</p>
              {s.filas.length > 0 && (
                <ul className="cxg-servicio-filas">
                  {s.filas.map((x) => (
                    <li key={x.lineaId}>
                      <div className="cxg-servicio-fila">
                        <span>{x.texto}</span>
                        <span className="cxg-servicio-der">
                          <span className="cxg-cifra">{x.importe}</span>
                          {abierto !== `bajal-${x.lineaId}` && <button type="button" className="cx-enlace" disabled={ocupado} onClick={() => abrir(`bajal-${x.lineaId}`, { mes: meses[0].valor })}>Dar de baja</button>}
                        </span>
                      </div>
                      {abierto === `bajal-${x.lineaId}` && (
                        <Paso boton="Dar de baja" {...paso(`bajal-${x.lineaId}`)} alAbrir={() => undefined}
                          aviso={`${nombreLinea.get(x.lineaId)}: ${nombreMes(campo('mes'), meses)} se cobra entero; desde el mes siguiente ya no se cobra.`}
                          listo={!!campo('mes')} confirmar="Dar de baja" alConfirmar={() => void hacer(() => acciones.bajaLinea(x.lineaId, campo('mes')))}>
                          <Etiqueta texto="Último mes que se cobra"><select value={campo('mes')} onChange={poner('mes')}>{meses.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select></Etiqueta>
                        </Paso>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div className="cxg-acciones">
            {porEmpleado.map((s) => (
              <Paso key={s.id} boton={porEmpleado.length > 1 ? `+ Añadir trabajador · ${s.nombre}` : '+ Añadir trabajador'} principal {...paso(`alta-${s.id}`)}
                alAbrir={() => abrir(`alta-${s.id}`, { desde: meses[0].valor })}
                aviso={`Alta de ${campo('emp').trim().toUpperCase() || '…'} en ${s.nombre.toLowerCase()} de ${fila.nombre} desde ${nombreMes(campo('desde'), meses)}, con su tarifa.`}
                listo={campo('emp').trim().length > 1 && !!campo('desde')} confirmar="Dar de alta"
                alConfirmar={() => void hacer(() => acciones.altaEmpleado(fila.emisorId, fila.clienteId!, s.id, campo('emp'), campo('desde')))}>
                <Etiqueta texto="Trabajador"><input value={campo('emp')} onChange={poner('emp')} placeholder="Nombre y apellidos" /></Etiqueta>
                <Etiqueta texto="Desde"><select value={campo('desde')} onChange={poner('desde')}>{meses.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select></Etiqueta>
              </Paso>
            ))}
            {rutaTarifas && <Link to={rutaTarifas} className="cxg-boton">Cambiar la tarifa de este cliente</Link>}
          </div>
          {c && (
            <dl className="cxg-totales">
              <div><dt>Total al mes en Sumied</dt><dd className="cxg-cifra">{euros(c.sumiedCent)}</dd></div>
              <div><dt>Lo que cobra hoy GoCardless</dt><dd className={c.diferenciaCent ? 'cxg-cifra cxg-distinto' : 'cxg-cifra'}>{euros(c.gocardlessCent)}</dd></div>
            </dl>
          )}
          {/* Si arriba ya sale «Sumied y GoCardless no dan el mismo total» (con su botón), aquí no se repite. */}
          {ficha && !fila.diferencias.some((d) => d.tipo === 'totales_distintos') && (
            <div className="cxg-explica" data-tono={c?.diferenciaCent ? 'ambar' : 'verde'}>{ficha.diferencia.map((t, i) => <p key={i}>{t}</p>)}</div>
          )}
        </section>
      )}

      <section aria-label="Cobro">
        <h3 className="cxg-ficha-sub">Cómo se le cobra</h3>
        <dl className="cxg-datos">
          <div><dt>Forma de cobro</dt><dd>{fila.formaCobro ? FORMA_COBRO[fila.formaCobro] : 'Sin decir'}</dd></div>
          <div><dt>Mandato</dt><dd><span className="cxg-estado" data-tono={m.tono}>{m.texto}</span></dd></div>
        </dl>
        <h3 className="cxg-ficha-sub">Últimos cobros</h3>
        {fila.cobros.length === 0 ? <p className="cxg-apoyo">Ningún cobro de GoCardless en los últimos 6 meses.</p> : (
          <ul className="cxg-cobros">
            {fila.cobros.map((x, i) => {
              const t = textoCobro(x.estado)
              return (
                <li key={i}>
                  <span>{fecha(x.fecha)}</span>
                  <span className="cxg-cifra">{euros(x.importeCent)}</span>
                  <span className="cxg-cobro"><span className="cxg-punto" data-tono={t.tono} aria-hidden="true" />{t.texto}{x.motivo ? ` · ${x.motivo}` : ''}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Lo que dice Bitrix24">
        <h3 className="cxg-ficha-sub">Lo que dice Bitrix24</h3>
        {!fila.bitrix ? <p className="cxg-apoyo">No tiene ficha en Bitrix24.</p> : (
          <dl className="cxg-datos">
            <div><dt>Situación</dt><dd>{fila.bitrix.situacion ? SITUACION[fila.bitrix.situacion] ?? fila.bitrix.situacion : '—'}</dd></div>
            <div><dt>Forma de pago</dt><dd>{fila.bitrix.formaPago ?? '—'}</dd></div>
            <div><dt>Servicios</dt><dd>{fila.bitrix.servicios.length ? fila.bitrix.servicios.join(', ') : '—'}</dd></div>
          </dl>
        )}
        <p className="cxg-apoyo">De referencia: Sumied no cambia la ficha de Bitrix24.</p>
      </section>
    </div>
  )
}
