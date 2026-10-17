// src/modules/conta/ui/fecha/fecha.ts
//
// M01 · Las fechas de las piezas, en dd/mm/aaaa y en español, sin depender del
// idioma del navegador (Julio, 16/10: el <input type="date"> pintaba
// «mm/dd/yyyy» en un Chrome en inglés). Por dentro siguen siendo ISO
// («2026-10-16»), que es lo que guardan los filtros y lo que va a la base.

/** «2026-10-16» → «16/10/2026»; lo que no es una fecha ISO, vacío. */
export function aTexto(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * Lo que se escribe, con las barras puestas solas: «1610» → «16/10»,
 * «16102026» → «16/10/2026». Solo cifras y como mucho ocho.
 */
export function enmascarar(t: string): string {
  // Si ya trae barras y cada trozo cabe («1/2/2026», «16/1»), se respetan.
  // Si un trozo se pasa («16/102»), se vuelve a partir por cifras: «16/10/2».
  const trozos = t.split('/').map((x) => x.replace(/\D/g, ''))
  if (trozos.length > 1 && trozos.length <= 3 && trozos.every((x, i) => x.length <= (i === 2 ? 4 : 2))) return trozos.join('/')
  const c = t.replace(/\D/g, '').slice(0, 8)
  if (c.length <= 2) return c
  if (c.length <= 4) return `${c.slice(0, 2)}/${c.slice(2)}`
  return `${c.slice(0, 2)}/${c.slice(2, 4)}/${c.slice(4)}`
}

/**
 * Lo escrito → la fecha ISO. Vacío → '' (sin fecha). A medias o imposible
 * (31/02/2026) → null: no se cambia el valor hasta que esté entera y bien.
 * Admite el día y el mes con una cifra («1/2/2026»).
 */
export function deTexto(t: string): string | null {
  const s = t.trim()
  if (s === '') return ''
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (!m) return null
  const d = Number(m[1]), mes = Number(m[2]), a = Number(m[3])
  if (mes < 1 || mes > 12 || d < 1) return null
  const ultimo = new Date(Date.UTC(a, mes, 0)).getUTCDate()
  if (d > ultimo) return null
  return `${String(a).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Escrito entero y mal: «31/02/2026» o «16/13/2026». A medias no cuenta como mal. */
export function fechaMal(t: string): boolean {
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t.trim()) && deTexto(t) === null
}
