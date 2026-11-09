// src/modules/conta/portal/Portal.tsx
//
// GP · Tarea 3 · El armazón del portal del cliente, fiel a la maqueta: la
// cabecera con la marca de la gestoría (su nombre, sus iniciales o su logo y su
// color), las pestañas, la pantalla de cada una y el pie con cómo contactar y
// «Funciona con Sumied». Primero el móvil. La pestaña va en la dirección
// (#facturas…), para que «atrás» funcione.

import { useCallback, useEffect, useState } from 'react'
import { sb } from './cliente'
import { CajaAviso, type Aviso } from './comun'
import { iniciales } from './formato'
import type { ClienteDeEntrada, Pestana } from './tipos'
import { Inicio } from './pantallas/Inicio'
import { Facturas } from './pantallas/Facturas'
import { Pagos } from './pantallas/Pagos'
import { Documentos } from './pantallas/Documentos'
import { Trabajadores } from './pantallas/Trabajadores'
import { Mensajes } from './pantallas/Mensajes'
import { Cuenta } from './pantallas/Cuenta'

const PESTANAS: { id: Pestana; label: string; todo: boolean }[] = [
  { id: 'inicio', label: 'Inicio', todo: false },
  { id: 'facturas', label: 'Facturas', todo: false },
  { id: 'pagos', label: 'Pagos', todo: true },
  { id: 'documentos', label: 'Documentos', todo: false },
  { id: 'trabajadores', label: 'Trabajadores', todo: true },
  { id: 'mensajes', label: 'Mensajes', todo: true },
  { id: 'cuenta', label: 'Tu cuenta', todo: true },
]

const deLaDireccion = (): Pestana => {
  const h = window.location.hash.replace('#', '') as Pestana
  return PESTANAS.some((p) => p.id === h) ? h : 'inicio'
}

export function Portal({ c, yo, otros, cambiar, avisoInicial }: { c: ClienteDeEntrada; yo: string; otros: number; cambiar: () => void; avisoInicial: Aviso | null }) {
  const [pestana, setPestana] = useState<Pestana>(deLaDireccion)
  const [abrir, setAbrir] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<Aviso | null>(avisoInicial)
  const [menu, setMenu] = useState(false)
  const [nombre, setNombre] = useState<string>(() => { try { return localStorage.getItem(`sumied-portal-nombre:${yo}`) ?? '' } catch { return '' } })
  const ponerNombre = useCallback((n: string) => {
    setNombre(n)
    try { localStorage.setItem(`sumied-portal-nombre:${yo}`, n) } catch { /* sin almacén */ }
  }, [yo])
  const todo = c.permiso === 'todo'
  const visibles = PESTANAS.filter((p) => todo || !p.todo)

  useEffect(() => {
    const cambia = () => { setPestana(deLaDireccion()); setAbrir({}) }
    window.addEventListener('hashchange', cambia)
    return () => window.removeEventListener('hashchange', cambia)
  }, [])
  useEffect(() => { document.documentElement.style.setProperty('--marca', /^#[0-9a-f]{6}$/i.test(c.gestoria.color ?? '') ? c.gestoria.color! : '#0E2240') }, [c.gestoria.color])
  useEffect(() => { document.title = `${c.gestoria.nombre} · Tu espacio` }, [c.gestoria.nombre])
  // En el móvil las pestañas se desplazan: la elegida, siempre a la vista.
  useEffect(() => { document.querySelector('.pt-tab[aria-current="page"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) }, [pestana])

  const ir = useCallback((p: Pestana, a: Record<string, string> = {}) => {
    setAbrir(a); setPestana(p)
    if (window.location.hash !== `#${p}`) window.history.pushState(null, '', `#${p}`)
    window.scrollTo({ top: 0 })
  }, [])
  const avisar = useCallback((a: Aviso) => { setAviso(a); window.scrollTo({ top: 0, behavior: 'smooth' }) }, [])
  const props = { cliente: c.cliente_id, permiso: c.permiso, ir, abrir, avisar, ponerNombre }
  const salir = async () => { await sb?.auth.signOut(); window.location.replace(window.location.pathname) }

  return (
    <div className="pt">
      <header className="pt-cabecera">
        <div className="pt-gestoria">
          <div className="pt-logo" aria-hidden="true">{iniciales(c.gestoria.nombre)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="pt-gestoria-nombre">{c.gestoria.nombre}</div>
            <div className="pt-gestoria-sub">Tu espacio · {c.cliente}</div>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" className="pt-yo" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label={`${nombre || yo}: opciones`}>
            <span className="pt-yo-nombre">{nombre || yo}</span><span className="pt-avatar" aria-hidden="true">{nombre ? iniciales(nombre) : (yo.split('@')[0][0] ?? '·').toUpperCase()}</span>
          </button>
          {menu && (
            <div className="pt-tarjeta" style={{ position: 'absolute', right: 0, top: 44, zIndex: 10, padding: 10, gap: 4, minWidth: 200, color: 'var(--tinta)' }}>
              {otros > 1 && <button type="button" className="pt-boton enlace" onClick={() => { setMenu(false); cambiar() }}>Cambiar de empresa</button>}
              <button type="button" className="pt-boton enlace" onClick={salir}>Salir</button>
            </div>
          )}
        </div>
      </header>
      <nav className="pt-nav" aria-label="Secciones">
        {visibles.map((p) => (
          <button type="button" key={p.id} className="pt-tab" aria-current={pestana === p.id ? 'page' : undefined} onClick={() => ir(p.id)}>{p.label}</button>
        ))}
      </nav>
      <main className="pt-main">
        <CajaAviso aviso={aviso} cerrar={() => setAviso(null)} />
        {pestana === 'inicio' && <Inicio {...props} />}
        {pestana === 'facturas' && <Facturas {...props} />}
        {pestana === 'pagos' && todo && <Pagos {...props} />}
        {pestana === 'documentos' && <Documentos {...props} />}
        {pestana === 'trabajadores' && todo && <Trabajadores {...props} />}
        {pestana === 'mensajes' && todo && <Mensajes {...props} gestoria={c.gestoria.nombre} />}
        {pestana === 'cuenta' && todo && <Cuenta {...props} />}
        {!visibles.some((p) => p.id === pestana) && <div className="pt-aviso info"><span>Tu acceso es solo para facturas y documentos.</span></div>}
      </main>
      <footer className="pt-pie">
        <span>¿Dudas? Escribe a tu gestoría{c.gestoria.correo ? <>: <a href={`mailto:${c.gestoria.correo}`}>{c.gestoria.correo}</a></> : ''}{c.gestoria.telefono ? ` · ${c.gestoria.telefono}` : ''}</span>
        <span>Funciona con Sumied</span>
      </footer>
    </div>
  )
}
