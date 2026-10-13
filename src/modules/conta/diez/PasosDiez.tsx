// src/modules/conta/diez/PasosDiez.tsx
//
// C06, respuesta 3: «Traer tu contabilidad de Diez» en cuatro pasos y en su
// orden (datos → plan → banco → Diez). El que falta lo dice, con un botón para
// hacerlo; el cuarto lo hace la marca y se dice en qué está. Regla 8: el botón
// que hace algo confirma con contenido o dice por qué no.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAltaEmpresa, rutaAjustes, rutaTablasGenerales } from '@/config/navegacion'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { pasosDiez, resumenPasos, type PasoVisto } from '@/modules/conta/lib/pasosDiez'
import { crearSubcuentasDeBanco } from '@/modules/conta/services/pasosDiezService'

import type { EstadoPasosDiez as Estado } from '@/modules/conta/diez/usePasosDiez'

export function PasosDiez({ accountId, companyId, quien, estado, recargar }: {
  accountId: string; companyId: string; quien: string | null; estado: Estado; recargar: () => void
}) {
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const pasos = pasosDiez(estado.listo, MARCA.nombre, estado.sinSubcuenta)

  async function crearSubcuenta() {
    setOcupado(true); setHecho(null); setFallo(null)
    try {
      const codigos = await crearSubcuentasDeBanco(accountId, companyId, quien)
      setHecho(codigos.length ? `Hecho: ${codigos.length === 1 ? 'la cuenta' : 'las cuentas'} ${codigos.join(', ')} de tu banco, en el plan.` : 'Tu banco ya tenía su cuenta en el plan.')
      recargar()
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally { setOcupado(false) }
  }

  const boton = (p: PasoVisto) => {
    const b = p.boton
    if (!b) return null
    if (b.tipo === 'subcuentaBanco') return <button type="button" className="cx-boton" disabled={ocupado} onClick={() => void crearSubcuenta()}>{b.texto}</button>
    const a = b.a === 'alta' ? rutaAltaEmpresa() : b.a === 'plan' ? `${rutaAjustes('plan')}?empezar=de-cero` : rutaTablasGenerales('bancos-y-cajas')
    return <Link className="cx-boton" to={a}>{b.texto}</Link>
  }

  return (
    <section className="cxi-seccion cxi-diez" aria-labelledby="cxi-diez-titulo">
      <div className="cxi-seccion-cabeza">
        <h2 id="cxi-diez-titulo" className="cxi-seccion-titulo">Traer tu contabilidad de Diez</h2>
        <span className="cxi-seccion-apoyo">{resumenPasos(pasos)}</span>
      </div>
      <ol className="cxi-diez-pasos">
        {pasos.map((p) => (
          <li key={p.clave} className={`cxi-diez-paso cxi-diez-paso-${p.estado}`} aria-current={p.estado === 'falta' ? 'step' : undefined}>
            <span className="cxi-diez-paso-numero" aria-hidden="true">{p.estado === 'hecho' ? '✓' : p.numero}</span>
            <span className="cxi-diez-paso-texto">
              <span className="cxi-diez-paso-titulo">{p.titulo}</span>
              <span className="cxi-diez-paso-apoyo">{p.texto}</span>
            </span>
            {boton(p)}
          </li>
        ))}
      </ol>
      {hecho && <p className="cx-guardado" role="status">{hecho}</p>}
      {fallo && <p className="cx-aviso" role="alert">No se ha hecho: {fallo}</p>}
    </section>
  )
}
