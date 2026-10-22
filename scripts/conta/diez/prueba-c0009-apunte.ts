// scripts/conta/diez/prueba-c0009-apunte.ts
//
// C07 · UN ASIENTO DE BANCO INVENTADO de Sumied en la C0009 (la copia de
// pruebas), leído de vuelta, y SU CONTRAASIENTO, leído de vuelta. Escribe en la
// C0009: SOLO con el «sí» de Julio (las anteriores que escribieron lo llevaron,
// I01f). Sin él, no se lanza.
//
// Es la cadena de Sumied: el asiento de Diez sale de apunteDeAsiento y lo manda
// enviarApunteADiez (_shared/diezEnviar.ts), con sus frenos (nunca dos veces,
// las subcuentas, la intención antes de escribir), sobre un puerto en memoria.
// Lo que mide, para quitar lo que aún no está medido:
//   · que apuntes/add acepta el ApunteSimplificado y qué Documento le da;
//   · si la respuesta trae el Documento o hay que buscarlo;
//   · que se lee de vuelta igual (fecha, serie, líneas);
//   · el contraasiento: las mismas cuentas al revés, otro Documento;
//   · que otra pasada no escribe otro (se enlaza).
// Importes inventados: 1,23 € entre la 57200000 y la 55500000 de la C0009 (si
// alguna no está, no se manda y lo dice). Fecha: hoy.
//
// Frenos: la base es C0009; el cliente no escribe en C0008 sin escribirEnReal,
// que no se pasa; la C0001 ni se abre. Salida solo «@@ clave número».
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-apunte.ts

import { ClienteDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'
import { enviarApunteADiez, type EnvioFila, type PuertoApunte } from '../../../supabase/functions/_shared/diezEnviar.ts'
import { esElMismoApunte, apunteDeAsiento, unoPorAsiento, type AsientoBD } from '../../../supabase/functions/_shared/diezApunte.ts'
import { createHash } from 'node:crypto'

const BD = 'C0009'
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: true, pausaMs: 150,
})

const banco: AsientoBD = {
  id: 'c07-prueba-banco', account_id: 'prueba', company_id: 'prueba', estado: 'validado', origen: 'bank', serie: 4, numero: 1, fecha: hoy,
  concepto: 'SUMIED C07 prueba de banco', anula: null, anulaOrigen: null,
  lineas: [{ cuenta: '57200000', debe: 1.23, haber: 0, concepto: null }, { cuenta: '55500000', debe: 0, haber: 1.23, concepto: null }],
}
const contra: AsientoBD = { ...banco, id: 'c07-prueba-contra', origen: 'reversal', numero: 2, concepto: 'SUMIED C07 prueba · anula la de banco', anula: banco.id, anulaOrigen: 'bank',
  lineas: banco.lineas.map((l) => ({ ...l, debe: l.haber, haber: l.debe })) }

const envios: Record<string, EnvioFila> = {}
const p: PuertoApunte = {
  envio: async (id) => envios[id] ?? null,
  guardar: async (f) => { const x = { ...f, id: f.id ?? f.entry_id }; envios[f.entry_id] = x; return x },
  conexion: async () => ({ id: 'prueba', nombreBd: BD }),
  autorizado: async () => false,
  clienteApuntes: async () => c,
  sha256: async (b) => createHash('sha256').update(b).digest('hex'),
  ahora: () => new Date(),
}

async function leerDeVuelta(nombre: string, a: AsientoBD) {
  const ap = apunteDeAsiento(a)
  const vuelta = unoPorAsiento((await c.apuntesDelMes(String(ap.Fecha).slice(0, 6))).filter(esElMismoApunte(ap)))
  di(`${nombre}.leido_de_vuelta`, vuelta.length)
  const v = vuelta[0] as Apunte | undefined
  if (v) {
    di(`${nombre}.serie`, Number(v.Serie))
    di(`${nombre}.tipo_asiento`, Number(v.TipoAsiento ?? -1))
    di(`${nombre}.lineas`, (v.Detalles ?? []).length)
    di(`${nombre}.documento_igual_al_apuntado`, Number(v.Documento) === Number(envios[a.id]?.ext_number))
  }
}

try {
  await c.asegurarToken()
  seccion('banco')
  const r1 = await enviarApunteADiez(banco, p)
  di('banco.en_diez', r1.estado === 'en_diez')
  if (r1.estado === 'en_diez') { di('banco.documento', r1.documento); di('banco.enlazado', r1.enlazada) }
  else console.log(`Parado: ${r1.motivo.replace(/[0-9]{6,}/g, '#')}`)
  await leerDeVuelta('banco', banco)

  seccion('contraasiento')
  const r2 = await enviarApunteADiez(contra, p)
  di('contra.en_diez', r2.estado === 'en_diez')
  if (r2.estado === 'en_diez') { di('contra.documento', r2.documento); di('contra.otro_documento', r2.documento !== (r1.estado === 'en_diez' ? r1.documento : -1)) }
  await leerDeVuelta('contra', contra)

  seccion('otra_pasada')
  // Sin lo apuntado: tiene que encontrarlo en Diez y enlazarlo, no escribir otro.
  delete envios[banco.id]
  const r3 = await enviarApunteADiez(banco, p)
  di('otra.enlazado', r3.estado === 'en_diez' && r3.enlazada)
} catch (e) {
  console.log(`Parado: ${(e as Error).message.replace(/[0-9]{6,}/g, '#')}`)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
