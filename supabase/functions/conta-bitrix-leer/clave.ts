// supabase/functions/conta-bitrix-leer/clave.ts
//
// G01b · ¿La llamada trae la clave de servicio del proyecto? (para el
// recuento, que lanza un workflow desde main).
//
// El 07/11 el primer recuento salió con 403: la función solo comparaba con
// SUPABASE_SERVICE_ROLE_KEY (la clave antigua, un JWT «eyJ…») y la clave que
// pide el workflow a la API de Supabase puede ser la nueva («sb_secret_…»),
// que las funciones reciben en SUPABASE_SECRET_KEYS (un JSON con cada clave
// por su nombre: { "default": "sb_secret_…" }). Se aceptan las dos.
//
// Y si no casa, se dice QUÉ formato ha llegado y cuáles tiene la función,
// nunca la clave.

export interface ClavesDelProyecto {
  /** SUPABASE_SERVICE_ROLE_KEY: la antigua (JWT). */
  antigua: string
  /** SUPABASE_SECRET_KEYS: las nuevas, en JSON ({ "default": "sb_secret_…" }). */
  nuevas: string
}

/** Las claves con las que se puede comparar (las que no están vacías). */
export function clavesValidas(c: ClavesDelProyecto): string[] {
  const out: string[] = []
  if (c.antigua.trim()) out.push(c.antigua.trim())
  try {
    const nuevas = JSON.parse(c.nuevas || '{}') as Record<string, unknown>
    for (const v of Object.values(nuevas)) if (typeof v === 'string' && v.trim()) out.push(v.trim())
  } catch { /* sin claves nuevas legibles */ }
  return out
}

/** Comparación de tiempo constante (no dice por dónde falla). */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** El formato de una clave, en palabras, sin enseñarla. */
export function formatoDe(k: string): string {
  if (!k) return 'vacía'
  if (k.startsWith('sb_secret_')) return 'nueva (sb_secret_…)'
  if (k.startsWith('sb_publishable_')) return 'pública (sb_publishable_…), no vale'
  if (/^eyJ[^.]*\.[^.]*\.[^.]*$/.test(k)) return 'antigua (JWT)'
  return 'otro formato'
}

/** ¿Es una de las claves de servicio del proyecto? Si no, por qué (sin la clave). */
export function revisarClave(recibida: string | null, c: ClavesDelProyecto): { vale: true } | { vale: false; porque: string } {
  const r = (recibida ?? '').trim()
  const validas = clavesValidas(c)
  if (r && validas.some((v) => iguales(r, v))) return { vale: true }
  const tiene = [c.antigua.trim() ? 'la antigua (JWT)' : null, validas.length > (c.antigua.trim() ? 1 : 0) ? 'la nueva (sb_secret_…)' : null].filter(Boolean)
  return { vale: false, porque: `ha llegado una clave ${formatoDe(r)} y no es ${tiene.length ? tiene.join(' ni ') : 'ninguna: la función no tiene claves de servicio'} del proyecto` }
}
