// src/modules/conta/marco/Cabecera.tsx
//
// S02 · La cabecera, la misma en todas las páginas (encargo S02, «Cabecera»;
// tableros 1 a 9): blanca, de 56 px, con una franja de 3 px del color de la
// empresa activa encima (--s-franja-empresa).
//   · A la izquierda, el botón de empresa (el cuadrado con su inicial en ese
//     mismo color, el nombre comercial y la razón social, ▾; abre el cambio de
//     empresa, con buscador) y, SOLO en las pantallas que lo leen, el botón del
//     periodo (BotonPeriodo, que la pantalla pone en su hueco).
//   · A la derecha, «Buscar o hacer algo» con Ctrl K, la Ayuda y el usuario.
// En el móvil (tablero 4): el botón del menú, el logo de 30 px y Buscar; la
// empresa y el periodo, en una fila debajo. La banda del entorno de pruebas
// es la de toda la aplicación (FranjaEntorno, src/main.tsx): no se repite.

import { useMemo, useState, type ReactNode, type RefCallback } from 'react'
import { Link } from 'react-router-dom'
import { rutaAltaEmpresa, rutaConta } from '@/config/navegacion'
import { LogoHorizontal } from '@/marca/PiezasMarca'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { Icono, Tecla } from '@/modules/conta/diseno'
import { colorDeEmpresa, inicialDeEmpresa } from './colorEmpresa'
import { useMisEmpresas } from '@/modules/multitenancy/hooks/useMisEmpresas'
import { VariasEmpresas } from './VariasEmpresas'

/** El cuadrado de la empresa: su logo si lo subió; si no, su inicial en su color. */
export function CuadradoEmpresa({ nombre, color, logo }: { nombre: string; color: string; logo: string | null }) {
  if (logo) return <img className="s-empresa-cuadrado" src={logo} alt="" aria-hidden="true" />
  return <span className="s-empresa-cuadrado" style={{ background: color }} aria-hidden="true">{inicialDeEmpresa(nombre)}</span>
}

/** El botón de empresa, con el cambio de empresa y su buscador. */
function BotonEmpresa({ logo, colorElegido, movil }: { logo: string | null; colorElegido: string | null; movil: boolean }) {
  const { activa, empresas, elegir, cargando } = useEmpresas()
  const { abierto, setAbierto, alternar, caja, boton } = useDesplegable()
  // DM1 · PR 1: con varias cuentas (una asesoría), sus sociedades agrupadas por cuenta.
  const cuentas = useMisEmpresas()
  const varias = cuentas.length > 1
  const [busca, setBusca] = useState('')
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return empresas
    return empresas.filter((e) => [e.nombre, e.razonSocial ?? '', e.nif ?? ''].some((x) => x.toLowerCase().includes(q)))
  }, [busca, empresas])
  if (cargando) return <span className="s-empresa" aria-hidden="true"><span className="s-empresa-cuadrado" /></span>
  if (!activa) {
    return <Link to={rutaAltaEmpresa()} className="s-empresa"><span className="s-empresa-nombre">Tu empresa · darla de alta</span></Link>
  }
  const color = colorDeEmpresa(colorElegido, activa.nombre)
  const razon = activa.razonSocial && activa.razonSocial !== activa.nombre ? activa.razonSocial : null
  return (
    <div className="s-desplegable s-empresa-caja" ref={caja}>
      <button type="button" ref={boton} className="s-empresa" aria-expanded={abierto} aria-haspopup="true"
        aria-label={`${activa.nombre}${razon ? `, ${razon}` : ''}. Cambiar de empresa`} title={movil ? undefined : [activa.nombre, razon].filter(Boolean).join(' · ')}
        onClick={() => { setBusca(''); alternar() }}>
        <CuadradoEmpresa nombre={activa.nombre} color={color} logo={logo} />
        <span className="s-empresa-textos">
          <span className="s-empresa-nombre">{activa.nombre}</span>
          {razon && <span className="s-empresa-razon">{razon}</span>}
        </span>
        <Icono nombre="desplegar" />
      </button>
      {abierto && varias && (
        <div className={`s-menu s-menu-empresas${movil ? ' s-menu-hoja' : ''}`} role="group" aria-label={movil ? 'Cambiar de empresa' : 'Tus empresas'}>
          <span className={movil ? 's-hoja-titulo' : 's-menu-titulo'}>{movil ? 'Cambiar de empresa' : 'Tus empresas'}</span>
          <VariasEmpresas cuentas={cuentas} sociedadAbierta={activa.id} elegirEnEsta={elegir} cerrar={() => setAbierto(false)} />
        </div>
      )}
      {abierto && !varias && (
        <div className="s-menu s-menu-empresas" role="group" aria-label="Tus empresas">
          <span className="s-menu-titulo">Tus empresas</span>
          {empresas.length > 1 && (
            <label className="s-menu-buscar">
              <Icono nombre="buscar" />
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o NIF" aria-label="Buscar empresa" autoFocus />
            </label>
          )}
          <ul className="s-barra-lista" aria-label="Tus empresas">
            {lista.map((e) => (
              <li key={e.id}>
                <button type="button" className="s-menu-item" aria-current={e.id === activa.id ? 'true' : undefined}
                  onClick={() => { elegir(e.id); setAbierto(false) }}>
                  <span className="s-menu-texto">
                    <span>{e.nombre}</span>
                    {(e.razonSocial || e.nif) && <span className="s-menu-nota">{[e.razonSocial !== e.nombre ? e.razonSocial : null, e.nif].filter(Boolean).join(' · ')}</span>}
                  </span>
                </button>
              </li>
            ))}
            {lista.length === 0 && <li className="s-menu-nota">Ninguna empresa se llama así.</li>}
          </ul>
          <div className="s-menu-separador" />
          <Link to={rutaAltaEmpresa()} className="s-menu-item" onClick={() => setAbierto(false)}>+ Dar de alta otra empresa</Link>
        </div>
      )}
    </div>
  )
}

