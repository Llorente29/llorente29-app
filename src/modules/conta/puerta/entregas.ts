// src/modules/conta/puerta/entregas.ts
//
// V02 · El buzón de ficheros entre pantallas, en memoria (no se guarda nada):
//   · soltar un fichero en CUALQUIER pantalla de contabilidad lo deja aquí para
//     la puerta, que lo abre al llegar (Marco.tsx);
//   · la puerta deja aquí el extracto para Bancos, que lo abre en «Subir
//     extracto» por su camino de siempre (BancosPage.tsx).
// Se toma una vez: quien lo coge lo vacía.

export type Destino = 'puerta' | 'bancos'

const buzon: Record<Destino, File[]> = { puerta: [], bancos: [] }

export function dejarFicheros(destino: Destino, fs: readonly File[]): void {
  buzon[destino] = [...fs]
}

export function tomarFicheros(destino: Destino): File[] {
  const fs = buzon[destino]
  buzon[destino] = []
  return fs
}

/** Mira sin tomar (para un useState inicial, que React puede llamar dos veces): luego, `tomarFicheros`. */
export function mirarFicheros(destino: Destino): File[] {
  return [...buzon[destino]]
}

/** ¿Lleva ficheros lo que se arrastra? (no un texto ni un enlace). */
export const llevaFicheros = (tipos: readonly string[] | DOMStringList | null | undefined): boolean =>
  !!tipos && Array.from(tipos as ArrayLike<string>).includes('Files')
