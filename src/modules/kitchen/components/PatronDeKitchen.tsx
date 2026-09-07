// src/modules/kitchen/components/PatronDeKitchen.tsx
//
// B79 lote 4. Las dos piezas que comparten las tres pantallas del patrón de
// Casado: la CIFRA con nombre humano y el CAMPO de la cabecera.
//
// POR QUÉ SE EXTRAEN. El patrón dice «una pregunta arriba, cinco cifras con
// nombre humano y nada más encima del contenido», y con tres pantallas escritas
// había tres copias del mismo marcado. Tres copias es una pantalla que se
// desalinea de las otras el día que alguien retoque una clase «para mejorarlo» —
// y entonces el principio 3, «aprender una es aprender todas», deja de ser cierto.
//
// EL MARCADO NO CAMBIA. Está copiado LETRA A LETRA del que ya tenía Rentabilidad,
// y hay una prueba (`patronDeKitchen.test.tsx`) que lo fija: si alguien cambia
// una clase, se pone roja antes de llegar a la pantalla de nadie. Es el mismo
// contrato que Julio puso al extraer `KpiCard`: «si algo cambia de aspecto, es un
// fallo del refactor, no una mejora».

import type { ReactNode } from 'react'

// Los tokens viajan CON el patrón, no con cada pantalla. El TPV los importa en
// su página y funciona porque es una sola; aquí van a ser varias, y una que se
// olvide de importarlos no se rompe: se pinta sin color, que es peor.
import '@/modules/kitchen/estilo/cocinaTokens.css'

/** Un campo de la cabecera: su etiqueta pequeña en mayúsculas y el control debajo. */
export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

/**
 * Una de las cinco cifras. `pie` es obligatorio a propósito: una cifra sin la
 * frase que dice de qué es no cumple el patrón — es un número sin dueño.
 *
 * `alerta` pinta el número en rojo. Es para lo que hay que arreglar, no para lo
 * que va mal: un food cost alto no es una alerta, es un dato.
 */
