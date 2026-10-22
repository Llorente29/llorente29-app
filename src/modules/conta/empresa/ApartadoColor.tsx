// src/modules/conta/empresa/ApartadoColor.tsx
//
// S02 · «El color de la empresa», en Ajustes › Tu empresa (Julio, 22/10: la
// franja de 3 px de la cabecera y el cuadrado de la inicial, en el color de la
// empresa activa). Se elige uno de los ocho del patrón (--s-empresa-1…8 de
// diseno/tokens.css, todos con texto blanco a ≥ 4,5:1) o se deja el de serie,
// que sale de su inicial. Se guarda en company.color ('#RRGGBB', 0460).
//
// Regla 8: elegir dice lo que ha pasado («Color guardado: ya sale en la
// cabecera»); si la base no lo guarda, se dice y no cambia nada.

import { useRef } from 'react'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { guardarColorEmpresa } from '@/modules/conta/services/esqueletoService'
import { refrescarContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import { useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { NUMEROS_DE_SERIE, aHex, colorDeEmpresa, inicialDeEmpresa } from '@/modules/conta/marco/colorEmpresa'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import type { Quien } from '@/modules/conta/empresa/apartados'

export function ApartadoColor({ quien, movil }: { quien: Quien; movil: boolean }) {
  const marco = useMarco()
  const nombre = useEmpresas().activa?.nombre ?? ''
  const h = useHacer(() => refrescarContextoEsqueleto())
  const muestras = useRef<(HTMLButtonElement | null)[]>([])
  const elegido = marco?.colorEmpresa ?? null
  const guardar = (color: string | null) => void h.hacer(async () => { await guardarColorEmpresa(quien.accountId, quien.companyId, color) },
    color ? `Color guardado (${color}). Ya sale en la franja de la cabecera y en el cuadrado de «${nombre}».` : `Vuelve el de serie, el de su inicial «${inicialDeEmpresa(nombre)}».`)
  const elegir = (i: number) => {
    const b = muestras.current[i]
    const hex = b ? aHex(getComputedStyle(b).backgroundColor) : null
    if (!hex) { void h.hacer(() => Promise.reject(new Error('No he podido leer ese color. No se ha guardado nada.')), ''); return }
    guardar(hex)
  }
  return (
    <TarjetaApartado titulo="El color de la empresa" movil={movil}>
      <p className="cx-ayuda">Va en la franja de arriba de la cabecera y en el cuadrado con la inicial: así se ve de un vistazo en qué empresa estás.</p>
      <div className="s-colores-empresa" role="group" aria-label="Elige el color de la empresa">
        {NUMEROS_DE_SERIE.map((n, i) => {
          const color = `var(--s-empresa-${n})`
          return (
            <button key={n} type="button" ref={(el) => { muestras.current[i] = el }} className="s-color-empresa" style={{ background: color }}
              aria-label={`Color ${n}`} disabled={h.guardando} onClick={() => elegir(i)}>
              {inicialDeEmpresa(nombre)}
            </button>
          )
        })}
      </div>
      <p className="cx-ayuda">
        {elegido ? <>Ahora: <span className="s-color-empresa s-color-empresa-pequeno" style={{ background: colorDeEmpresa(elegido, nombre) }} aria-hidden="true" /> {elegido}.</> : 'Ahora: el de serie, el de su inicial.'}
      </p>
      {elegido && <div className="cx-pie"><button type="button" className="cx-boton-sec" disabled={h.guardando} onClick={() => guardar(null)}>Volver al de serie</button></div>}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}
