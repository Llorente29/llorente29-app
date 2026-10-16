// src/modules/conta/marco/nuevo/BarraModulos.tsx
//
// M01 · La barra de módulos, a la izquierda (maqueta N30 §1).
//   · Plegada (de serie): 76 px; cada módulo, un círculo de 30 px con su letra
//     y el nombre debajo en 11 px. El activo, en azul con la letra en blanco.
//   · Lo pendiente, en un globo ámbar arriba a la derecha del círculo (es un
//     aviso que interrumpe: solo sale si hay algo; regla 7).
//   · «»» la despliega a 232 px: el nombre en una línea y el número a la
//     derecha. Se recuerda por usuario (preferencias.ts).
//   · Inicio, arriba del todo, con la casa. Impuestos, apagado con
//     «Próximamente» al pasar el ratón (o al llegar con el teclado).

import { useId } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { Icono } from '@/modules/conta/ui/Icono'
import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { TEXTO_PROXIMAMENTE, moduloDe, modulosVisibles, type ModuloConta } from '@/modules/conta/marco/nuevo/modulos'

export function Circulo({ m, cuenta }: { m: ModuloConta; cuenta?: number | null }) {
  return (
    <span className="cxm-circulo" aria-hidden="true">
      {m.letra ?? <Icono nombre="inicio" tam={16} />}
      {(cuenta ?? 0) > 0 && <span className="cxm-globo">{cuenta}</span>}
    </span>
  )
}

function Modulo({ m, activo, cuenta }: { m: ModuloConta; activo: boolean; cuenta: number | null | undefined }) {
  const id = useId()
  if (m.ruta === null) {
    return (
      <li>
        {/* Un botón desactivado, no un enlace: no lleva a ningún sitio (y así no se
            confunde con los enlaces «Impuestos» de las pantallas, como el de Tablas). */}
        <button type="button" className="cxm-modulo cxm-modulo-apagado" aria-disabled="true" aria-describedby={id}>
          <Circulo m={m} />
          <span className="cxm-modulo-nombre">{m.etiqueta}</span>
          <span id={id} role="tooltip" className="cxm-pronto">{TEXTO_PROXIMAMENTE}</span>
        </button>
      </li>
    )
  }
  const n = cuenta ?? 0
  return (
    <li>
      {/* El número no cambia el nombre del enlace: va como su descripción (e2e 172). */}
      <Link to={rutaConta(m.ruta)} className="cxm-modulo" aria-current={activo ? 'page' : undefined} aria-describedby={n > 0 ? id : undefined}>
        <Circulo m={m} cuenta={cuenta} />
        <span className="cxm-modulo-nombre">{m.etiqueta}</span>
        {n > 0 && <span className="cxm-modulo-cuenta" aria-hidden="true">{n}</span>}
        {n > 0 && <span id={id} hidden>{n} por mirar</span>}
      </Link>
    </li>
  )
}

export function BarraModulos({ solo, desplegada, alternar, cuentas }: {
  solo: boolean
  desplegada: boolean
  alternar: () => void
  cuentas: CuentasMenu
}) {
  const { pathname } = useLocation()
  const activo = moduloDe(pathname)?.id ?? null
  const lista = modulosVisibles(solo)
  const de = (g: ModuloConta['grupo']) => lista.filter((m) => m.grupo === g)
  const pintar = (m: ModuloConta) => <Modulo key={m.id} m={m} activo={activo === m.id} cuenta={m.cuenta ? cuentas[m.cuenta] : undefined} />
  return (
    <nav className="cxm-modulos" aria-label="Menú de contabilidad" data-desplegada={desplegada ? 'si' : 'no'}>
      <button type="button" className="cxm-plegar" aria-expanded={desplegada} onClick={alternar}
        aria-label={desplegada ? 'Plegar el menú' : 'Desplegar el menú'} title={desplegada ? 'Plegar el menú' : 'Desplegar el menú'}>
        <span aria-hidden="true">{desplegada ? '«' : '»'}</span>
      </button>
      <ul className="cxm-modulos-lista">
        {de('arriba').map(pintar)}
        {de('modulos').map(pintar)}
        <li className="cxm-modulos-separador" aria-hidden="true" />
        {de('abajo').map(pintar)}
      </ul>
    </nav>
  )
}
