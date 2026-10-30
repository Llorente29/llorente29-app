// src/modules/conta/services/puertaService.ts
//
// V02 · Entrega 1 · Lo que habla la puerta (Inicio › Documentos) con la base.
// Cada paso que escribe devuelve lo que ha hecho, en una frase (regla 8).
//
//   · Leer: conta_puerta (la dirección, lo conectado y lo último) y
//     conta_puerta_fuentes (las fuentes con sus llegadas y los ajustes).
//   · La dirección única: conta_direccion_entrada con «facturas» (S01c; la crea si
//     no la hay; la misma función que las de facturas y liquidaciones).
//   · Aprender las fuentes: conta_puerta_fuentes_proponer y, una a una,
//     conta_puerta_fuente_guardar (lo que ya está guardado no se pisa).
//   · «Dime qué es», «Pedírsela», apagar una fuente o «Lo que falta».
//   · V02d: al día (el ritmo de lo aprendido, salvo el que fijó una persona), «Ya lo tengo», no avisar,
//     el local de una fila y «Añadir algo que espero».
//   · Subir sin saber qué es: el fichero a conta-entrada y conta_puerta_subida.
//     Las facturas, la quincena de Catcher y los extractos van por sus caminos
//     de siempre (documentosService, catcherService, Bancos), no por aquí.

import { supabase } from '@/lib/supabase'
import { hayBase, rpc } from '@/modules/conta/services/bd'
import { nombreDelLocal, type DatosFuentes, type DatosPuerta, type Local, type QueEs } from '@/modules/conta/lib/puerta'

const ALMACEN = 'conta-entrada'
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export const leerPuerta = (companyId: string, dias = 30) => rpc<DatosPuerta>('conta_puerta', { p_company: companyId, p_dias: dias })
export const leerFuentes = (companyId: string) => rpc<DatosFuentes>('conta_puerta_fuentes', { p_company: companyId })

/**
 * La dirección única de la empresa: la que ya tiene o una nueva. S01c (Julio,
 * 29/10): es la de FACTURAS (facturas-<empresa>@), no una de «documentos»
 * aparte, para no tener dos.
 */
export async function direccionUnica(companyId: string, quien: string | null): Promise<{ direccion: string; yaEstaba: boolean }> {
  const r = await rpc<{ direccion: string; ya_estaba: boolean }>('conta_direccion_entrada', { p_company: companyId, p_tipo: 'facturas', p_quien_nombre: quien })
  return { direccion: r.direccion, yaEstaba: r.ya_estaba }
}

/** Aprende las fuentes de lo que ya pasa en la empresa. Devuelve cuántas se han apuntado nuevas. */
export async function aprenderFuentes(companyId: string, quien: string | null): Promise<{ nuevas: number; texto: string }> {
  const [propuestas, ya] = await Promise.all([
    rpc<Record<string, unknown>[]>('conta_puerta_fuentes_proponer', { p_company: companyId }),
    leerFuentes(companyId),
  ])
  // Lo que ya está apuntado no se pisa (su local, su margen o que esté apagada los puso una persona).
  const claves = new Set(ya.fuentes.map((f) => f.clave).filter(Boolean))
  let nuevas = 0
  for (const p of propuestas) {
    if (claves.has(String(p.clave))) continue
    const r = await rpc<{ nueva?: boolean }>('conta_puerta_fuente_guardar', { p_company: companyId, p: p, p_quien_nombre: quien })
    if (r.nueva) nuevas++
  }
  return {
    nuevas,
    texto: propuestas.length === 0
      ? 'No he encontrado nada que llegue con calendario fijo todavía: con un par de meses de documentos, lo aprendo.'
      : nuevas === 0
        ? `Ya tenía las ${propuestas.length} fuentes que he encontrado: no he cambiado nada.`
        : `Apuntadas ${nuevas} ${nuevas === 1 ? 'fuente nueva' : 'fuentes nuevas'}, con el día en que suelen llegar. Puedes apagar las que no quieras.`,
  }
}

export async function apagarFuente(companyId: string, fuenteId: string, activa: boolean, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_puerta_fuente_guardar', { p_company: companyId, p: { id: fuenteId, activa }, p_quien_nombre: quien })
  return r.texto
}

/** El local o centro de trabajo de una fuente (o ninguno). Dice lo que ha hecho, con el nombre del local. */
export async function ponerLocal(companyId: string, fuente: { id: string; nombre: string }, local: Local | null, quien: string | null): Promise<string> {
  await rpc('conta_puerta_fuente_guardar', { p_company: companyId, p: { id: fuente.id, local_id: local?.id ?? null }, p_quien_nombre: quien })
  return local
    ? `Apuntado: ${fuente.nombre} es del local ${nombreDelLocal(local)}. El aviso de lo que falta ya lo dice.`
    : `Apuntado: ${fuente.nombre} ya no tiene local.`
}

