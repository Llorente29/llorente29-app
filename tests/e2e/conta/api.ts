/// <reference lib="dom" />
// tests/e2e/conta/api.ts
//
// Lo que las pruebas hacen por la API de staging-conta, con la sesión del
// usuario (la misma RLS que la pantalla): preparar lo que la pantalla no crea
// sola (una factura aprobada, una propuesta leída de una factura) y limpiar al
// terminar. Nunca con la clave de servicio.

import { STAGING_URL, anonKey, type Sesion } from './sesion'

export async function rest<T = unknown>(
  s: Sesion, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', ruta: string, cuerpo?: unknown,
): Promise<{ status: number; datos: T }> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: metodo,
    headers: {
      apikey: anonKey(),
      Authorization: `Bearer ${s.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  let datos: unknown
  try { datos = texto ? JSON.parse(texto) : null } catch { datos = texto }
  return { status: r.status, datos: datos as T }
}

/** Un CIF inventado con su dígito de control bien calculado (Orden EHA/451/2008). */
export function cifInventado(): string {
  const d7 = String(Math.floor(Math.random() * 1e7)).padStart(7, '0')
  let s = 0
  for (let i = 0; i < 7; i++) {
    const n = Number(d7[i])
    if (i % 2 === 0) { const x = n * 2; s += Math.floor(x / 10) + (x % 10) } else s += n
  }
  return `B${d7}${(10 - (s % 10)) % 10}`
}

/** Borra un proveedor de prueba y lo que cuelga de él (facturas, documentos, propuestas). */
export async function borrarProveedor(s: Sesion, supplierId: string): Promise<void> {
  const facturas = await rest<{ id: string }[]>(s, 'GET', `supplier_invoice?select=id&supplier_id=eq.${supplierId}`)
  for (const f of facturas.datos ?? []) await rest(s, 'DELETE', `supplier_invoice?id=eq.${f.id}`)
  // Los documentos: primero el fichero del bucket, después la fila.
  const docs = await rest<{ id: string; file_path: string }[]>(s, 'GET', `compliance_document?select=id,file_path&supplier_id=eq.${supplierId}`)
  for (const d of docs.datos ?? []) {
    await fetch(`${STAGING_URL}/storage/v1/object/compliance-docs/${d.file_path}`, {
      method: 'DELETE', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` },
    })
    await rest(s, 'DELETE', `compliance_document?id=eq.${d.id}`)
  }
  await rest(s, 'DELETE', `supplier?id=eq.${supplierId}`)
}
