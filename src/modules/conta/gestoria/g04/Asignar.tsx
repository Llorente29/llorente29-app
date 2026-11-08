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
import { textoDePropuesta, type PorAsignar } from './asignar'

export interface PropsAsignar {
  lista: PorAsignar[]
  clientes: ClienteParaCasar[]
  /** Con «Las dos», se dice de qué empresa es cada uno. */
  lasDos: boolean
  rutaVolver: string
  alUnir: (empresaId: string, gcClienteId: string, clienteId: string) => Promise<string>
}

type Aviso = { ok: boolean; texto: string } | null

export function Asignar(p: PropsAsignar) {
  const [aviso, setAviso] = useState<Aviso>(null)
  const total = p.lista.reduce((s, x) => s + x.alMesCent, 0)
  const nombreDe = (id: string) => p.clientes.find((c) => c.id === id)?.nombre ?? 'Cliente'
  return (
    <div className="g4" data-pantalla="asignar-g04">
      <header className="g4-cabecera">
        <div className="g4-cabecera-textos">
          <Link className="g4-enlace" to={p.rutaVolver}>← Clientes</Link>
          <h1 className="g4-titulo">Cobros de GoCardless sin cliente</h1>
          <div className="g4-tf-subtitulo">
            {p.lista.length
              ? `${p.lista.length} ${p.lista.length === 1 ? 'cliente de GoCardless cobra' : 'clientes de GoCardless cobran'} ${euros(total)} al mes y aún no ${p.lista.length === 1 ? 'está unido' : 'están unidos'} a su cliente en Sumied. Sumied propone el más probable; tú confirmas. En GoCardless no cambia nada.`
              : 'Todos los cobros de GoCardless están unidos a su cliente en Sumied.'}
          </div>
        </div>
      </header>
      {aviso && <p className="g4-hecho" data-ok={aviso.ok ? '' : undefined} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
      <div className="g4-as-lista">
        {p.lista.map((x) => <Uno key={`${x.empresaId}|${x.gcClienteId}`} x={x} {...p} nombreDe={nombreDe} setAviso={setAviso} />)}
      </div>
    </div>
  )
}

function Uno({ x, clientes, lasDos, alUnir, nombreDe, setAviso }: PropsAsignar & { x: PorAsignar; nombreDe: (id: string) => string; setAviso: (a: Aviso) => void }) {
  const inicial = x.propuesta.tipo === 'una' ? x.propuesta.clienteId : null
  const [elegido, setElegido] = useState<string | null>(inicial)
  const [busca, setBusca] = useState('')
  const [enCurso, setEnCurso] = useState(false)
  const posibles = x.propuesta.tipo === 'varias' ? x.propuesta.clienteIds : []
  const q = busca.trim().toLowerCase()
  const sugeridos = q.length >= 2 ? clientes.filter((c) => `${c.nombre} ${c.nif ?? ''} ${c.correos.join(' ')}`.toLowerCase().includes(q)).slice(0, 8) : []
  return (
    <section className="g4-as-uno" aria-label={x.nombre}>
      <div className="g4-as-cabeza">
        <div>
          <div className="g4-as-nombre">{x.nombre}</div>
          <div className="g4-pequeno">{[lasDos ? x.empresa : null, x.nif ? `NIF ${x.nif}` : null, x.correo].filter(Boolean).join(' · ') || 'Sin NIF ni email en GoCardless'}</div>
        </div>
        <div className="g4-as-importe"><b>{euros(x.alMesCent)}</b> <span className="g4-pequeno">al mes</span></div>
      </div>
      <div className="g4-pequeno">{x.suscripciones.map((s) => `${s.nombre} · ${euros(s.alMesCent)}`).join(' · ')}</div>
      <div className="g4-as-propuesta" data-hay={x.propuesta.tipo !== 'ninguna' ? '' : undefined}>{textoDePropuesta(x.propuesta, nombreDe)}</div>
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
          try { setAviso({ ok: true, texto: await alUnir(x.empresaId, x.gcClienteId, elegido!) }) } catch (e) { setAviso({ ok: false, texto: e instanceof Error ? e.message : String(e) }) }
          setEnCurso(false)
        }}>{elegido ? `Unir a ${nombreDe(elegido)}` : 'Elige un cliente'}</button>
      </div>
    </section>
  )
}
