// src/shell/version/NovedadesPage.tsx
//
// NV1 · Ayuda › Novedades (maqueta «Cartel de novedades», 3): lo que ha
// cambiado, de lo más nuevo a lo más antiguo, por día, con «Nuevo para ti» en
// lo que quien mira aún no había visto y un enlace a cada pantalla. La misma
// en Folvy y en Sumied, cada una con lo suyo y lo común.
// Abrirla cuenta como visto (desde la próxima vez, ya no sale «Nuevo para ti»).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MARCA } from '@/marca/marca'
import { deMiProducto, fechaCorta, leeNovedades, leeVistasHasta, marcaVistasHasta, masNueva, nuevaParaTi, porDia, productoDeMarca, type Novedad } from './novedades'
import './cartel.css'

export default function NovedadesPage({ miga = 'Ayuda › Novedades' }: { miga?: string }) {
  const producto = productoDeMarca(MARCA.id)
  const [lista, setLista] = useState<Novedad[] | null | 'error'>(null)
  const [vistasHasta, setVistasHasta] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let vivo = true
    void Promise.all([leeNovedades(), leeVistasHasta()]).then(([l, v]) => {
      if (!vivo) return
      setVistasHasta(v)
      const mias = l ? deMiProducto(l, producto) : null
      setLista(mias ?? 'error')
      if (mias) void marcaVistasHasta(masNueva(mias))
    })
    return () => { vivo = false }
  }, [producto])

  return (
    <div className="nvp" data-prueba="novedades">
      <div className="nvp-cab">
        <div className="nvp-miga">{miga}</div>
        <h1 className="nvp-titulo">Novedades de {MARCA.nombre}</h1>
        <p className="nvp-frase">Lo que ha cambiado, de lo más nuevo a lo más antiguo. Lo que todavía no habías visto va marcado.</p>
      </div>
      {lista === null && <div className="s-lista-cargando" aria-busy="true" aria-label="Leyendo las novedades" />}
      {lista === 'error' && <p className="nvp-vacio" role="alert">No se han podido leer las novedades ahora. Vuelve a intentarlo en un momento.</p>}
      {Array.isArray(lista) && lista.length === 0 && <p className="nvp-vacio">Aún no hay novedades que contar.</p>}
      {Array.isArray(lista) && lista.length > 0 && (
        <ul className="nvp-dias">
          {porDia(lista).map((d) => (
            <li key={d.dia} className="nvp-dia" data-prueba="novedades-dia">
              <div className="nvp-fecha">
                {fechaCorta(d.fecha)}
                {vistasHasta !== undefined && d.novedades.some((n) => nuevaParaTi(n, vistasHasta)) && <span className="nvp-nuevo">Nuevo para ti</span>}
              </div>
              <div className="nvp-cosas">
                {d.novedades.map((n) => (
                  <div key={n.id}><b>{n.apartado}.</b> {n.frase} {n.ruta && <Link to={n.ruta}>Ir a {n.apartado}</Link>}</div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
