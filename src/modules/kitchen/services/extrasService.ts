// src/modules/kitchen/services/extrasService.ts
//
// Lo que lee y escribe la sección «Extras» (encargo del 07/09/2026).
//
// LEER es una sola RPC, `kitchen_extras_por_nombre`, que devuelve una fila por
// nombre normalizado dentro de la cuenta. Aquí sólo se pasa de snake a camel:
// ni un cálculo, ni un texto. El castellano vive en `lib/extrasDeCocina.ts` y
// las claves de estado llegan de la base sin traducir (B83).
//
// UN FALLO NO SE DEVUELVE COMO VACÍO: si la RPC rechaza, esto lanza con el
// motivo y la pantalla lo enseña. Cero extras de una consulta denegada se lee
// como «no tienes nada que arreglar», que es lo contrario de la verdad.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type {
  ExtraPorNombre, CifrasDeExtras, CopiaDelExtra, EstadoDelExtra,
} from '@/modules/kitchen/lib/extrasDeCocina'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

type Rpc = (fn: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { message: string } | null }>

const num = (v: unknown): number => (v == null ? 0 : Number(v))
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v))

export interface LosExtras {
  medidoEn: string | null
  ventanaDias: number | null
  cifras: CifrasDeExtras
  filas: ExtraPorNombre[]
}

export async function getExtras(accountId: string): Promise<LosExtras> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as Rpc)('kitchen_extras_por_nombre', {
    p_account: accountId,
  })
  if (error) throw new Error(`No se han podido leer los extras: ${error.message}`)

  const d = (data ?? {}) as Record<string, unknown>
  const c = (d.cifras ?? {}) as Record<string, unknown>

  return {
    medidoEn: (d.medido_en as string) ?? null,
    ventanaDias: numOrNull(d.ventana_dias),
    cifras: {
      cobran: num(c.cobran),
      marcasQueCobran: num(c.marcas_que_cobran),
      conCoste: num(c.con_coste),
      sinCoste: num(c.sin_coste),
      nombres: num(c.nombres),
      nombresSinCoste: num(c.nombres_sin_coste),
      vendidosSinCoste: num(c.vendidos_sin_coste),
      vecesVendidos: num(c.veces_vendidos),
      cobradoEur: num(c.cobrado_eur),
    },
    filas: ((d.filas ?? []) as Record<string, unknown>[]).map((f) => ({
      clave: String(f.clave ?? ''),
      nombre: String(f.nombre ?? ''),
      copias: num(f.copias),
      marcas: num(f.marcas),
      vendidas: num(f.vendidas),
      cobrado: num(f.cobrado),
      precioMin: num(f.precio_min),
      precioMax: num(f.precio_max),
      preciosDistintos: f.precios_distintos === true,
      // Clave, no frase. La frase la pone `lib/` (B83).
      estado: (f.estado as EstadoDelExtra) ?? 'nada_puesto',
      costeYaPuesto: numOrNull(f.coste_ya_puesto),
      marcaQueYaLoTiene: (f.marca_que_ya_lo_tiene as string) ?? null,
      donde: ((f.donde ?? []) as Record<string, unknown>[]).map((w): CopiaDelExtra => ({
        opcion: String(w.opcion ?? ''),
        marca: String(w.marca ?? '(sin marca)'),
        marcaId: (w.marca_id as string) ?? null,
        grupo: String(w.grupo ?? ''),
        precio: num(w.precio),
        vendidas: num(w.vendidas),
        coste: num(w.coste),
        tieneCoste: w.tiene_coste === true,
      })),
    })),
  }
}
