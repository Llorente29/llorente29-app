// src/modules/multitenancy/pages/CambiosCartaLastPage.tsx
//
// F01 · PR 2 · tablero 5: «Cambios en la carta de una marca que ya tienes».
// Lo que ha cambiado en Last de cada marca vinculada y lo que falta decidir:
//   · platos nuevos → «Añadir a la carta» (el sembrado de la marca);
//   · extras nuevos, con lo que propone Folvy en palabras de cocina →
//     «Guardar los N propuestos»; los que faltan, «Revisar uno a uno» en Extras;
//   · platos que ya no están: se dicen; se quedan en la carta y en el histórico;
//   · precios distintos → «Poner los de Last» (con apunte de cada cambio).
// Solo marcas de Last. Cada botón confirma con lo que ha hecho o falla (regla 8).

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useActiveAccount } from '../hooks/useActiveAccount'
import { euros, fraseRetirados, frasePrecios, hayCambios, lotePropuestos, queHaceEnCocina, resumenCambios, type CambiosMarca } from '../lib/cambiosCarta'
import { enumerar, nombreCanal } from '../lib/marcasLast'
import { anadirPlatosNuevos, guardarExtrasPropuestos, leerCambiosCarta, ponerPreciosDeLast } from '../services/cambiosCartaService'
import '../components/brands/altaMarcaLast.css'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function CambiosCartaLastPage() {
  const { activeAccountId } = useActiveAccount()
  const [params, setParams] = useSearchParams()
  const [cambios, setCambios] = useState<CambiosMarca[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [hecho, setHecho] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (!activeAccountId) return
    let vivo = true
    leerCambiosCarta(activeAccountId)
      .then((c) => { if (vivo) { setCambios(c); setError(null) } })
      .catch((e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [activeAccountId, vuelta])

  const conCambios = (cambios ?? []).filter(hayCambios)
  const elegida = conCambios.find((c) => c.brandId === params.get('marca')) ?? conCambios[0] ?? null

  const hacer = async (f: () => Promise<string>) => {
    setOcupado(true); setHecho(null)
    try { setHecho({ ok: true, texto: await f() }); setVuelta((v) => v + 1) }
    catch (e) { setHecho({ ok: false, texto: `No se ha hecho: ${msg(e)}` }) }
    finally { setOcupado(false) }
  }

  if (error) return <p className="ml-error" role="alert">No se han podido leer los cambios de Last: {error}</p>
  if (!cambios) return <p className="ml-cargando" aria-busy="true">Leyendo los cambios de las cartas de Last…</p>

  return (
    <div className="cc-pagina" data-prueba="cambios-last">
      <span className="cc-miga">Marcas › Cambios de Last</span>
      {hecho && <div className={hecho.ok ? 'ml-hecho' : 'ml-error'} role={hecho.ok ? 'status' : 'alert'} data-prueba="cambios-hecho">{hecho.texto}</div>}
      {conCambios.length === 0 && (
        <p className="cc-vacio">Las cartas de tus marcas de Last están como en Folvy: no hay platos nuevos, extras sin decidir, platos que se hayan ido ni precios distintos.</p>
      )}
      {conCambios.length > 1 && (
        <div className="cc-marcas" role="tablist" aria-label="Marcas con cambios">
          {conCambios.map((c) => (
            <button key={c.brandId} type="button" role="tab" aria-selected={c.brandId === elegida?.brandId}
              onClick={() => { const p = new URLSearchParams(params); p.set('marca', c.brandId); setParams(p, { replace: true }); setHecho(null) }}>
              {c.nombre}
            </button>
          ))}
        </div>
      )}
      {elegida && <Marca c={elegida} ocupado={ocupado} hacer={hacer} accountId={activeAccountId!} />}
    </div>
  )
}

function Marca({ c, ocupado, hacer, accountId }: { c: CambiosMarca; ocupado: boolean; hacer: (f: () => Promise<string>) => Promise<void>; accountId: string }) {
  const propuestos = lotePropuestos(c).length
  const faltan = c.extrasNuevos.length - propuestos
  return (
    <>
      <h1 className="cc-titulo">Cambios en la carta de {c.nombre}</h1>
      <p className="cc-sub">Lo que ha cambiado en Last y lo que falta decidir · en todos sus locales · {resumenCambios(c)}</p>
      <ul className="ml-filas" data-prueba="cambios-filas">
        {c.platosNuevos.length > 0 && (
          <li className="ml-fila" data-tipo="nuevos">
            <div className="ml-ico" aria-hidden>+{c.platosNuevos.length}</div>
            <div className="ml-txt"><b>{c.platosNuevos.length === 1 ? '1 plato nuevo' : `${c.platosNuevos.length} platos nuevos`}</b>
              <span>{enumerar(c.platosNuevos.map((p) => p.nombre))}. Se venden ya; descuentan almacén cuando tengan receta.</span></div>
            <button type="button" className="ml-boton" data-principal="si" disabled={ocupado} onClick={() => void hacer(() => anadirPlatosNuevos(accountId, c.brandId))}>Añadir a la carta</button>
          </li>
        )}
        {c.extrasNuevos.length > 0 && (
          <li className="ml-fila" data-tipo="extras">
            <div className="ml-ico cc-ico-aviso" aria-hidden>+{c.extrasNuevos.length}</div>
            <div className="ml-txt"><b>{c.extrasNuevos.length === 1 ? '1 extra nuevo' : `${c.extrasNuevos.length} extras nuevos`}</b>
              <span>{enumerar(c.extrasNuevos.map((e) => e.nombre))}. Dime qué descuenta cada uno.</span></div>
            <span className="ml-chip" data-tono="aviso">Sin decidir</span>
          </li>
        )}
        {c.retirados.length > 0 && (
          <li className="ml-fila" data-tipo="retirados" data-apagada="si">
            <div className="ml-ico" aria-hidden>−{c.retirados.length}</div>
            <div className="ml-txt"><b>{c.retirados.length === 1 ? '1 plato que ya no está en la carta' : `${c.retirados.length} platos que ya no están en la carta`}</b>
              <span>{fraseRetirados(c)}</span></div>
            <span className="ml-chip" data-tono="suave">Fuera de Last</span>
          </li>
        )}
        {c.precios.length > 0 && (
          <li className="ml-fila" data-tipo="precios">
            <div className="ml-ico" aria-hidden>€</div>
            <div className="ml-txt"><b>{frasePrecios(c)}</b>
              <span>{c.precios.slice(0, 6).map((p) => `${p.nombre}${p.canal ? ` (${nombreCanal(p.canal)})` : ''}: ${euros(p.antes)} → ${euros(p.despues)}`).join(' · ')}{c.precios.length > 6 ? ` · y ${c.precios.length - 6} más, todos con «Poner los de Last»` : ''}</span></div>
            <button type="button" className="ml-boton" disabled={ocupado} onClick={() => void hacer(() => ponerPreciosDeLast(accountId, c.brandId))}>Poner los de Last</button>
          </li>
        )}
        {c.precios.length === 0 && c.preciosPuestos30d > 0 && (
          <li className="ml-fila" data-tipo="precios-puestos">
            <div className="ml-ico" aria-hidden>€</div>
            <div className="ml-txt"><b>{c.preciosPuestos30d === 1 ? '1 precio puesto desde Last' : `${c.preciosPuestos30d} precios puestos desde Last`}</b><span>En los últimos 30 días, con quién y cuándo.</span></div>
            <span className="ml-chip" data-tono="ok">Aplicado</span>
          </li>
        )}
      </ul>

      {c.extrasNuevos.length > 0 && (
        <>
          <div className="cc-tabla">
            <table>
              <thead><tr><th>Extra nuevo</th><th className="cc-num">Precio</th><th>¿Qué hace en cocina?</th><th /></tr></thead>
              <tbody>
                {c.extrasNuevos.map((e) => {
                  const q = queHaceEnCocina(e)
                  return (
                    <tr key={e.modifierId} data-estado={e.estado}>
                      <td>{e.nombre}</td>
                      <td className="cc-num">{euros(e.precio)}</td>
                      <td>{q.fuerte ? <>{q.frase} <b>{q.fuerte}</b></> : <span className="ml-pista">{q.frase}</span>}</td>
                      <td><span className="ml-chip" data-tono={e.estado === 'propuesto' ? 'ok' : 'aviso'}>{e.estado === 'propuesto' ? 'Propuesto' : 'Falta'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="cc-acciones">
            {propuestos > 0 && (
              <button type="button" className="ml-boton" data-principal="si" disabled={ocupado} onClick={() => void hacer(() => guardarExtrasPropuestos(accountId, c))}>
                {propuestos === 1 ? 'Guardar el propuesto' : `Guardar los ${propuestos} propuestos`}
              </button>
            )}
            {faltan > 0 && <Link className="ml-boton cc-enlace" to="/kitchen/extras">Revisar uno a uno</Link>}
          </div>
        </>
      )}
    </>
  )
}
