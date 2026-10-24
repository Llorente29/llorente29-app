// supabase/functions/_shared/euros.ts
//
// «964,40 €»: el importe con dos decimales y punto de miles siempre (sin Intl:
// en es-ES no agrupa las cifras de cuatro dígitos). Lo usan el front
// (src/modules/conta/lib/formato.ts lo reexporta) y el servidor (el cruce de
// Catcher en conta-lote-releer).

function miles(entero: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Importe siempre con dos decimales, para listas de facturas («964,40 €»). */
export function eurosExactos(n: number): string {
  const negativo = n < 0
  const centimos = Math.round(Math.abs(n) * 100)
  const entero = Math.floor(centimos / 100)
  const resto = centimos % 100
  return `${negativo ? '−' : ''}${miles(String(entero))},${String(resto).padStart(2, '0')} €`
}
