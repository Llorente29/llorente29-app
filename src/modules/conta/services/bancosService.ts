// src/modules/conta/services/bancosService.ts
//
// B01 · Bancos en la app: el núcleo (bancosNucleo.ts) con la base de la app
// (services/bd.ts), y abrir el fichero que se suelta en «Subir extracto».

import * as XLSX from 'xlsx'
import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { crearBancos, type Bd, type Consulta, type ExtractoAbierto } from '@/modules/conta/services/bancosNucleo'

export { emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
export type { BancoFolvy, ExtractoAbierto, ResultadoConciliar, ResultadoImportar } from '@/modules/conta/services/bancosNucleo'

const bd: Bd = { tabla: (t) => tabla(t) as unknown as Consulta, rpc, mensaje: (p, e) => mensaje(p, e as Parameters<typeof mensaje>[1]) }
export const bancos = crearBancos(bd)

/** Abre el fichero en el navegador: nada sale del dispositivo hasta importar. */
export async function abrirExtracto(f: File): Promise<ExtractoAbierto> {
  const bytes = await f.arrayBuffer()
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const ext = f.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'xlsx' || ext === 'xls') {
    const libro = XLSX.read(bytes, { type: 'array', cellDates: false })
    const hoja = libro.Sheets[libro.SheetNames.find((h) => (libro.Sheets[h]['!ref'] ?? '') !== '') ?? libro.SheetNames[0]]
    const filas = (XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' }) as unknown[][]).map((r) => r.map((c) => String(c ?? '')))
    return { nombre: f.name, sha256, contenido: { filas } }
  }
  // Norma 43 y CSV: UTF-8 si lo es; si no, Windows-1252 (los bancos lo mandan así a menudo).
  let texto: string
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { texto = new TextDecoder('windows-1252').decode(bytes) }
  return { nombre: f.name, sha256, contenido: { texto } }
}

