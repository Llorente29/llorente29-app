// src/modules/conta/gestoria/g04/Asignar.tsx
//
// G04 · Tarea 4 · «Asignar a un cliente», desde la tarjeta «Cobros de
// GoCardless sin cliente» de Clientes (Julio, 08/11): cada cliente de
// GoCardless con suscripciones activas que aún no está unido a su cliente en
// Sumied, con lo que cobra al mes y el cliente más probable (por NIF, email o
// nombre). La pantalla PROPONE; une una persona, cliente a cliente, y la
// confirmación dice a quién se ha unido (regla 8). Nada se escribe en
// GoCardless: solo se guarda en Sumied a qué cliente corresponde.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ClienteParaCasar } from '../../../../../supabase/functions/_shared/tarifa/lista'
import { euros } from '../../../../../supabase/functions/_shared/tarifa/precio'
import { textoDeMandatos, textoDePropuesta, textoDeQbo, type ApuntadoParaQbo, type PorAsignar } from './asignar'

export interface PropsAsignar {
  lista: PorAsignar[]
  clientes: ClienteParaCasar[]
  /** Con «Las dos», se dice de qué empresa es cada uno. */
  lasDos: boolean
  rutaVolver: string
  alUnir: (empresaId: string, gcClienteId: string, clienteId: string) => Promise<string>
  /** Q08 · «Es esta», que guarda quién lo confirmó (conta_gc_enlace_confirmar): R19, para todos (así queda ATADO). Sin él, se une con alUnir. */
  alConfirmar?: (empresaId: string, gcClienteId: string, clienteId: string) => Promise<string>
  /** R19 · «No tiene ficha: apuntar para QBO» (conta_gc_enlace_sin_ficha). Sin él, no sale. */
  alSinFicha?: (empresaId: string, gcClienteId: string) => Promise<string>
  /** R19 · Los ya apuntados para QBO, con su Excel. */
  apuntados?: ApuntadoParaQbo[]
  alBajarApuntados?: () => void
  /** R19 · «diciembre»: el mes que se cuenta (la forma de contar de la copia). */
  mes?: string
}

type Aviso = { ok: boolean; texto: string } | null

