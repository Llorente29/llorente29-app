// src/modules/conta/marco/VariasEmpresas.tsx
//
// DM1 · PR 1 (30/10/2026). Dentro del botón de empresa de la cabecera, para
// quien tiene varias cuentas (una asesoría, un despacho): sus sociedades,
// agrupadas por cuenta (tableros 1 y 2 de «Sumied · DM1 · Demos y varias
// empresas», decisión 7). Una de la cuenta abierta se elige como siempre; una
// de otra cuenta abre esa cuenta entera y recarga: no se mezcla nada.

import { useState } from 'react'
import { rutaConta } from '@/config/navegacion'
import { seccionesDelSelector, type ClienteDeDespacho, type CuentaMia, type DondeEstoy } from '@/modules/multitenancy/lib/misEmpresas'
import { abrirEmpresa, entrarEnCliente } from '@/modules/multitenancy/services/empresasService'
import { CuadradoEmpresa } from './Cabecera'
import { colorDeEmpresa } from './colorEmpresa'

export function VariasEmpresas({ cuentas, clientes = [], donde = { abierto: null, accesos: [] }, sociedadAbierta, elegirEnEsta, cerrar }: {
  cuentas: CuentaMia[]
  /** G05: los clientes de los despachos de la persona, y dónde está (los accesos no salen en «Tus empresas»). */
  clientes?: ClienteDeDespacho[]
  donde?: DondeEstoy
  /** La sociedad abierta ahora (la de useEmpresas). */
  sociedadAbierta: string | null
  /** Elegir otra sociedad de la cuenta abierta: como siempre, sin recargar. */
  elegirEnEsta: (sociedadId: string) => void
  cerrar: () => void
}) {
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [error, setError] = useState('')
  const secciones = seccionesDelSelector(cuentas, clientes, donde, sociedadAbierta)
  const conTitulos = secciones.length > 1
  const cuentaAbierta = cuentas.find((c) => c.activa)?.account_id ?? null

  async function elegir(accountId: string, sociedadId: string | null, clave: string, deDespacho: boolean) {
    setError('')
    if (accountId === cuentaAbierta) {
      if (sociedadId) elegirEnEsta(sociedadId)
      cerrar()
      return
    }
    setAbriendo(clave)
    try {
      // G05: un cliente del despacho se abre entrando por el despacho (crea o reactiva el acceso).
      if (deDespacho && sociedadId) await entrarEnCliente(sociedadId, rutaConta('inicio'))
      else await abrirEmpresa(accountId, sociedadId, rutaConta(''))
    } catch (e) {
      setAbriendo(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="s-varias" data-prueba="varias-empresas">
      {secciones.map((sec, j) => (
        <div key={sec.titulo} className="s-varias-seccion" role="group" aria-label={sec.titulo} data-prueba={sec.despachoId ? 'selector-clientes' : 'selector-propias'}>
          {conTitulos && <span className="s-menu-titulo">{sec.titulo}</span>}
          {sec.grupos.map((g, i) => (
            <div key={g.titulo ?? g.filas[0]?.clave ?? i} className="s-varias-grupo" role="group" aria-label={g.titulo ?? g.filas[0]?.nombre}>
              {g.titulo && <span className="s-menu-nota s-varias-cuenta">{g.titulo}</span>}
              <ul className="s-barra-lista">
                {g.filas.map((f) => (
                  <li key={f.clave}>
                    <button type="button" className="s-menu-item s-varias-fila" aria-current={f.abierta ? 'true' : undefined}
                      disabled={abriendo !== null} data-prueba="empresa-fila" onClick={() => { void elegir(f.accountId, f.sociedadId, f.clave, !!sec.despachoId) }}>
                      <CuadradoEmpresa nombre={f.nombre} color={colorDeEmpresa(f.color, f.nombre)} logo={f.logo} />
                      <span className="s-menu-texto">
                        <span>{f.nombre}</span>
                        <span className="s-menu-nota">{f.detalle}</span>
                      </span>
                      {f.abierta && <span className="s-varias-abierta">Abierta</span>}
                      {abriendo === f.clave && <span className="s-varias-abierta" role="status">{sec.despachoId ? `Entrando en ${f.nombre}…` : 'Abriendo…'}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {j < secciones.length - 1 && <div className="s-menu-separador" />}
        </div>
      ))}
      {error && <p className="s-menu-nota s-varias-error" role="alert">{error}</p>}
      <div className="s-menu-separador" />
      <p className="s-menu-nota">Al cambiar se abre la otra empresa entera. No se mezcla nada entre ellas.</p>
    </div>
  )
}
