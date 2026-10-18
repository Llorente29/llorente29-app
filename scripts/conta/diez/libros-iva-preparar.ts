// scripts/conta/diez/libros-iva-preparar.ts
//
// I01b · Los libros de IVA de Diez · paso 1: leer (solo GET) y preparar.
// Lee las facturas de la base de Diez de la empresa de un mes a otro, día a
// día (libros-iva-mapeo.ts: sin repetir ni saltar), las convierte en filas
// del libro de IVA de Sumied y las deja en $CARGA/libro.jsonl (una por línea) para
// libros-iva-importar.sql. El fichero lleva datos reales (NIF, nombres): se
// queda en el disco temporal del runner; a la salida solo van recuentos
// («@@ clave número», por salida-segura.mjs).
//
// Para (sale con 1) si algo no deja garantizar que se trae TODO: un día que
// no contesta, un tramo de documento que llena la página, una clave repetida
// con contenido distinto o una factura que no se sabe convertir.
//
//   DIEZ_LECTURA='{…}' DIEZ_BD=C0008 DIEZ_DESDE=202601 DIEZ_HASTA=202609 \
//   FECHA_RECIBIDA=asiento CARGA=/tmp/carga npx tsx scripts/conta/diez/libros-iva-preparar.ts

import { mkdirSync, writeFileSync } from 'node:fs'
import { ClienteDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente.ts'
import { filasDeFactura, leerFacturas, type FechaRecibida, type FilaLibro } from './libros-iva-mapeo.ts'

const sale = (k: string, v: number | string) => process.stdout.write(`@@ ${k} ${v}\n`)

async function main() {
  const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
  const bd = process.env.DIEZ_BD || ''
  const desde = process.env.DIEZ_DESDE || '', hasta = process.env.DIEZ_HASTA || ''
  const fecha = (process.env.FECHA_RECIBIDA || '') as FechaRecibida
  const carga = process.env.CARGA || ''
  if (!cred || !/^C\d{4}$/.test(bd) || bd === 'C0001' || !/^\d{6}$/.test(desde) || !/^\d{6}$/.test(hasta) || !['asiento', 'introduccion'].includes(fecha) || !carga) {
    sale('faltan_entradas', 1); process.exit(1)
  }
  let guardado: { token: string; expiresAt: string } | null = null
  const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
  const c = new ClienteDiez({
    base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: bd,
    credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
    almacen, escribir: false, pausaMs: 150,
  })
  try { await c.asegurarToken() } catch { sale('entra_en_diez', 0); process.exit(1) }

  const l = await leerFacturas(c, desde, hasta)
  sale('dias_leidos', l.dias); sale('dias_sin_contestar', l.sinContestar.length); sale('dias_con_la_pagina_llena', l.diasLlenos)
  sale('tramos_de_documento_llenos', l.tramosLlenos); sale('filas_leidas', l.filas); sale('facturas', l.facturas.length)
  sale('claves_repetidas', l.repetidas); sale('claves_repetidas_con_contenido_distinto', l.repetidasDistintas)

  const filas: FilaLibro[] = []
  let noSeConvierten = 0
  for (const f of l.facturas) {
    try { filas.push(...filasDeFactura(f as Record<string, unknown>, fecha)) } catch { noSeConvierten++ }
  }
  sale('facturas_que_no_se_convierten', noSeConvierten)
  for (const lib of ['issued', 'received', 'not_subject']) sale(`filas_${lib}`, filas.filter((x) => x.libro === lib).length)
  mkdirSync(carga, { recursive: true })
  // Una fila por línea (JSON Lines): libros-iva-importar.sql la lee con \copy.
  writeFileSync(`${carga}/libro.jsonl`, filas.map((x) => JSON.stringify(x)).join('\n') + '\n')
  sale('peticiones', c.metrica.peticiones)

  // Nada se trae a medias: si no se ha leído todo, o algo no se convierte, para.
  if (l.sinContestar.length || l.tramosLlenos || l.repetidasDistintas || noSeConvierten) { sale('para', 1); process.exit(1) }
}

if (process.argv[1] && process.argv[1].endsWith('libros-iva-preparar.ts')) await main()
