// src/modules/kitchen/components/AllergenIcon.tsx
//
// Icono OFICIAL de un alérgeno (Reglamento UE 1169/2011, Anexo II).
//
// Pinta el pictograma oficial reconocible (círculo de color + símbolo + nombre
// del alérgeno impreso en el propio icono). Esto cumple el requisito legal de
// "icono + leyenda" sin texto añadido: el inspector lee el nombre en el icono.
//
// Los assets viven en public/allergens/allergen-{code}.png, nombrados por el
// CÓDIGO ESTABLE de la BBDD (allergen.code: gluten, milk, soy, ...). El nombre
// de fichero casa 1:1 con AllergenCode (lib/allergens), así que basta el código.
//
// Nota de impresión: en pegatina térmica monocroma el color del círculo se
// imprime en gris, pero el pictograma y el nombre quedan legibles (que es lo que
// la ley exige). En impresora a color, el color sale solo.

import type { AllergenCode } from '../lib/allergens'
import { allergenLabel } from '../lib/allergens'

interface Props {
  code: AllergenCode
  /** Lado del icono en px. Por defecto 24 (uso inline en listas/pegatina). */
  size?: number
  /** Clase extra opcional. */
  className?: string
}

/** Pinta el icono oficial de un alérgeno por su código. */
export default function AllergenIcon({ code, size = 24, className }: Props) {
  const label = allergenLabel(code, 'es')
  return (
    <img
      src={`/allergens/allergen-${code}.png`}
      alt={label}
      title={label}
      width={size}
      height={size}
      loading="lazy"
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block' }}
    />
  )
}
