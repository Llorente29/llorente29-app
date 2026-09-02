// src/shell/home/informes/informesService.ts
//
// Los informes del Inicio. Dos, y los dos con fuente REAL.
//
// ── LO QUE NO SE PINTA, Y POR QUÉ ──────────────────────────────────────────
// La maqueta traía cuatro chips y una coletilla de programación («lunes 8:00»,
// «mensual»). Se publican DOS:
//
//   · Registro de jornada PDF — la fuente existe (`clock_entries`, 323 fichajes
//     en 30 días) pero NO hay generador de PDF en el front. Como CSV
//     funcionaría; como PDF, no. Un chip que promete PDF y baja otra cosa es un
//     botón que no cumple.
//   · Liquidación CTB por plataforma — hay TRES tablas de settlement y no está
//     decidido cuál manda. Bajar la equivocada es peor que no bajar nada.
//
// Y LA PROGRAMACIÓN AL CORREO NO EXISTE. Ni cola, ni horario, ni envío.
// Pintar «lunes 8:00» sería exactamente lo que se acaba de quitar de las P2:
// una promesa con aspecto de función.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { diaDelNegocio, lunesDeLaSemana, diaNatural } from '@/lib/fechas'
import {
  getNegativeStockReport, negativeStockCauseLabel,
} from '@/modules/supply/services/negativeStockService'

export interface FilaInforme { [col: string]: unknown }

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/** Ventas de la semana en curso, una fila por venta. */
export async function ventasDeLaSemana(
  accountId: string, locationId: string | null,
): Promise<FilaInforme[]> {
  const lunesYmd = lunesDeLaSemana(new Date())
  const [y, m, d] = lunesYmd.split('-').map(Number)
  const lunes = diaDelNegocio(new Date(Date.UTC(y, m - 1, d, 12)))
  const hoy = diaDelNegocio(new Date())

  let q = sb().from('sale')
    // `sale` NO tiene columna `channel`: tiene `channel_id` y
    // `external_channel_text`. Para un CSV que va a leer una persona vale la
    // segunda, que ya viene con el nombre de la plataforma.
    .select('sold_at, total, location_id, external_channel_text, order_status')
    .eq('account_id', accountId)
    .gte('sold_at', lunes.desde.toISOString())
    .lt('sold_at', hoy.hasta.toISOString())
    .order('sold_at')
  if (locationId) q = q.eq('location_id', locationId)

  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer las ventas: ${error.message}`)

  const locales = await nombresDeLocal(accountId)
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    // La fecha va en hora del NEGOCIO, no en UTC: si no, el fichero de una
    // venta de las 00:15 dice que fue de ayer y nadie entiende el total.
    fecha: diaNatural(new Date(String(r.sold_at))),
    hora: new Date(String(r.sold_at)).toLocaleTimeString('es-ES',
      { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }),
    local: locales.get(String(r.location_id)) ?? 'Sin local',
    canal: r.external_channel_text ?? '',
    estado: r.order_status ?? '',
    importe: Number(r.total) || 0,
  }))
}

/**
 * Artículos con stock por debajo de cero.
 *
 * Sale de `getNegativeStockReport`, el servicio que YA usa la pantalla de
 * Almacén — no de una consulta nueva. Fue un acierto mirarlo antes: la primera
 * versión de esto consultaba una tabla `item_stock` que NO EXISTE. Y además el
 * servicio trae la CAUSA de cada negativo y si cruza el umbral anti-ruido, que
 * es información que una consulta a mano no habría traído.
 *
 * El informe lleva TODOS los negativos, crucen el umbral o no, con una columna
 * que lo dice. Es un fichero que alguien abre a propósito: el umbral ordena y
 * etiqueta, no decide la existencia de la fila (regla 7).
 */
export async function stockNegativo(
  accountId: string, locationId: string | null,
): Promise<FilaInforme[]> {
  const locales = await nombresDeLocal(accountId)
  const objetivo = locationId ? [locationId] : [...locales.keys()]

  const filas: FilaInforme[] = []
  for (const loc of objetivo) {
    const rep = await getNegativeStockReport(accountId, loc)
    for (const it of rep.items) {
      filas.push({
        articulo: it.name,
        local: locales.get(loc) ?? 'Sin local',
        cantidad: it.qtyOnHand,
        unidad: it.unitAbbr ?? '',
        valor_eur: it.valueEur,
        causa: negativeStockCauseLabel(it.cause),
        cruza_umbral: it.isAlert ? 'sí' : 'no',
      })
    }
  }
  // Lo más negativo primero: es por donde se empieza a arreglar.
  return filas.sort((a, b) => Number(a.cantidad) - Number(b.cantidad))
}

async function nombresDeLocal(accountId: string): Promise<Map<string, string>> {
  const { data } = await sb().from('locations').select('id, name').eq('account_id', accountId)
  return new Map(((data ?? []) as { id: string; name: string }[]).map(l => [l.id, l.name]))
}
