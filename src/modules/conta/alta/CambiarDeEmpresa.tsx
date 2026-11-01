// src/modules/conta/alta/CambiarDeEmpresa.tsx
//
// DM1 (31/10/2026) · El alta no encierra. Si la empresa abierta no tiene
// sociedad, Inicio manda al alta, y el alta a pantalla completa no tiene
// cabecera: «Salir y seguir luego» vuelve a Inicio, que vuelve a mandar aquí.
// Quien tiene otras empresas no podía salir a ellas.
//
// Arriba del alta, «Cambiar de empresa», con el mismo selector de la cabecera:
//   · quien tiene más de una cuenta: sus empresas agrupadas por cuenta
//     (VariasEmpresas); elegir otra abre esa cuenta y recarga;
//   · el superadministrador: sus clientes, como «Cambiar de cliente» de la
//     barra de Folvy (todas las cuentas, con buscador).
// Con una sola empresa y sin ser superadministrador, no sale: no hay adónde ir.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { useApp } from '@/context/AppContext'
import { usePlatformAdmin } from '@/platform/usePlatformAdmin'
import { listAccounts } from '@/modules/multitenancy/services/accountsService'
import { useMisEmpresas } from '@/modules/multitenancy/hooks/useMisEmpresas'
import { VariasEmpresas } from '@/modules/conta/marco/VariasEmpresas'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { Icono } from '@/modules/conta/diseno'
import type { Account } from '@/types/multitenancy'
import { saleCambiarDeEmpresa } from '@/modules/conta/lib/cambiarDeEmpresa'

function Clientes({ cerrar }: { cerrar: () => void }) {
  const { activeAccountId, setActiveAccountId } = useApp()
  const navegar = useNavigate()
  const [todas, setTodas] = useState<Account[] | null>(null)
  const [error, setError] = useState('')
  const [busca, setBusca] = useState('')
  useEffect(() => {
    let vivo = true
    listAccounts({ includeInternal: true })
      .then((r) => { if (vivo) setTodas(r) })
      .catch((e: unknown) => { if (vivo) { setTodas([]); setError(e instanceof Error ? e.message : 'No se han podido leer los clientes.') } })
    return () => { vivo = false }
  }, [])
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (todas ?? []).filter((a) => !q || a.name.toLowerCase().includes(q))
  }, [todas, busca])
  if (todas === null) return <p className="s-menu-nota" role="status">Cargando los clientes…</p>
  return (
    <>
      <label className="s-menu-buscar">
        <Icono nombre="buscar" />
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" autoFocus />
      </label>
      <ul className="s-barra-lista" aria-label="Clientes">
        {lista.map((a) => (
          <li key={a.id}>
            <button type="button" className="s-menu-item" data-cuenta={a.id} aria-current={a.id === activeAccountId ? 'true' : undefined}
              onClick={() => { cerrar(); setActiveAccountId(a.id); navegar(rutaConta('')) }}>
              <span className="s-menu-texto"><span>{a.name}</span></span>
            </button>
          </li>
        ))}
        {lista.length === 0 && <li className="s-menu-nota">{error || 'Ningún cliente se llama así.'}</li>}
      </ul>
    </>
  )
}

export function CambiarDeEmpresa() {
  const cuentas = useMisEmpresas()
  const { isPlatformAdmin } = usePlatformAdmin()
  const { abierto, setAbierto, alternar, caja, boton } = useDesplegable()
  if (!saleCambiarDeEmpresa(cuentas.length, isPlatformAdmin)) return null
  return (
    <div className="s-desplegable cx-alta-cambiar" ref={caja}>
      <button type="button" ref={boton} className="cx-boton-sec" aria-expanded={abierto} aria-haspopup="true" onClick={alternar}
        data-prueba="alta-cambiar-empresa">
        {isPlatformAdmin ? 'Cambiar de cliente' : 'Cambiar de empresa'}
      </button>
      {abierto && (
        <div className="s-menu s-menu-empresas s-menu-derecha" role="group" aria-label={isPlatformAdmin ? 'Cambiar de cliente' : 'Tus empresas'}>
          <span className="s-menu-titulo">{isPlatformAdmin ? 'Cambiar de cliente' : 'Tus empresas'}</span>
          {isPlatformAdmin
            ? <Clientes cerrar={() => setAbierto(false)} />
            : <VariasEmpresas cuentas={cuentas} sociedadAbierta={null} elegirEnEsta={() => setAbierto(false)} cerrar={() => setAbierto(false)} />}
        </div>
      )}
    </div>
  )
}