/**
 * V02d · Lo aprendido, al día (al abrir Documentos): lo nuevo se apunta y lo que
 * nadie ha tocado toma el ritmo de hoy. Solo cambia algo si un administrador o
 * un encargado abre la pantalla; devuelve si ha cambiado algo, para volver a leer.
 */
export async function alDia(companyId: string): Promise<boolean> {
  const r = await rpc<{ nuevas: number; reaprendidas: number; dormidas: number; despiertas: number }>('conta_puerta_al_dia', { p_company: companyId })
  return r.nuevas + r.reaprendidas + r.dormidas + r.despiertas > 0
}

/** V02d · «Ya lo tengo»: lo esperado de cada fuente de la fila, ese día, cuenta como llegado. */
export async function yaLoTengo(fuentes: readonly { id: string; dia: string }[], quien: string | null): Promise<{ nuevas: number }> {
  let nuevas = 0
  for (const f of fuentes) {
    const r = await rpc<{ ya_estaba: boolean }>('conta_puerta_ya_lo_tengo', { p_expected: f.id, p_dia: f.dia, p_quien_nombre: quien })
    if (!r.ya_estaba) nuevas++
  }
  return { nuevas }
}

/** V02d · Encender o apagar varias fuentes de una vez (una fila de alquileres o de una plataforma). */
export async function avisarDe(companyId: string, ids: readonly string[], activa: boolean, quien: string | null): Promise<void> {
  for (const id of ids) await rpc('conta_puerta_fuente_guardar', { p_company: companyId, p: { id, activa }, p_quien_nombre: quien })
}

/** V02d · El local de varias fuentes de una vez (las de una fila). */
export async function localDe(companyId: string, ids: readonly string[], local: Local | null, quien: string | null): Promise<void> {
  for (const id of ids) await rpc('conta_puerta_fuente_guardar', { p_company: companyId, p: { id, local_id: local?.id ?? null }, p_quien_nombre: quien })
}

/** V02d · «Añadir algo que espero»: el camino a mano. */
export async function anadirEsperado(companyId: string, x: {
  nombre: string; proveedorId: string | null; tipo: 'proveedor' | 'alquiler' | 'otro'; cadencia: 'mensual' | 'quincenal' | 'semanal' | 'varias'
  dia: number | null; diaSemana: number | null; cada: number | null; localId: string | null
}, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_puerta_fuente_guardar', {
    p_company: companyId, p_quien_nombre: quien,
    p: { nombre: x.nombre, proveedor_id: x.proveedorId, tipo: x.tipo, cadencia: x.cadencia, dia: x.dia, dia_semana: x.diaSemana, cada: x.cada, local_id: x.localId },
  })
  return r.texto
}

export async function ponerAjustes(companyId: string, loQueFalta: boolean, margen: number, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_puerta_ajustes_poner', { p_company: companyId, p_lo_que_falta: loQueFalta, p_margen: margen, p_quien_nombre: quien })
  return r.texto
}

export async function dimeQueEs(inboxId: string, tipo: QueEs, recordar: boolean, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_puerta_dime_que_es', { p_inbox: inboxId, p_tipo: tipo, p_recordar: recordar, p_quien_nombre: quien })
  return r.texto
}

/** «Pedírsela» a una fuente: la petición queda confirmada y el correo lo manda la persona desde el suyo (mailto). */
export async function pedirla(fuenteId: string, periodo: string, email: string, asunto: string, cuerpo: string, quien: string | null): Promise<{ yaEstaba: boolean; texto: string; mailto: string }> {
  const r = await rpc<{ ya_estaba: boolean; texto: string }>('conta_puerta_pedir', { p_expected: fuenteId, p_periodo: periodo, p_email: email, p_asunto: asunto, p_cuerpo: cuerpo, p_quien_nombre: quien })
  return { yaEstaba: r.ya_estaba, texto: r.texto, mailto: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}` }
}

/** Lo que se sube sin saber qué es: a conta-entrada, y a la bandeja para «Dime qué es». */
export async function subirSinSaber(accountId: string, companyId: string, f: File, quien: string | null): Promise<{ id: string; yaEstaba: boolean; texto: string }> {
  hayBase()
  const bytes = await f.arrayBuffer()
  const nombre = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(-90) || 'documento'
  const ruta = `${accountId}/_puerta/${globalThis.crypto?.randomUUID?.() ?? Date.now()}/${nombre}`
  const tipo = f.type || 'application/octet-stream'
  const { error } = await supabase!.storage.from(ALMACEN).upload(ruta, bytes, { contentType: tipo, upsert: false })
  if (error) throw new Error(`No se ha podido guardar «${f.name}»: ${error.message}`)
  const r = await rpc<{ id: string; ya_estaba: boolean; texto: string }>('conta_puerta_subida', {
    p_company: companyId, p_ruta: ruta, p_nombre: f.name, p_tipo: tipo, p_bytes: bytes.byteLength,
    p_sha256: hex(await crypto.subtle.digest('SHA-256', bytes)), p_quien_nombre: quien,
  })
  return { id: r.id, yaEstaba: r.ya_estaba, texto: r.texto }
}
