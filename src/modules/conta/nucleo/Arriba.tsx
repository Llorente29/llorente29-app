// src/modules/conta/nucleo/Arriba.tsx
//
// K02 · La barra de arriba del núcleo (maqueta nucleo_1, 16/11): oscura, de
// 42 px. A la izquierda, el nombre de la marca y la empresa con su ejercicio
// («Empresa de ejemplo, S.L. 2026 ▾»), que abre el cambio de empresa y de
// ejercicio; en medio, la caja del buscador («Buscar un proveedor, un número
// de factura, un importe…»), que abre el buscador de hoy (decisión 9); a la
// derecha, la persona, con su menú: Ajustes, Novedades y Favoritos (decisión
// 5), su nivel y su densidad, y cerrar sesión.

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Search } from 'lucide-react'
import { rutaAltaEmpresa, rutaConta } from '@/config/navegacion'
import { signOut } from '@/services/authService'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { VariasEmpresas } from '@/modules/conta/marco/VariasEmpresas'
import { useMisEmpresas } from '@/modules/multitenancy/hooks/useMisEmpresas'
import { estadoDelEjercicio, type Ejercicio } from '@/modules/conta/marco/periodo'
import { iniciales } from '@/modules/conta/lib/formato'
import { NIVELES, NOMBRE_NIVEL, type Densidad, type Preferencias } from '@/modules/conta/esqueleto/preferencias'
import { favoritosDe } from '@/modules/conta/esqueleto/ordenes'
import type { Contexto } from '@/modules/conta/esqueleto/productos'
import { menuPersonaVisible } from './mapa'
import { ejerciciosEnOrden } from './ejercicio'