export function Asignar(p: PropsAsignar) {
  const [aviso, setAviso] = useState<Aviso>(null)
  const total = p.lista.reduce((s, x) => s + x.alMesCent, 0)
  const nSusc = p.lista.reduce((s, x) => s + x.suscripciones.length, 0)
  const cuando = p.mes ? `en ${p.mes}` : 'al mes'
  const nombreDe = (id: string) => p.clientes.find((c) => c.id === id)?.nombre ?? 'Cliente'
  return (
    <div className="g4" data-pantalla="asignar-g04">
      <header className="g4-cabecera">
        <div className="g4-cabecera-textos">
          <Link className="g4-enlace" to={p.rutaVolver}>← Clientes</Link>
          <h1 className="g4-titulo">Cobros de GoCardless sin cliente</h1>
          <div className="g4-tf-subtitulo">
            {p.lista.length
              ? `${nSusc} ${nSusc === 1 ? 'suscripción' : 'suscripciones'} de ${p.lista.length} ${p.lista.length === 1 ? 'cliente' : 'clientes'} de GoCardless: ${euros(total)} ${cuando}, sin atar a su ficha. Sumied propone la más probable; tú confirmas. En GoCardless no cambia nada.`
              : 'Todos los cobros de GoCardless están atados a su ficha en Sumied.'}
          </div>
        </div>
      </header>
      {aviso && <p className="g4-hecho" data-ok={aviso.ok ? '' : undefined} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
      <div className="g4-as-lista">
        {p.lista.map((x) => <Uno key={`${x.empresaId}|${x.gcClienteId}`} x={x} {...p} nombreDe={nombreDe} setAviso={setAviso} />)}
      </div>
      {p.apuntados && p.apuntados.length > 0 && (
        <section className="g4-as-apuntados" aria-label="Apuntados para QBO" data-prueba="apuntados-qbo">
          <div className="g4-as-cabeza">
            <h2 className="g4-as-nombre">Apuntados para QBO · sin ficha en Bitrix24 ({p.apuntados.length})</h2>
            {p.alBajarApuntados && <button type="button" className="g4-boton" onClick={p.alBajarApuntados}>Bajar la lista para QBO</button>}
          </div>
          <div className="g4-pequeno">QBO tiene que crear su ficha en Bitrix24. Hasta entonces, sus cobros no salen en ninguna ficha de Sumied.</div>
          <ul className="g4-as-lista-apuntados">
            {p.apuntados.map((a) => <li key={`${a.empresaId}|${a.gcClienteId}`}><b>{a.nombre}</b> · {euros(a.alMesCent)} {cuando}{[p.lasDos ? a.empresa : null, a.correo, a.quien ? `lo apuntó ${a.quien}` : null].filter(Boolean).map((t) => ` · ${t}`).join('')}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

function Uno({ x, clientes, lasDos, alUnir, alConfirmar, alSinFicha, nombreDe, setAviso }: PropsAsignar & { x: PorAsignar; nombreDe: (id: string) => string; setAviso: (a: Aviso) => void }) {
  // Q08: si QBO escribió un nombre, manda su propuesta (si es una sola ficha, ya elegida; nunca se une sola).
  const deQbo = x.deQbo
  const inicial = deQbo ? (deQbo.clienteIds.length === 1 ? deQbo.clienteIds[0] : null) : x.propuesta.tipo === 'una' ? x.propuesta.clienteId : null
  const [elegido, setElegido] = useState<string | null>(inicial)
  const [busca, setBusca] = useState('')
  const [enCurso, setEnCurso] = useState(false)
  const posibles = deQbo ? (deQbo.clienteIds.length > 1 ? deQbo.clienteIds : []) : x.propuesta.tipo === 'varias' ? x.propuesta.clienteIds : []
  const unir = alConfirmar ?? alUnir
  const mandatos = x.correoRepetido ? textoDeMandatos(x.mandatos) : null
  const q = busca.trim().toLowerCase()
  const sugeridos = q.length >= 2 ? clientes.filter((c) => `${c.nombre} ${c.nif ?? ''} ${c.correos.join(' ')}`.toLowerCase().includes(q)).slice(0, 8) : []
  return (
    <section className="g4-as-uno" aria-label={x.nombre}>
      <div className="g4-as-cabeza">
        <div>
          <div className="g4-as-nombre">{x.nombre}</div>
          <div className="g4-pequeno">{[lasDos ? x.empresa : null, x.nif ? `NIF ${x.nif}` : null, x.correo].filter(Boolean).join(' · ') || 'Sin NIF ni email en GoCardless'}</div>
        </div>
        <div className="g4-as-importe"><b>{euros(x.alMesCent)}</b> <span className="g4-pequeno">este mes</span></div>
      </div>
      <div className="g4-pequeno">{x.suscripciones.map((s) => `${s.nombre} · ${euros(s.alMesCent)}`).join(' · ')}</div>
      {mandatos && <div className="g4-pequeno" data-prueba="mandato">{mandatos} · el correo lo tienen otros: mira el banco antes de unir.</div>}
      {deQbo
        ? <div className="g4-as-propuesta" data-hay={deQbo.clienteIds.length ? '' : undefined} data-qbo={deQbo.como}>{textoDeQbo(deQbo, nombreDe)}</div>
        : <div className="g4-as-propuesta" data-hay={x.propuesta.tipo !== 'ninguna' ? '' : undefined}>{x.propuestoPorSumied ? 'Propuesta de Sumied · ' : ''}{textoDePropuesta(x.propuesta, nombreDe)}</div>}
      {posibles.length > 0 && (
        <div role="radiogroup" aria-label="Posibles" className="g4-tf-chips">
          {posibles.map((id) => <button key={id} type="button" role="radio" aria-checked={elegido === id} className="g4-tf-chip" onClick={() => setElegido(id)}>{nombreDe(id)}</button>)}
        </div>
      )}
      <div className="g4-as-elegir">
        <input aria-label={`Buscar otro cliente para ${x.nombre}`} placeholder={elegido ? 'O busca otro cliente por nombre, NIF o email' : 'Busca el cliente por nombre, NIF o email'} value={busca} onChange={(e) => setBusca(e.target.value)} />
        {sugeridos.length > 0 && (
          <div className="g4-tf-sugeridos">
            {sugeridos.map((c) => <button key={c.id} type="button" className="g4-tf-sugerido" onClick={() => { setElegido(c.id); setBusca('') }}>{c.nombre}{c.nif ? ` · ${c.nif}` : ''}</button>)}
          </div>
        )}
        {q.length >= 2 && !sugeridos.length && <div className="g4-pequeno">Ningún cliente con «{busca.trim()}».</div>}
      </div>
      <div className="g4-tf-botones">
        <button type="button" className="g4-boton" data-tipo="primario" disabled={!elegido || enCurso} onClick={async () => {
          setEnCurso(true)
          try { setAviso({ ok: true, texto: await unir(x.empresaId, x.gcClienteId, elegido!) }) } catch (e) { setAviso({ ok: false, texto: e instanceof Error ? e.message : String(e) }) }
          setEnCurso(false)
        }}>{elegido ? (deQbo ? `Es esta: unir a ${nombreDe(elegido)}` : `Unir a ${nombreDe(elegido)}`) : 'Elige un cliente'}</button>
        {alSinFicha && <button type="button" className="g4-boton" disabled={enCurso} onClick={async () => {
          setEnCurso(true)
          try { setAviso({ ok: true, texto: await alSinFicha(x.empresaId, x.gcClienteId) }) } catch (e) { setAviso({ ok: false, texto: e instanceof Error ? e.message : String(e) }) }
          setEnCurso(false)
        }}>No tiene ficha: apuntar para QBO</button>}
      </div>
    </section>
  )
}
