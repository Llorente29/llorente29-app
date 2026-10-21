// src/modules/conta/bancos/PortadaMovil.tsx
//
// B01 · Bancos en el móvil, con el patrón de M4: el banco elegido arriba (en
// píldoras), dos cifras grandes (Para confirmar y Por aclarar), la frase verde
// del mes y los apartados de 56 px con su resumen; cada uno abre su pantalla.
// En el móvil se confirma y se aclara; lo demás también se puede, pero el
// trabajo de cada día son esas dos listas y la foto del ticket.

import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { rutaBancos } from '@/config/navegacion'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { useLeer } from '@/modules/conta/libros/contexto'
import { estadoBanco, nombreCorto, ultimosIban } from '@/modules/conta/lib/bancosVista'
import { cuadreDe } from '@/modules/conta/lib/conciliarVista'
import { leerMovimientos } from '@/modules/conta/services/bancosPantallas'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { PARAM_NUEVO, VALOR_NUEVO } from '@/modules/conta/bancos/bancoNuevo'

export function PortadaMovil() {
  const { accountId, banco, mes, datos, vuelta, elegirBanco, subir } = useBancos()
  const [query] = useSearchParams()
  const lectura = useLeer(banco ? () => leerMovimientos(accountId, banco.id, mes) : null, `${banco?.id}:${mes}:${vuelta}`)
  const movs = useMemo(() => lectura.datos ?? [], [lectura.datos])
  // Las mismas cuentas que Movimientos (cuadreDe): la portada no puede decir otra cosa.
  const c = useMemo(() => cuadreDe(movs, null, null, mes), [movs, mes])
  const ir = (vista: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(query)
    for (const [k, v] of Object.entries(extra)) p.set(k, v)
    return `${rutaBancos(vista)}?${p.toString()}`
  }

  if (!banco) return <div className="cx-tarjeta"><p>No hay ningún banco dado de alta.</p><Link to={ir('cuentas', { [PARAM_NUEVO]: VALOR_NUEVO })} className="cx-boton">Dar de alta un banco</Link></div>
  if (lectura.error) return <ErrorConReintento mensaje={lectura.error} reintentar={lectura.recargar} />
  if (!lectura.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los bancos">{[0, 1, 2].map((i) => <Hueso key={i} alto={56} />)}</div>

  const r = { paraConfirmar: c.cuenta.confirmar, porAclarar: c.cuenta.aclarar, casados: c.cuenta.casados, frase: c.frase, seguros: c.preseleccionados.length }
  const tarjetas = datos.bancos.reduce((t, b) => t + b.tarjetas.length, 0)

  const apartados: { vista: string; extra?: Record<string, string>; titulo: string; resumen: string; ambar?: boolean }[] = [
    { vista: 'movimientos', extra: { ver: 'confirmar' }, titulo: 'Para confirmar', resumen: r.paraConfirmar ? `${r.paraConfirmar} · un «Sí» cada uno` : 'Nada por confirmar', ambar: r.paraConfirmar > 0 },
    { vista: 'movimientos', extra: { ver: 'aclarar' }, titulo: 'Por aclarar', resumen: r.porAclarar ? `${r.porAclarar} · te digo qué falta` : 'Nada por aclarar', ambar: r.porAclarar > 0 },
    { vista: 'movimientos', extra: { ver: 'casados' }, titulo: 'Casados solos', resumen: `${r.casados} este mes · se abren y se deshacen desde aquí` },
    { vista: 'reglas', titulo: 'Reglas', resumen: `${datos.reglas.activas} ${datos.reglas.activas === 1 ? 'regla' : 'reglas'}${datos.reglas.nuevas ? ` · ${datos.reglas.nuevas} nuevas` : ''}` },
    { vista: 'cuentas', titulo: 'Cuentas y extractos', resumen: `${datos.bancos.length} ${datos.bancos.length === 1 ? 'cuenta' : 'cuentas'} · ${tarjetas} ${tarjetas === 1 ? 'tarjeta' : 'tarjetas'}` },
    { vista: 'cierre', titulo: 'Cierre del mes', resumen: 'El saldo del banco frente al de contabilidad' },
  ]

  return (
    <div className="cxb-portada">
      <div className="cxb-pildoras" role="group" aria-label="Tus bancos">
        {datos.bancos.map((b) => {
          const e = estadoBanco(datos.dudas[b.id] ?? 0, !!b.ultimoExtracto)
          const u = ultimosIban(b.iban)
          return (
            <button key={b.id} type="button" className="cx-pildora cxb-pildora-banco" aria-pressed={b.id === banco.id} onClick={() => elegirBanco(b.id)}>
              <span className={`cxl-punto cxl-punto-${e.tono}`} aria-hidden="true" /> {nombreCorto(b)}{u ? ` ···${u}` : ''}
            </button>
          )
        })}
      </div>

      <div className="cxb-botones-grandes">
        <button type="button" className="cx-boton-sec" onClick={() => subir()}>Subir extracto</button>
        <Link to={ir('movimientos', { ver: 'confirmar' })} className="cx-boton">{r.seguros ? `Confirmar los ${r.seguros} seguros` : `Confirmar ${r.paraConfirmar || ''}`}</Link>
      </div>

      <div className="cxb-cifras cxb-cifras-movil">
        <div className="cxb-cifra">
          <span className="cxb-cifra-etiqueta">Para confirmar</span>
          <span className="cxb-cifra-valor">{r.paraConfirmar}</span>
          <span className="cxb-cifra-pie cxb-ambar">una línea cada uno</span>
        </div>
        <div className="cxb-cifra">
          <span className="cxb-cifra-etiqueta">Por aclarar</span>
          <span className="cxb-cifra-valor">{r.porAclarar}</span>
          <span className="cxb-cifra-pie cxb-ambar">falta algo: te digo qué</span>
        </div>
      </div>

      <p className="cxb-frase-verde">{r.frase}</p>

      <ul className="cxb-apartados">
        {apartados.map((a) => (
          <li key={a.titulo}>
            <Link to={ir(a.vista, a.extra)} className="cxb-apartado">
              <span className="cxb-apartado-texto">
                <span className="cxb-apartado-titulo">{a.titulo}</span>
                <span className={`cxb-apartado-resumen${a.ambar ? ' cxb-ambar' : ''}`}>{a.resumen}</span>
              </span>
              <span className="cx-flecha" aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