function EmpresaYEjercicio({ ejercicios, ejercicio, elegirEjercicio }: {
  ejercicios: readonly Ejercicio[]; ejercicio: Ejercicio | null; elegirEjercicio: (codigo: string) => void
}) {
  const { activa, empresas, elegir, cargando } = useEmpresas()
  const { abierto, setAbierto, alternar, caja, boton } = useDesplegable()
  const cuentas = useMisEmpresas()
  const [busca, setBusca] = useState('')
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? empresas.filter((e) => [e.nombre, e.razonSocial ?? '', e.nif ?? ''].some((x) => x.toLowerCase().includes(q))) : empresas
  }, [busca, empresas])
  if (cargando) return <span className="k-empresa" aria-hidden="true" />
  if (!activa) return <Link to={rutaAltaEmpresa()} className="k-empresa"><span className="k-empresa-nombre">Tu empresa · darla de alta</span></Link>
  const nombre = activa.razonSocial ?? activa.nombre
  return (
    <div className="k-desplegable" ref={caja}>
      <button type="button" ref={boton} className="k-empresa" aria-expanded={abierto} aria-haspopup="true"
        aria-label={`${nombre}${ejercicio ? `, ejercicio ${ejercicio.codigo}` : ''}. Cambiar de empresa o de ejercicio`}
        onClick={() => { setBusca(''); alternar() }}>
        <span className="k-empresa-nombre">{nombre}</span>
        {ejercicio && <span className="k-empresa-ejercicio">{ejercicio.codigo}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {abierto && (
        <div className="k-menu k-menu-empresa" role="group" aria-label="Empresa y ejercicio">
          <div className="k-menu-columna">
            <span className="k-menu-titulo">Empresa</span>
            {cuentas.length > 1
              ? <VariasEmpresas cuentas={cuentas} sociedadAbierta={activa.id} elegirEnEsta={elegir} cerrar={() => setAbierto(false)} />
              : (
                <>
                  {empresas.length > 1 && (
                    <input type="search" className="k-menu-buscar" value={busca} onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar por nombre o NIF" aria-label="Buscar empresa" autoFocus />
                  )}
                  <ul className="k-menu-lista" aria-label="Tus empresas">
                    {lista.map((e) => (
                      <li key={e.id}>
                        <button type="button" className="k-menu-item" aria-current={e.id === activa.id ? 'true' : undefined}
                          onClick={() => { elegir(e.id); setAbierto(false) }}>
                          <span>{e.razonSocial ?? e.nombre}</span>
                          {e.nif && <span className="k-menu-nota">{e.nif}</span>}
                        </button>
                      </li>
                    ))}
                    {lista.length === 0 && <li className="k-menu-nota">Ninguna empresa se llama así.</li>}
                  </ul>
                  <Link to={rutaAltaEmpresa()} className="k-menu-item" onClick={() => setAbierto(false)}>+ Dar de alta otra empresa</Link>
                </>
              )}
          </div>
          <div className="k-menu-columna">
            <span className="k-menu-titulo">Ejercicio</span>
            {ejercicios.length === 0
              ? <p className="k-menu-nota">Esta empresa no tiene ningún ejercicio dado de alta.</p>
              : (
                <ul className="k-menu-lista" aria-label="Ejercicios">
                  {ejerciciosEnOrden(ejercicios).map((x) => (
                    <li key={x.codigo}>
                      <button type="button" className="k-menu-item" aria-current={x.codigo === ejercicio?.codigo ? 'true' : undefined}
                        onClick={() => { elegirEjercicio(x.codigo); setAbierto(false) }}>
                        <span>Ejercicio {x.codigo}</span><span className="k-menu-nota">{estadoDelEjercicio(x)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      )}
    </div>
  )
}

function Persona({ nombre, prefs, cambiar, solo, ctx, abrirBuscador }: {
  nombre: string; prefs: Preferencias; cambiar: (c: Partial<Preferencias>, dicho: string) => void; solo: boolean; ctx: Contexto; abrirBuscador: () => void
}) {
  const { abierto, setAbierto, alternar, caja, boton } = useDesplegable()
  const navegar = useNavigate()
  const [saliendo, setSaliendo] = useState(false)
  const [errorSalir, setErrorSalir] = useState<string | null>(null)
  const elegir = (c: Partial<Preferencias>, dicho: string) => { cambiar(c, dicho); setAbierto(false) }
  const salir = async () => {
    setSaliendo(true); setErrorSalir(null)
    const r = await signOut()
    if (!r.ok) { setSaliendo(false); setErrorSalir(`No se ha podido cerrar la sesión: ${r.error ?? 'sin respuesta'}. Vuelve a probar.`); return }
    setAbierto(false)
    navegar('/login')
  }
  const ajustes = menuPersonaVisible(ctx).filter((e) => e.id !== 'novedades')
  const favoritos = favoritosDe(prefs.favoritos, ctx)
  return (
    <div className="k-desplegable" ref={caja}>
      <button ref={boton} type="button" className="k-persona" aria-expanded={abierto} aria-haspopup="true"
        aria-label={`${nombre}. Ajustes, Novedades, Favoritos y tus preferencias`} onClick={alternar}>
        <span className="k-persona-inicial" aria-hidden="true">{iniciales(nombre).slice(0, 1)}</span>
        <span className="k-persona-nombre">{nombre}</span>
      </button>
      {abierto && (
        <div className="k-menu k-menu-persona k-menu-derecha">
          <div className="k-menu-columna">
            <span className="k-menu-titulo">Ajustes</span>
            <ul className="k-menu-lista" aria-label="Ajustes">
              {ajustes.map((e) => (
                <li key={e.id}><Link to={rutaConta(e.ruta)} className="k-menu-item" onClick={() => setAbierto(false)}>{e.etiqueta}</Link></li>
              ))}
            </ul>
          </div>
          <div className="k-menu-columna">
            <span className="k-menu-titulo">Favoritos</span>
            {favoritos.length === 0
              ? <p className="k-menu-nota">Aún no has fijado ninguna pantalla.</p>
              : (
                <ul className="k-menu-lista" aria-label="Favoritos">
                  {favoritos.map((f) => (
                    <li key={f.id}>
                      {f.orden && f.disponible
                        ? ('ruta' in f.orden.a
                          ? <Link to={rutaConta(f.orden.a.ruta)} className="k-menu-item" onClick={() => setAbierto(false)}>{f.orden.etiqueta}</Link>
                          : <button type="button" className="k-menu-item" onClick={() => { setAbierto(false); abrirBuscador() }}>{f.orden.etiqueta}</button>)
                        // Regla 7: el que no se puede abrir aquí sale, y dice por qué.
                        : <span className="k-menu-item" aria-disabled="true">{f.orden?.etiqueta ?? 'Ya no existe'}<span className="k-menu-nota">No se puede abrir en esta empresa</span></span>}
                    </li>
                  ))}
                </ul>
              )}
            <span className="k-menu-titulo">Ayuda</span>
            <Link to={rutaConta('ayuda/novedades')} className="k-menu-item" onClick={() => setAbierto(false)}>Novedades</Link>
            <span className="k-menu-titulo">Tu nivel</span>
            {NIVELES.map((n) => (
              <button key={n} type="button" className="k-menu-item" aria-pressed={prefs.nivel === n}
                onClick={() => elegir({ nivel: n }, `Nivel: ${NOMBRE_NIVEL[n].toLowerCase()}. Cambian las palabras; cada cosa sigue en su sitio.`)}>{NOMBRE_NIVEL[n]}</button>
            ))}
            <span className="k-menu-titulo">Densidad</span>
            {([['comoda', 'Cómoda', 'filas de 56 px'], ['compacta', 'Compacta', 'filas de 40 px']] as [Densidad, string, string][]).map(([v, t, nota]) => (
              <button key={v} type="button" className="k-menu-item" aria-pressed={prefs.densidad === v}
                onClick={() => elegir({ densidad: v }, `Densidad: ${t.toLowerCase()}, ${nota}.`)}>{t}<span className="k-menu-nota">{nota}</span></button>
            ))}
            <div className="k-menu-separador" />
            {!solo && <Link to="/" className="k-menu-item">Volver a Folvy</Link>}
            <button type="button" className="k-menu-item" onClick={() => void salir()} disabled={saliendo}>
              <span>{saliendo ? 'Cerrando la sesión…' : 'Cerrar sesión'}</span><LogOut size={14} aria-hidden="true" />
            </button>
            {errorSalir && <p className="k-menu-nota" role="alert">{errorSalir}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export function Arriba({ marca, ejercicios, ejercicio, elegirEjercicio, abrirBuscador, nombre, prefs, cambiar, solo, ctx }: {
  marca: string
  ejercicios: readonly Ejercicio[]
  ejercicio: Ejercicio | null
  elegirEjercicio: (codigo: string) => void
  abrirBuscador: () => void
  nombre: string
  prefs: Preferencias
  cambiar: (c: Partial<Preferencias>, dicho: string) => void
  solo: boolean
  ctx: Contexto
}) {
  return (
    <header className="k-arriba">
      <div className="k-arriba-izquierda">
        <Link to={rutaConta('inicio')} className="k-marca">{marca}</Link>
        <EmpresaYEjercicio ejercicios={ejercicios} ejercicio={ejercicio} elegirEjercicio={elegirEjercicio} />
      </div>
      <button type="button" className="k-buscador" onClick={abrirBuscador} aria-keyshortcuts="Control+K">
        <Search size={15} aria-hidden="true" />
        <span>Buscar un proveedor, un número de factura, un importe…</span>
      </button>
      <Persona nombre={nombre} prefs={prefs} cambiar={cambiar} solo={solo} ctx={ctx} abrirBuscador={abrirBuscador} />
    </header>
  )
}
