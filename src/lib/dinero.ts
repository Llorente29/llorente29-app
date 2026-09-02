// src/lib/dinero.ts
//
// EL EURO, EN UN SOLO SITIO.
//
// Existe por un fallo concreto: `toLocaleString('es-ES', { style: 'currency',
// currency: 'EUR', maximumFractionDigits: 0 })` devuelve **«1614 €»**, sin
// separador de miles. Poner `maximumFractionDigits` a 0 desactiva la agrupación
// salvo que se pida explícitamente con `useGrouping: true`.
//
// No es un detalle tipográfico: «1614» y «1.614» se leen a velocidades
// distintas, y un panel de mando se lee de un vistazo. Estaba repetido en tres
// tarjetas, así que vive aquí y se arregla una vez.

const AGRUPADO = { style: 'currency', currency: 'EUR', useGrouping: true } as const

/** «1.614 €». Sin decimales: para cifras grandes de un panel. */
export function eurEntero(n: number): string {
  return (n ?? 0).toLocaleString('es-ES', { ...AGRUPADO, maximumFractionDigits: 0 })
}

/** «1.614,50 €» por debajo de mil; «1.614 €» por encima, donde los céntimos son ruido. */
export function eur(n: number): string {
  const v = n ?? 0
  return Math.abs(v) >= 1000 ? eurEntero(v)
    : v.toLocaleString('es-ES', { ...AGRUPADO, minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
