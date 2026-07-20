// src/modules/printing/pairingUtils.ts
//
// Utilidades de emparejamiento de la Estación (F3). Separadas del componente
// para no romper el fast-refresh (react-refresh/only-export-components).

/** Saca el token de un QR/pegado: de una URL `?token=…` o de un token en crudo. */
export function extractToken(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  try {
    const url = new URL(v)
    const t = url.searchParams.get('token')
    if (t) return t.trim()
  } catch { /* no era una URL: se trata como token en crudo */ }
  return v
}
