// src/modules/conta/lib/nombreCuenta.ts
//
// C06b (16/10, Julio) · El nombre de una cuenta EN PANTALLA. Diez guarda muchas
// subcuentas en mayúsculas («PROMOCIONES GLOVO», «H.P. IVA REPERCUTIDO 10%»);
// en Libros se enseñan con mayúscula inicial («Promociones Glovo»). El dato
// guardado no se toca: esto solo cambia cómo se escribe al leerlo.
//
// Solo se toca lo que viene ENTERO en mayúsculas: un nombre con alguna
// minúscula lo escribió alguien así y se respeta tal cual. Medido en
// producción el 16/10 (Foodint, C0008, solo lectura): 100 de 790 subcuentas
// vienen enteras en mayúsculas; las otras 690 ya traen minúsculas.
//
// Cada palabra con su inicial en mayúscula (como «Promociones Glovo»: los
// nombres de plataforma, marca o proveedor son nombres propios y no se pueden
// distinguir de los comunes), salvo:
//   · las palabras de enlace, en minúscula salvo la primera («DEUDAS A CORTO
//     PLAZO CON…» → «Deudas a Corto Plazo con…»);
//   · las siglas, que se quedan como vienen: las que llevan cifras (ES47, 10%),
//     las que no tienen vocal (JGC, L/P, SL), las de letras sueltas con punto
//     (H.P., S.L.) y las conocidas (IVA, IGIC, IRPF, BBVA…).
//     «INC.», «PTE.» y «LTD.» son abreviaturas, no siglas: «Inc.», «Pte.», «Ltd.».

const ENLACE = new Set(['a', 'al', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los', 'o', 'para', 'por', 'sin', 'sobre', 'u', 'y'])
const SIGLAS = new Set(['IVA', 'IGIC', 'IRPF', 'IAE', 'IBI', 'BBVA', 'AEAT', 'TPV', 'SA', 'SAU', 'SASU', 'SLU', 'SCP', 'CB', 'UTE', 'ONG'])
const VOCAL = /[AEIOUÁÉÍÓÚÜ]/
const ABREVIATURAS_SIN_VOCAL = new Set(['LTD'])

function palabra(p: string, primera: boolean): string {
  const letras = p.replace(/[^A-ZÁÉÍÓÚÜÑÇ0-9]/g, '')
  if (!letras) return p
  const minus = p.toLocaleLowerCase('es-ES')
  if (!primera && ENLACE.has(minus)) return minus
  if (/\d/.test(p) || (!VOCAL.test(letras) && !ABREVIATURAS_SIN_VOCAL.has(letras)) || SIGLAS.has(letras) || /^([A-ZÁÉÍÓÚÑ]\.)+[A-ZÁÉÍÓÚÑ]?\.?$/.test(p)) return p
  const i = minus.search(/[a-záéíóúüñç]/)
  return i < 0 ? minus : minus.slice(0, i) + minus.charAt(i).toLocaleUpperCase('es-ES') + minus.slice(i + 1)
}

/** El nombre como se enseña: si viene entero en mayúsculas, con mayúscula inicial; si no, tal cual. */
export function nombreEnPantalla(nombre: string): string {
  if (!/[A-ZÁÉÍÓÚÜÑÇ]/.test(nombre) || /[a-záéíóúüñç]/.test(nombre)) return nombre
  let primera = true
  return nombre.split(/(\s+)/).map((t) => {
    if (!t.trim()) return t
    const r = palabra(t, primera)
    primera = false
    return r
  }).join('')
}
