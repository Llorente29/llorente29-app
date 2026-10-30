// src/modules/multitenancy/components/InvitarPersona.tsx
//
// DM1 · PR 1 (30/10/2026). «Invitar a una persona» (tablero 4 de «Sumied · DM1
// · Demos y varias empresas»): el correo y, por cada empresa de la que quien
// invita es administrador, la casilla y el permiso. La misma pieza en Sumied
// (Ajustes › Usuarios) y en Folvy (Configuración › Usuarios y accesos).
// El correo lo escribe quien invita; no se guarda en ningún sitio más que en
// el usuario (T11). Al acabar dice lo que ha pasado (regla 8).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MARCA } from '@/marca/marca'
import { Boton, Campo, Selector, Texto } from '@/modules/conta/diseno'
import { detalleDeCuenta, type CuentaMia } from '../lib/misEmpresas'
import { misEmpresas } from '../services/empresasService'
import '@/modules/conta/diseno/tokens.css'
import '@/modules/conta/diseno/diseno.css'
import './invitar.css'

const PERMISOS = [
  { valor: 'admin', texto: 'Todo (administrador)' },
  { valor: 'manager', texto: 'Encargado' },
] as const

export function InvitarPersona({ alCerrar, alInvitar }: { alCerrar?: () => void; alInvitar?: () => void }) {
  const [cuentas, setCuentas] = useState<CuentaMia[] | null>(null)
  const [correo, setCorreo] = useState('')
  const [elegidas, setElegidas] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState('')
  const [enlace, setEnlace] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      const todas = await misEmpresas()
      if (!vivo) return
      const mias = todas.filter((c) => c.rol === 'admin')
      setCuentas(mias)
      // La abierta, marcada de entrada.
      const abierta = mias.find((c) => c.activa)
      if (abierta) setElegidas({ [abierta.account_id]: 'admin' })
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [])

  async function invitar() {
    setError(''); setHecho(''); setEnlace(null)
    const lista = Object.entries(elegidas).map(([account_id, rol]) => ({ account_id, rol }))
    if (!correo.trim()) { setError('Escribe el correo de la persona.'); return }
    if (lista.length === 0) { setError('Elige al menos una empresa.'); return }
    if (!supabase) { setError('Sin conexión con el servidor.'); return }
    setEnviando(true)
    try {
      const { data, error: e } = await supabase.functions.invoke('invitar-persona', {
        body: { correo: correo.trim(), cuentas: lista, marca: MARCA.id === 'sumied' ? 'sumied' : 'folvy' },
      })
      if (e) {
        let motivo = e.message
        try { const cuerpo = await (e as { context?: Response }).context?.json(); if (cuerpo?.error) motivo = cuerpo.error } catch { /* sin cuerpo */ }
        throw new Error(motivo)
      }
      const r = data as { frase: string; enlace: string | null }
      setHecho(r.frase)
      setEnlace(r.enlace)
      setCorreo('')
      alInvitar?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="cx-colores s-raiz s-invitar" data-prueba="invitar-persona" aria-labelledby="invitar-titulo">
      <header className="s-invitar-cabeza">
        <h2 id="invitar-titulo" className="s-invitar-titulo">Invitar a una persona</h2>
        <p className="s-invitar-apoyo">Le llega un correo para entrar. Si ya tiene usuario, se le añaden estas empresas.</p>
      </header>
      <div className="s-invitar-cuerpo">
        <Campo etiqueta="Correo">
          {(p) => <Texto {...p} type="email" autoComplete="off" valor={correo} alCambiar={setCorreo} placeholder="correo de la persona" data-prueba="invitar-correo" />}
        </Campo>
        <fieldset className="s-invitar-empresas">
          <legend>A qué empresas entra y qué puede hacer</legend>
          {cuentas === null && <p className="s-invitar-apoyo">Buscando tus empresas…</p>}
          {cuentas?.map((c) => {
            const marcada = c.account_id in elegidas
            return (
              <div key={c.account_id} className="s-invitar-empresa" data-marcada={marcada || undefined}>
                <label className="s-invitar-casilla">
                  <input type="checkbox" checked={marcada} data-prueba="invitar-empresa"
                    onChange={(e) => setElegidas((x) => {
                      const y = { ...x }
                      if (e.target.checked) y[c.account_id] = 'admin'; else delete y[c.account_id]
                      return y
                    })} />
                  <span>
                    <span className="s-invitar-nombre">{c.nombre}</span>
                    <span className="s-invitar-apoyo">{detalleDeCuenta(c).split(' · ')[0]}</span>
                  </span>
                </label>
                <Selector aria-label={`Qué puede hacer en ${c.nombre}`} disabled={!marcada} valor={elegidas[c.account_id] ?? 'admin'}
                  opciones={PERMISOS} alCambiar={(v) => setElegidas((x) => ({ ...x, [c.account_id]: v }))} />
              </div>
            )
          })}
          <p className="s-invitar-apoyo">Solo salen las empresas en las que tú eres administrador.</p>
        </fieldset>
        {hecho && <p className="s-invitar-hecho" role="status" data-prueba="invitar-hecho">{hecho}</p>}
        {enlace && <p className="s-invitar-apoyo">Enlace (solo fuera de producción): <a href={enlace}>entrar</a></p>}
        {error && <p className="s-invitar-error" role="alert">{error}</p>}
      </div>
      <footer className="s-invitar-pie">
        {alCerrar && <Boton onClick={alCerrar}>Cancelar</Boton>}
        <Boton variante="principal" disabled={enviando} onClick={() => { void invitar() }} data-prueba="invitar-enviar">
          {enviando ? 'Enviando…' : 'Enviar la invitación'}
        </Boton>
      </footer>
    </section>
  )
}
