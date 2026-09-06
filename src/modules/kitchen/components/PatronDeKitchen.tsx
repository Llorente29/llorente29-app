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
