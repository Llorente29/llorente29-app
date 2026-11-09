// src/modules/conta/marco/FranjaDespacho.tsx
//
// G05 (08/11/2026) · La franja del despacho: dentro del cliente, fija arriba,
// sobre la cabecera, de un color propio (distinto de «Estás gestionando» del
// administrador de plataforma). No se puede cerrar.
//   · A la izquierda: «Frango Takeaway, S.L. · cliente de Asesoría QBO».
//   · A la derecha: «Cambiar de cliente ▾» (un buscador con los clientes del
//     despacho por razón social, que entra en el elegido sin pasar por el
//     despacho) y «Volver al despacho».
// Una línea; en el móvil, dos como mucho. Si entrar o volver falla, lo dice
// aquí mismo con el porqué (regla 8).

import { useMemo, useState } from 'react'
import { rutaConta } from '@/config/navegacion'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { Icono } from '@/modules/conta/diseno'
import { entrarEnCliente, volverAlDespacho } from '@/modules/multitenancy/services/empresasService'
import type { ClienteDeDespacho, DondeEstoy } from '@/modules/multitenancy/lib/misEmpresas'

export function FranjaDespacho({ abierto, clientes, movil }: {
  abierto: NonNullable<DondeEstoy['abierto']>
  clientes: ClienteDeDespacho[]
  movil: boolean
}) {
  const { activa, elegir } = useEmpresas()
  const { abierto: lista, setAbierto, alternar, caja, boton } = useDesplegable()
  const [busca, setBusca] = useState('')
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [error, setError] = useState('')
  const delDespacho = useMemo(
    () => clientes.filter((c) => c.despacho_id === abierto.despacho_id).sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es')),
    [clientes, abierto.despacho_id],
  )
  const visibles = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase('es')
    return q ? delDespacho.filter((c) => [c.razon_social, c.nombre].some((x) => x.toLocaleLowerCase('es').includes(q))) : delDespacho
  }, [busca, delDespacho])
  const razon = activa?.razonSocial || activa?.nombre || delDespacho.find((c) => c.account_id === abierto.account_id)?.razon_social || 'Tu cliente'

  async function cambiar(c: ClienteDeDespacho) {
    setError('')
    if (c.account_id === abierto.account_id) {
      // Otra sociedad de la misma cuenta: se elige como siempre, sin recargar.
      elegir(c.company_id)
      setAbierto(false)
      return
    }
    setHaciendo(`Entrando en ${c.razon_social}…`)
    try {
      await entrarEnCliente(c.company_id, rutaConta('inicio'))
    } catch (e) {
      setHaciendo(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function volver() {
    setError('')
    setHaciendo(`Volviendo a ${abierto.despacho_nombre}…`)
    try {
      await volverAlDespacho(rutaConta)
    } catch (e) {
      setHaciendo(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className={`s-franja-despacho${movil ? ' s-franja-despacho-movil' : ''}`} role="region" aria-label="Estás en un cliente de tu despacho" data-prueba="franja-despacho">
      <p className="s-franja-despacho-donde">
        <b data-prueba="franja-razon">{razon}</b>
        <span className="s-franja-despacho-de"> · cliente de {abierto.despacho_nombre}</span>
      </p>
      <div className="s-franja-despacho-acciones">
        {(haciendo || error) && (
          <span className="s-franja-despacho-estado" role={error ? 'alert' : 'status'}>{error || haciendo}</span>
        )}
        <div className="s-desplegable" ref={caja}>
          <button type="button" ref={boton} className="s-franja-despacho-boton" aria-expanded={lista} aria-haspopup="true"
            disabled={haciendo !== null} onClick={() => { setBusca(''); alternar() }} data-prueba="cambiar-de-cliente">
            Cambiar de cliente <Icono nombre="desplegar" />
          </button>
          {lista && (
            <div className="s-menu s-menu-derecha s-menu-empresas s-franja-despacho-menu" role="group" aria-label="Cambiar de cliente">
              <span className="s-menu-titulo">Clientes de {abierto.despacho_nombre}</span>
              <label className="s-menu-buscar">
                <Icono nombre="buscar" />
                <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por razón social" aria-label="Buscar cliente" autoFocus />
              </label>
              <ul className="s-barra-lista" aria-label={`Clientes de ${abierto.despacho_nombre}`}>
                {visibles.map((c) => {
                  const aqui = c.account_id === abierto.account_id && c.company_id === activa?.id
                  return (
                    <li key={c.company_id}>
                      <button type="button" className="s-menu-item" aria-current={aqui ? 'true' : undefined} data-prueba="cliente-fila"
                        onClick={() => { void cambiar(c) }}>
                        <span className="s-menu-texto">
                          <span>{c.razon_social}</span>
                          {c.nombre && c.nombre !== c.razon_social && <span className="s-menu-nota">{c.nombre}</span>}
                        </span>
                        {aqui && <span className="s-varias-abierta">Aquí</span>}
                      </button>
                    </li>
                  )
                })}
                {visibles.length === 0 && <li className="s-menu-nota">Ningún cliente se llama así.</li>}
              </ul>
            </div>
          )}
        </div>
        <button type="button" className="s-franja-despacho-boton s-franja-despacho-volver" disabled={haciendo !== null}
          onClick={() => { void volver() }} data-prueba="volver-al-despacho">
          Volver al despacho
        </button>
      </div>
    </div>
  )
}