export function Cifra({
  titulo, valor, pie, alerta,
}: { titulo: string; valor: string; pie: string; alerta?: boolean }) {
  return (
    <div className="bg-card border border-border-default rounded-lg p-3">
      <div className="text-[11px] text-text-secondary">{titulo}</div>
      <div className={`text-2xl font-semibold mt-0.5 ${alerta ? 'text-danger' : 'text-text-primary'}`}>{valor}</div>
      <div className="text-[11px] text-text-secondary mt-1 leading-snug">{pie}</div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// EL ESTÁNDAR NUEVO (§9 del encargo de Extras, 07/09) — «limpio y pro»
// ══════════════════════════════════════════════════════════════════════════
//
// Las dos piezas de arriba se quedan COMO ESTÁN, y no por cariño: las usan el
// Resumen y Rentabilidad, y el §9.2 dice que esas pantallas pasan al estándar
// nuevo **en el lote siguiente, con captura al lado de la maqueta**. Si les
// cambiara la cifra hoy, cambiarían de aspecto sin esa comprobación y a
// medias: cifras nuevas sobre el resto del marcado viejo, que es peor que no
// tocarlas.
//
// DEUDA CON FECHA DE CIERRE, no indefinida: cuando las tres pantallas de B79
// pasen, `Campo` y `Cifra` de arriba se borran y estas dos se quedan solas.
// Mientras tanto conviven, y el nombre lo dice.
//
// Todo lo de aquí abajo pinta con los tokens de `cocinaTokens.css`, que sólo
// existen dentro de `.cocina-2`. Fuera de esa clase estos componentes salen
// sin color: es a propósito — obliga a envolver la pantalla, que es justo lo
// que hace la migración explícita en vez de silenciosa.

/** Un campo de la cabecera, en el estándar de la maqueta. */
export function CampoCocina({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.08em] text-cocina-tinta-3 font-medium">{label}</span>
      {children}
    </label>
  )
}

/**
 * Una de las cifras de la cabecera.
 *
 * `pie` sigue siendo obligatorio, por lo mismo que en la de arriba: una cifra
 * sin la frase que dice de qué es no cumple el patrón. Y aquí importa el doble,
 * porque hoy mismo se vio: «en 18 marcas» bajo los 120 extras contaba las
 * marcas de la cuenta, no las de los extras. El pie es donde se caza eso.
 *
 * El número va en monoespaciada tabular (§9.1): los céntimos alineados son
 * seña de la casa, y una columna de importes que baila se lee peor.
 */
export function CifraCocina({
  titulo, valor, pie, alerta,
}: { titulo: string; valor: string; pie: string; alerta?: boolean }) {
  return (
    <div className="bg-cocina-superficie border border-cocina-linea rounded-cocina px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.08em] text-cocina-tinta-3 font-medium">{titulo}</div>
      <div className={`font-mono text-[26px] leading-none font-semibold mt-2 ${alerta ? 'text-cocina-rojo' : 'text-cocina-tinta'}`}>
        {valor}
      </div>
      <div className="text-[11px] text-cocina-tinta-2 mt-2 leading-snug">{pie}</div>
    </div>
  )
}

/**
 * La pastilla de estado. Tres colores y ninguno más: lo que hay que arreglar
 * (rojo), lo que está a medias (ámbar) y lo que ya está (verde).
 */
export function PastillaCocina({
  tono, children,
}: { tono: 'rojo' | 'ambar' | 'verde'; children: ReactNode }) {
  const clases = {
    rojo:  'bg-cocina-rojo-bg text-cocina-rojo',
    ambar: 'bg-cocina-ambar-bg text-cocina-ambar',
    verde: 'bg-cocina-verde-bg text-cocina-verde',
  }[tono]
  return (
    <span className={`inline-flex items-center rounded-cocina px-2 py-[3px] text-[11px] font-medium ${clases}`}>
      {children}
    </span>
  )
}

/**
 * El botón. Tres pesos, 34 px de alto (§9.1): relleno de acento para la acción
 * de la fila, borde para la secundaria, fantasma para lo que casi no se usa.
 */
export function BotonCocina({
  peso = 'relleno', disabled, onClick, children, type = 'button',
}: {
  peso?: 'relleno' | 'borde' | 'fantasma'
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  type?: 'button' | 'submit'
}) {
  const clases = {
    relleno:  'bg-cocina-acento text-white hover:bg-cocina-acento-hover border border-transparent',
    borde:    'bg-cocina-superficie text-cocina-tinta border border-cocina-linea hover:bg-cocina-acento-bg',
    fantasma: 'bg-transparent text-cocina-tinta-2 border border-transparent hover:bg-cocina-acento-bg',
  }[peso]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 h-[34px] px-3.5 rounded-cocina text-[13px] font-medium transition-base disabled:opacity-45 disabled:cursor-not-allowed ${clases}`}
    >
      {children}
    </button>
  )
}

/**
 * La cabecera del patrón: la pregunta y, debajo, la línea de regla.
 *
 * La línea de regla no es un subtítulo decorativo: es donde la pantalla dice
 * QUÉ está contando, en castellano de persona. Es la lección de B83, donde las
 * cinco filas del Resumen pintaban `price_impact > 0` en cursiva.
 */
export function CabeceraCocina({
  pregunta, regla, children,
}: { pregunta: string; regla: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 flex-wrap">
      <div className="min-w-0 max-w-3xl">
        <h1 className="font-display text-[22px] leading-tight font-semibold text-cocina-tinta">{pregunta}</h1>
        <p className="text-[12px] text-cocina-tinta-2 mt-1.5 leading-relaxed">{regla}</p>
      </div>
      {children && <div className="flex items-end gap-4 shrink-0">{children}</div>}
    </div>
  )
}
