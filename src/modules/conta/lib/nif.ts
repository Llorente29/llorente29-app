// src/modules/conta/lib/nif.ts
//
// NIF, NIE y CIF españoles: validación con su carácter de control.
//
// FUNCIONES PURAS. Ni red, ni base, ni React: se usan igual en web, en la app
// y en las pruebas de cumplimiento (tests/conta/cumplimiento/).
//
// ── LOS TRES ALGORITMOS (fuente: normativa, no memoria) ─────────────────────
//
// NIF de persona física (DNI + letra). Orden INT/2058/2008 y RD 1553/2005:
//   letra = 'TRWAGMYFPDXBNJZSQVHLCKE'[número mod 23].
//
// NIE (extranjeros). Orden INT/2058/2008: la letra inicial X/Y/Z vale 0/1/2,
//   se antepone al número y se calcula la letra igual que en el NIF.
//
// NIF de persona jurídica (el antiguo CIF). Orden EHA/451/2008, art. 3:
//   - 1.ª letra: forma jurídica (A sociedad anónima, B limitada, …).
//   - 7 dígitos.
//   - carácter de control, calculado así:
//       suma A = dígitos en posición par (2.º, 4.º, 6.º)
//       suma B = para cada dígito en posición impar (1.º, 3.º, 5.º, 7.º),
//                dígito × 2 y se suman las cifras del resultado
//       C = A + B;  control = (10 − C mod 10) mod 10
//   - El control es una LETRA ('JABCDEFGHI'[control]) para P, Q, R, S, N, W;
//     un DÍGITO para A, B, E, H; y para el resto vale cualquiera de los dos.
//
// NIF especiales de persona física (K, L, M): K menores de 14, L residentes en
//   el extranjero sin NIE, M extranjeros sin NIE. Llevan 7 dígitos y la letra
//   del NIF, calculada sobre los 7 dígitos (sin la inicial).

export type TipoNifEs = 'nif' | 'nie' | 'cif' | 'nif_especial'

export type ResultadoNif =
  | { ok: true; tipo: TipoNifEs; normalizado: string }
  | { ok: false; motivo: string }

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'
const LETRAS_CIF = 'JABCDEFGHI'

/** Quita espacios, guiones y puntos, y pasa a mayúsculas. Un "ES" delante se quita. */
export function normalizarNif(entrada: string): string {
  const s = entrada.toUpperCase().replace(/[\s.\-_/]/g, '')
  return s.startsWith('ES') && s.length === 11 ? s.slice(2) : s
}

function letraDni(numero: number): string {
  return LETRAS_DNI[numero % 23]
}

function controlCif(siete: string): number {
  let a = 0
  let b = 0
  for (let i = 0; i < 7; i++) {
    const d = Number(siete[i])
    if (i % 2 === 1) a += d
    else {
      const x = d * 2
      b += Math.floor(x / 10) + (x % 10)
    }
  }
  return (10 - ((a + b) % 10)) % 10
}

/**
 * Valida un NIF, NIE o CIF español. El motivo del fallo va en lenguaje normal,
 * para enseñarlo tal cual debajo del campo.
 */
export function validarNifEs(entrada: string): ResultadoNif {
  const s = normalizarNif(entrada)
  if (s === '') return { ok: false, motivo: 'Escribe el NIF.' }
  if (s.length !== 9) return { ok: false, motivo: 'Un NIF español tiene 9 caracteres.' }

  // NIF de persona física: 8 dígitos + letra.
  if (/^\d{8}[A-Z]$/.test(s)) {
    return letraDni(Number(s.slice(0, 8))) === s[8]
      ? { ok: true, tipo: 'nif', normalizado: s }
      : { ok: false, motivo: 'La letra no corresponde a ese número: revisa el NIF.' }
  }

  // NIE: X/Y/Z + 7 dígitos + letra.
  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) {
    const n = Number('XYZ'.indexOf(s[0]) + s.slice(1, 8))
    return letraDni(n) === s[8]
      ? { ok: true, tipo: 'nie', normalizado: s }
      : { ok: false, motivo: 'La letra no corresponde a ese NIE: revisa los números.' }
  }

  // NIF especial de persona física: K/L/M + 7 dígitos + letra.
  if (/^[KLM]\d{7}[A-Z]$/.test(s)) {
    return letraDni(Number(s.slice(1, 8))) === s[8]
      ? { ok: true, tipo: 'nif_especial', normalizado: s }
      : { ok: false, motivo: 'La letra no corresponde a ese NIF: revisa los números.' }
  }

  // NIF de persona jurídica: letra de forma jurídica + 7 dígitos + control.
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
    const c = controlCif(s.slice(1, 8))
    const comoDigito = String(c)
    const comoLetra = LETRAS_CIF[c]
    const ultimo = s[8]
    const soloLetra = 'PQRSNW'.includes(s[0])
    const soloDigito = 'ABEH'.includes(s[0])
    const ok = soloLetra ? ultimo === comoLetra
      : soloDigito ? ultimo === comoDigito
      : ultimo === comoLetra || ultimo === comoDigito
    return ok
      ? { ok: true, tipo: 'cif', normalizado: s }
      : { ok: false, motivo: 'El carácter de control no cuadra: revisa el NIF de la empresa.' }
  }

  return { ok: false, motivo: 'No tiene la forma de un NIF, NIE o CIF español.' }
}

/** Sociedad o autónomo, deducido del NIF cuando se puede. null = no se sabe. */
export function tipoEntidadPorNif(normalizado: string): 'company' | 'self_employed' | null {
  if (/^\d{8}[A-Z]$/.test(normalizado) || /^[XYZKLM]/.test(normalizado)) return 'self_employed'
  if (/^[ABCDEFGHJNPQRSUVW]/.test(normalizado)) return 'company'
  return null
}