/** La Ayuda: los atajos de teclado y cómo se leen los colores de las pantallas. */
function Ayuda() {
  const { abierto, alternar, caja, boton } = useDesplegable()
  return (
    <div className="s-desplegable" ref={caja}>
      <button ref={boton} type="button" className="s-cab-icono" aria-label="Ayuda" title="Ayuda" aria-expanded={abierto} aria-haspopup="true" onClick={alternar}>
        <Icono nombre="ayuda" grande />
      </button>
      {abierto && (
        <div className="s-menu s-menu-derecha s-ayuda" role="group" aria-label="Ayuda">
          <span className="s-menu-titulo">Con el teclado</span>
          <dl className="s-ayuda-teclas">
            <dt><Tecla>Ctrl K</Tecla></dt><dd>Buscar o hacer algo, desde cualquier página</dd>
            <dt><Tecla>Intro</Tecla></dt><dd>En una cola de revisión: validar y pasar a la siguiente</dd>
            <dt><Tecla>← →</Tecla></dt><dd>La anterior y la siguiente</dd>
            <dt><Tecla>Esc</Tecla></dt><dd>Volver a la lista, como la dejaste</dd>
            <dt><Tecla>Ctrl Intro</Tecla></dt><dd>Guardar un asiento a mano</dd>
          </dl>
          <div className="s-menu-separador" />
          <span className="s-menu-titulo">Los colores</span>
          <ul className="s-ayuda-colores">
            <li><span className="s-chip" data-tono="propuesto">Propuesto</span> lo ha puesto Sumied y espera tu visto bueno</li>
            <li><span className="s-chip" data-tono="duda">Por revisar</span> te pide una decisión</li>
            <li><span className="s-chip" data-tono="seguro">Hecho</span> ya está</li>
          </ul>
          <p className="s-menu-nota">Todo se puede hacer igual con el ratón.</p>
        </div>
      )}
    </div>
  )
}

export function Cabecera({ movil, logoEmpresa, colorEmpresa, huecoPeriodo, abrirBuscador, usuario, abrirMenu, menuAbierto }: {
  movil: boolean
  logoEmpresa: string | null
  /** El color que eligió la empresa ('#RRGGBB'), o null: el de serie de su inicial. */
  colorEmpresa: string | null
  huecoPeriodo: RefCallback<HTMLDivElement>
  abrirBuscador: () => void
  usuario: ReactNode
  /** En el móvil: abre el cajón del menú. */
  abrirMenu?: () => void
  menuAbierto?: boolean
}) {
  const { activa } = useEmpresas()
  const color = colorDeEmpresa(colorEmpresa, activa?.nombre ?? null)
  return (
    <div className="s-cab" style={{ ['--s-color-empresa' as string]: color }}>
      <div className="s-franja-empresa" aria-hidden="true" />
      <header className="s-cabecera">
        <div className="s-cab-izquierda">
          {movil && (
            <>
              <button type="button" className="s-cab-icono s-cab-menu" aria-label="Abrir el menú" aria-haspopup="dialog" aria-expanded={!!menuAbierto} onClick={abrirMenu}>
                <Icono nombre="menu" grande />
              </button>
              <Link to={rutaConta('inicio')} className="s-cab-logotipo" aria-label="Inicio"><LogoHorizontal alto={30} /></Link>
            </>
          )}
          {!movil && <BotonEmpresa logo={logoEmpresa} colorElegido={colorEmpresa} movil={false} />}
          {/* El periodo: lo pone la pantalla que lo lee (PeriodoEnBarra); vacío, no sale. En el móvil, en su fila. */}
          {!movil && <div className="s-cab-periodo" ref={huecoPeriodo} />}
        </div>
        <div className="s-cab-derecha">
          {movil
            ? <button type="button" className="s-cab-icono" aria-label="Buscar o hacer algo" aria-keyshortcuts="Control+K" onClick={abrirBuscador}><Icono nombre="buscar" grande /></button>
            : (
              <button type="button" className="s-cab-buscar" aria-keyshortcuts="Control+K" onClick={abrirBuscador}>
                <Icono nombre="buscar" /><span className="s-cab-buscar-texto">Buscar o hacer algo</span><Tecla>Ctrl K</Tecla>
              </button>
            )}
          {!movil && <Ayuda />}
          {!movil && usuario}
        </div>
      </header>
      {movil && (
        <div className="s-cab-fila-movil">
          <BotonEmpresa logo={logoEmpresa} colorElegido={colorEmpresa} movil />
          <div className="s-cab-periodo s-cab-periodo-movil" ref={huecoPeriodo} />
        </div>
      )}
    </div>
  )
}
