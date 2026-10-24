// src/modules/conta/diseno/Tarjeta.tsx
//
// S01 · La tarjeta: blanca, borde fino, radio de bloque y sin sombra (maqueta
// 1, «Para revisar · 12» y «Vigilancia de la norma»). Título, apoyo debajo y la
// acción a la derecha. `tono` la tiñe para lo que avisa (ámbar, «Retención del
// alquiler») o lo comprobado (verde, «Lo que he comprobado»).
//
// `TarjetaCifra` es la de las cifras de arriba (maqueta 4 y la bandeja de
// Inicio): una etiqueta pequeña y una cifra grande.

import { useId, type ReactNode } from 'react'

export type TonoTarjeta = 'normal' | 'duda' | 'ok' | 'falta'

export function Tarjeta({ titulo, apoyo, accion, tono = 'normal', nivel = 2, compacta = false, children }: {
  titulo?: ReactNode
  apoyo?: ReactNode
  accion?: ReactNode
  tono?: TonoTarjeta
  /** El nivel del encabezado (2 en una pantalla; 3 dentro de otra tarjeta). */
  nivel?: 2 | 3
  /** Sin relleno: una tabla dentro llega hasta el borde. */
  compacta?: boolean
  children?: ReactNode
}) {
  const id = useId()
  const T = nivel === 2 ? 'h2' : 'h3'
  return (
    <section className="s-tarjeta" data-tono={tono === 'normal' ? undefined : tono} data-compacta={compacta ? 'si' : undefined}
      aria-labelledby={titulo ? id : undefined}>
      {(titulo || accion) && (
        <div className="s-tarjeta-cabeza">
          <div className="s-tarjeta-titulos">
            {titulo && <T id={id} className="s-tarjeta-titulo">{titulo}</T>}
            {apoyo && <p className="s-tarjeta-apoyo">{apoyo}</p>}
          </div>
          {accion && <div className="s-tarjeta-accion">{accion}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function TarjetaCifra({ etiqueta, children, tono = 'normal', texto = false }: {
  etiqueta: string; children: ReactNode; tono?: TonoTarjeta
  /** Una frase en vez de una cifra («Todo enviado a la AEAT»): en letra de título, no de cifra. */
  texto?: boolean
}) {
  const id = useId()
  return (
    <section className="s-tarjeta s-tarjeta-cifra" data-tono={tono === 'normal' ? undefined : tono} aria-labelledby={id}>
      <h3 id={id} className="s-tarjeta-cifra-etiqueta">{etiqueta}</h3>
      <div className={texto ? 's-tarjeta-cifra-valor s-tarjeta-cifra-texto' : 's-tarjeta-cifra-valor'}>{children}</div>
    </section>
  )
}
