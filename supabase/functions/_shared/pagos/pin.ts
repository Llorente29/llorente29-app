// supabase/functions/_shared/pagos/pin.ts
//
// B01 Revolut · Las reglas del PIN de pago, sin nada más: las usan la función
// (conta-pagar, por llave.ts) y la pantalla (src/modules/conta/pagos/
// llaveNavegador.ts), con las mismas palabras.

/** Por qué no vale un PIN de pago (null si vale): 6 cifras, sin repetidas, sin seguidas y sin trozos que se repiten. */
export function motivoPin(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'El PIN de pago son 6 cifras.'
  if (/^(\d)\1{5}$/.test(pin)) return 'No sirven seis cifras iguales.'
  const d = [...pin].map(Number)
  const sube = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10), baja = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10)
  if (sube || baja) return 'No sirven cifras seguidas, como 123456.'
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return 'No sirve un PIN que repite un trozo, como 121212.'
  return null
}
