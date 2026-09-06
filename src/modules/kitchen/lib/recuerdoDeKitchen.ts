// src/modules/kitchen/lib/recuerdoDeKitchen.ts
//
// B79 · lote 3 (06/09/2026). Qué recuerda Kitchen entre visitas, y con qué
// alcance cada cosa.
//
// LA MARCA ES DEL MÓDULO. Una sola clave para las catorce pantallas. El selector
// de marca está en el mismo sitio en todas precisamente para que aprender una sea
// aprender todas; si eliges Meraki en Rentabilidad y al pasar a Ingeniería
// aparece Scandal de la semana pasada, la persona no piensa «se acordó de mi
// última visita»: piensa que se ha equivocado de pantalla. (Corrección de Julio,
// 06/09, sobre una primera versión que guardaba la marca por pantalla.)
//
// EL PERIODO ES DE CADA PANTALLA. 30 días en el Resumen y 90 en Ingeniería no son
// el mismo ajuste mal sincronizado: son preguntas distintas. El Resumen pregunta
// «cómo va este mes» y la matriz necesita un trimestre para que la media
// signifique algo.
//
// Y si no hay recuerdo, se abre en una marca TUYA, nunca en la primera por
// alfabeto — eso lo decide quien llama, que es el único que tiene la lista.
//
// `localStorage` puede fallar entero (ventana privada, cookies bloqueadas): todo
// va en try/catch y sin recuerdo la pantalla funciona igual.

const CLAVE_MARCA = 'folvy.kitchen.marca'
const CLAVE_PERIODO = 'folvy.kitchen.periodo.'

/** La marca elegida, compartida por todo el módulo. */
export function leeMarcaRecordada(): string | null {
  try { return localStorage.getItem(CLAVE_MARCA) } catch { return null }
}

export function guardaMarcaRecordada(brandId: string | null): void {
  try {
    if (brandId) localStorage.setItem(CLAVE_MARCA, brandId)
    else localStorage.removeItem(CLAVE_MARCA)
  } catch { /* sin recuerdo, la pantalla funciona igual */ }
}

/** El periodo, de CADA pantalla. `pantalla` es un nombre corto y estable. */
export function leePeriodoRecordado(pantalla: string, porDefecto: number): number {
  try {
    const v = Number(localStorage.getItem(CLAVE_PERIODO + pantalla))
    return Number.isFinite(v) && v > 0 ? v : porDefecto
  } catch { return porDefecto }
}

export function guardaPeriodoRecordado(pantalla: string, dias: number): void {
  try { localStorage.setItem(CLAVE_PERIODO + pantalla, String(dias)) } catch { /* idem */ }
}

/**
 * Con qué marca abre una pantalla: la recordada si sigue viva, si no una TUYA, y
 * sólo en último caso la primera que haya.
 */
export function marcaConLaQueAbrir<T extends { id: string; ownershipType?: string | null }>(
  marcas: T[],
): T | null {
  const recordada = leeMarcaRecordada()
  return (
    marcas.find((m) => m.id === recordada) ??
    marcas.find((m) => m.ownershipType === 'own') ??
    marcas[0] ??
    null
  )
}
