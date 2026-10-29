// supabase/functions/_shared/hacienda/acciones.ts
//
// I01a · 6 · LO QUE SE HACE CON HACIENDA, EN SU ORDEN. Núcleo sin Deno: la
// función conta-hacienda pone la base, el almacén, la puerta y dónde se guarda
// el PDF; las pruebas, sus dobles.
//
//   probar     «Probar con Hacienda» (tablero 8): abre el certificado con su
//              token y consulta las declaraciones de su NIF. Si contesta,
//              aunque sea con 0, funciona.
//   presentar  El 303 (tablero 9). En este orden, y cada paso para si falla:
//                1. la base dice si se puede (token de esa persona para ESA
//                   declaración, «Revisado», sin errores) y da los datos;
//                2. el fichero se genera y se comprueba contra el diseño de
//                   registro; la comprobación se apunta (file_layout). Si no
//                   vale, no se abre el certificado;
//                3. se abre el certificado (el token se gasta: uso apuntado);
//                4. se CONSULTA antes: si Hacienda ya tiene ese 303, no se
//                   presenta otra vez (sería complementaria) y se dice;
//                5. se presenta. Con errores: no se grabó nada, y se enseñan.
//                   Sin respuesta: NO se sabe si llegó, y se dice así;
//                6. con CSV: «Presentado», y el justificante (urlPdf) a
//                   conta-documentos. Si el PDF no sale, se pide subirlo.
//   fichero    I01b · «Descargar el fichero oficial»: generado y comprobado,
//              sin llamar a Hacienda (funciona con la puerta cerrada).
//   fichero190 S02 · Lo mismo con el 190 (diseño del anexo del BOE).
//   fichero180 S02 · Lo mismo con el 180 (diseño del anexo VI del BOE).
//   fuera      «Ya lo presenté fuera»: con el CSV. Con certificado, se
//              comprueba con la consulta (ese CSV, ese NIF, ese modelo y
//              periodo) y se trae el PDF por la URL del CSV; si no responde,
//              se pide subirlo. Sin certificado, se apunta diciendo que no se
//              ha comprobado.
//
// Cada salida lleva un mensaje para la pantalla, con contenido (regla 8).
// Nunca se escribe en el registro nada del certificado ni el CSV entero.

import type { Abierto, Almacen, ClienteBase } from '../certificados/almacen.ts'
import { AlmacenNoDeja, enmascarar } from '../certificados/almacen.ts'
import { type Forge, firmanteDelPem, CertificadoNoVale } from '../certificados/leerP12.ts'
import { LlamadaFallida } from '../certificados/mtls.ts'
import { comprobar303, FicheroNoVale, generar303, type Datos303 } from '../impuestos/dr303.ts'
import { comprobar190, FicheroNoVale as FicheroNoVale190, generar190, type Datos190 } from '../impuestos/modelo190.ts'
import { comprobar180, FicheroNoVale as FicheroNoVale180, generar180, type Datos180, type Inmueble180 } from '../impuestos/modelo180.ts'
import { type Hacienda, PuertaCerrada, RespuestaRara } from './puerta.ts'

export interface Dependencias {
  /** Cliente de la base con la clave de servicio. */
  base: ClienteBase
  almacen: Almacen
  hacienda: Hacienda
  forge: Forge
  /** Sube el PDF a conta-documentos en esa ruta (sin pisar). */
  guardarPdf(ruta: string, pdf: Uint8Array): Promise<void>
  sha256(datos: Uint8Array | string): Promise<string>
  /** El NIF del programa que genera el fichero (cabecera del 303). */
  programa: { version: string; nifDesarrollo: string }
}

export type Salida =
  | { ok: true; mensaje: string; [k: string]: unknown }
  | { ok: false; motivo: string; mensaje: string; [k: string]: unknown }

async function rpc<T>(base: ClienteBase, fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await base.rpc(fn, params)
  if (error) throw new AlmacenNoDeja(error.message, error.code ?? null)
  return data as T
}

const fechaEs = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

function porQueFalla(e: unknown): { motivo: string; mensaje: string; incierto: boolean } {
  if (e instanceof PuertaCerrada) return { motivo: 'cerrada', mensaje: e.message, incierto: false }
  if (e instanceof LlamadaFallida) return { motivo: e.motivo, mensaje: e.message, incierto: e.motivo !== 'certificado' }
  if (e instanceof RespuestaRara) return { motivo: 'rara', mensaje: e.message, incierto: true }
  if (e instanceof AlmacenNoDeja) return { motivo: 'no_deja', mensaje: e.message, incierto: false }
  if (e instanceof CertificadoNoVale) return { motivo: 'certificado', mensaje: e.message, incierto: false }
  return { motivo: 'fallo', mensaje: 'No se ha podido hablar con Hacienda. No se ha enviado nada nuevo; vuelve a intentarlo.', incierto: false }
}

// ── Probar con Hacienda ─────────────────────────────────────────────────────
export async function probar(d: Dependencias, a: { usuario: string; confirmacion: string }): Promise<Salida> {
  let abierto: Abierto
  try {
    abierto = await d.almacen.abrir({ confirmacion: a.confirmacion, usuario: a.usuario })
  } catch (e) {
    const f = porQueFalla(e)
    return { ok: false, motivo: f.motivo, mensaje: f.mensaje }
  }
  try {
    const firmante = firmanteDelPem(d.forge, abierto.material.cert)
    const nif = firmante.nifEntidad ?? firmante.nif
    const encontradas = await d.hacienda.consultar(abierto.material, { nif })
    const hoy = fechaEs(new Date().toISOString())
    const mensaje = `Funciona · probado con Hacienda el ${hoy}` +
      (encontradas.length > 0 ? ` (tiene ${encontradas.length} ${encontradas.length === 1 ? 'declaración presentada' : 'declaraciones presentadas'} de este NIF).` : '.')
    await d.almacen.terminarUso({ usoId: abierto.usoId, resultado: 'ok', mensaje })
    return { ok: true, mensaje, declaraciones: encontradas.length }
  } catch (e) {
    const f = porQueFalla(e)
    await d.almacen.terminarUso({ usoId: abierto.usoId, resultado: 'error', mensaje: `No funciona: ${f.mensaje}` })
    return { ok: false, motivo: f.motivo, mensaje: `No funciona: ${f.mensaje}` }
  }
}

// ── Presentar el 303 ───────────────────────────────────────────────────────
interface DatosFichero {
  ejercicio: number; periodo: string; nif: string; nombre: string; tipo: Datos303['tipo']; redeme: boolean; sii: boolean
  iban: string | null; sin_actividad: boolean; casillas: Record<string, number>; declaracion: string; cuenta: string
}

export async function presentar303(d: Dependencias, a: { usuario: string; confirmacion: string; declaracion: string }): Promise<Salida> {
  // 1 · La base dice si se puede.
  let datos: DatosFichero
  try {
    datos = await rpc<DatosFichero>(d.base, 'conta_impuesto_303_preparar', { p_return: a.declaracion, p_user: a.usuario, p_confirmation: a.confirmacion })
  } catch (e) {
    const f = porQueFalla(e)
    return { ok: false, motivo: f.motivo, mensaje: f.mensaje }
  }
  const quien = `el 303 del ${datos.periodo}/${datos.ejercicio}`

  // 2 · El fichero, contra el diseño de registro.
  let fichero: string
  const d303: Datos303 = {
    ejercicio: datos.ejercicio, periodo: datos.periodo, nif: datos.nif, nombre: datos.nombre, tipo: datos.tipo, redeme: datos.redeme,
    sii: datos.sii, casillas: datos.casillas, iban: datos.iban, sinActividad: datos.sin_actividad, programa: d.programa,
  }
  try {
    fichero = generar303(d303)
  } catch (e) {
    const fallos = e instanceof FicheroNoVale ? e.fallos : ['No se ha podido generar el fichero.']
    await rpc(d.base, 'conta_impuesto_303_fichero_comprobado', { p_return: a.declaracion, p_ok: false, p_fallos: fallos, p_huella: null })
    return { ok: false, motivo: 'fichero', mensaje: `No se presenta: el fichero no cumple el diseño de Hacienda. ${fallos.join(' ')}`, fallos }
  }
  const comprobado = comprobar303(fichero, d303)
  const huella = await d.sha256(fichero)
  await rpc(d.base, 'conta_impuesto_303_fichero_comprobado', { p_return: a.declaracion, p_ok: comprobado.ok, p_fallos: comprobado.fallos, p_huella: huella })
  if (!comprobado.ok) {
    return { ok: false, motivo: 'fichero', mensaje: `No se presenta: el fichero no cumple el diseño de Hacienda. ${comprobado.fallos.join(' ')}`, fallos: comprobado.fallos }
  }

  // 3 · El certificado.
  let abierto: Abierto
  try {
    abierto = await d.almacen.abrir({ confirmacion: a.confirmacion, usuario: a.usuario })
  } catch (e) {
    const f = porQueFalla(e)
    return { ok: false, motivo: f.motivo, mensaje: f.mensaje }
  }
  const apuntar = (servicio: 'present' | 'query' | 'receipt_pdf', resultado: 'ok' | 'error', mensaje: string, codigos: string[] | null = null, detalle: Record<string, unknown> = {}) =>
    rpc(d.base, 'conta_impuesto_hacienda_apunte', { p_return: a.declaracion, p_user: a.usuario, p_service: servicio, p_result: resultado, p_codes: codigos, p_message: mensaje, p_detail: detalle })
  const cerrarUso = (resultado: 'ok' | 'error', mensaje: string, csv: string | null = null) =>
    d.almacen.terminarUso({ usoId: abierto.usoId, resultado, mensaje, referencia: enmascarar(csv) })

  try {
    const firmante = firmanteDelPem(d.forge, abierto.material.cert)

    // 4 · ¿Ya lo tiene Hacienda?
    const ya = await d.hacienda.consultar(abierto.material, { nif: datos.nif, modelo: '303', ejercicio: datos.ejercicio, periodo: datos.periodo })
    if (ya.length > 0) {
      const p = ya[0]
      const mensaje = `No se ha presentado: Hacienda ya tiene ${quien} de esta empresa (presentado el ${fechaEs(p.fechaHora)}, justificante ${p.justificante ?? '—'}). ` +
        'Si es el tuyo, apúntalo con «Ya lo presenté» y su CSV; otra presentación sería complementaria.'
      await apuntar('query', 'ok', mensaje, null, { encontradas: ya.length })
      await cerrarUso('error', mensaje)
      return { ok: false, motivo: 'ya_presentada', mensaje }
    }

    // 5 · Presentar.
    const r = await d.hacienda.presentar(abierto.material, { modelo: '303', ejercicio: datos.ejercicio, periodo: datos.periodo, fichero, firmante })
    if (!r.ok) {
      const mensaje = `Hacienda no lo ha aceptado: no se ha presentado nada. ${r.errores.map((x) => `${x.codigo}: ${x.texto}`).join(' · ')}`
      await apuntar('present', 'error', mensaje, r.errores.map((x) => x.codigo))
      await cerrarUso('error', mensaje)
      return { ok: false, motivo: 'errores', mensaje, errores: r.errores }
    }

    // 6 · Presentado.
    const hecho = await rpc<{ mensaje: string }>(d.base, 'conta_impuesto_presentada', {
      p_return: a.declaracion, p_user: a.usuario, p_use: abierto.usoId, p_csv: r.csv, p_justificante: r.justificante,
      p_expediente: r.expediente, p_fecha: r.fecha && r.hora ? `${r.fecha}T${r.hora}` : null,
      p_respuesta: { tipo_representacion: r.tipoRepresentacion, avisos: r.avisos, advertencias: r.advertencias },
    })
    await cerrarUso('ok', `Presentado ${quien}. Justificante ${r.justificante ?? '—'}.`, r.csv)
    const pdf = r.urlPdf ? await traerPdf(d, a.declaracion, datos.cuenta, r.urlPdf, (s, m) => apuntar('receipt_pdf', s, m)) : null
    return {
      ok: true, csv: r.csv, justificante: r.justificante, avisos: r.avisos, advertencias: r.advertencias,
      pide_pdf: !pdf?.ok,
      mensaje: hecho.mensaje + (pdf?.ok ? ' Justificante guardado.' : ' El justificante no se ha podido bajar de Hacienda: súbelo en PDF.'),
    }
  } catch (e) {
    const f = porQueFalla(e)
    const mensaje = f.incierto ? `${f.mensaje} Si al comprobarlo ya está presentado, apúntalo con «Ya lo presenté» y su CSV.` : f.mensaje
    await apuntar('present', 'error', mensaje, null, { motivo: f.motivo, incierto: f.incierto }).catch(() => {})
    await cerrarUso('error', mensaje).catch(() => {})
    return { ok: false, motivo: f.motivo, mensaje, incierto: f.incierto }
  }
}

async function traerPdf(d: Dependencias, declaracion: string, cuenta: string, url: string,
                        apuntar: (r: 'ok' | 'error', m: string) => Promise<unknown>): Promise<{ ok: boolean }> {
  const r = await d.hacienda.pdf(url)
  if (!r.ok) {
    await apuntar('error', `${r.mensaje} Hay que subirlo a mano.`)
    return { ok: false }
  }
  const huella = await d.sha256(r.pdf)
  const ruta = `${cuenta}/impuestos/${declaracion}/${huella}.pdf`
  await d.guardarPdf(ruta, r.pdf)
  await rpc(d.base, 'conta_impuesto_justificante_guardar', { p_return: declaracion, p_ruta: ruta, p_huella: huella, p_tamano: r.pdf.length })
  await apuntar('ok', 'Justificante bajado de Hacienda y guardado.')
  return { ok: true }
}

// ── «Ya lo presenté fuera» ──────────────────────────────────────────────────
export async function yaPresentadoFuera(d: Dependencias, a: {
  usuario: string; declaracion: string; csv: string; confirmacion?: string | null
  /** De la declaración: lo pone la función leyéndolo con la persona. */
  nif: string; modelo: string; ejercicio: number; periodo: string; cuenta: string
}): Promise<Salida> {
  const csv = a.csv.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z0-9]{16}$/.test(csv)) {
    return { ok: false, motivo: 'csv', mensaje: 'Ese CSV no tiene la forma de los de Hacienda: son 16 letras y números, como aparecen en el justificante.' }
  }
  let comprobada = false
  let justificante: string | null = null
  let fecha: string | null = null
  let usoId: string | null = null

  if (a.confirmacion) {
    let abierto: Abierto
    try {
      abierto = await d.almacen.abrir({ confirmacion: a.confirmacion, usuario: a.usuario })
    } catch (e) {
      const f = porQueFalla(e)
      return { ok: false, motivo: f.motivo, mensaje: f.mensaje }
    }
    usoId = abierto.usoId
    try {
      const encontradas = await d.hacienda.consultar(abierto.material, { nif: a.nif, modelo: a.modelo, ejercicio: a.ejercicio, periodo: a.periodo })
      const esa = encontradas.find((x) => x.csv.toUpperCase() === csv)
      if (!esa) {
        const mensaje = encontradas.length > 0
          ? `Hacienda tiene el ${a.modelo} del ${a.periodo}/${a.ejercicio} de esta empresa, pero con otro CSV. Revisa el que has pegado.`
          : `Hacienda no tiene ningún ${a.modelo} del ${a.periodo}/${a.ejercicio} de esta empresa. Revisa el CSV y el periodo.`
        await d.almacen.terminarUso({ usoId, resultado: 'error', mensaje })
        await rpc(d.base, 'conta_impuesto_hacienda_apunte', { p_return: a.declaracion, p_user: a.usuario, p_service: 'outside_check', p_result: 'error', p_codes: null, p_message: mensaje, p_detail: { encontradas: encontradas.length } })
        return { ok: false, motivo: 'no_coincide', mensaje }
      }
      comprobada = true
      justificante = esa.justificante
      fecha = esa.fechaHora
      await d.almacen.terminarUso({ usoId, resultado: 'ok', mensaje: `Hacienda confirma el CSV (justificante ${justificante ?? '—'}).`, referencia: enmascarar(csv) })
    } catch (e) {
      const f = porQueFalla(e)
      await d.almacen.terminarUso({ usoId, resultado: 'error', mensaje: f.mensaje }).catch(() => {})
      return { ok: false, motivo: f.motivo, mensaje: `No se ha podido comprobar con Hacienda: ${f.mensaje} Si quieres, apúntalo sin comprobar.` }
    }
  }

  const hecho = await rpc<{ mensaje: string }>(d.base, 'conta_impuesto_fuera', {
    p_return: a.declaracion, p_user: a.usuario, p_csv: csv, p_comprobada: comprobada, p_justificante: justificante, p_fecha: fecha, p_use: usoId,
  })
  const pdf = await traerPdf(d, a.declaracion, a.cuenta, d.hacienda.urlPdfDeCsv(csv), (s, m) =>
    rpc(d.base, 'conta_impuesto_hacienda_apunte', { p_return: a.declaracion, p_user: a.usuario, p_service: 'receipt_pdf', p_result: s, p_codes: null, p_message: m, p_detail: {} }))
    .catch(() => ({ ok: false }))
  return {
    ok: true, comprobada, pide_pdf: !pdf.ok,
    mensaje: hecho.mensaje + (pdf.ok ? ' Justificante guardado.' : ' Hacienda no nos da el justificante desde aquí: súbelo en PDF.'),
  }
}

/**
 * I01b · Después de «Presentado» (desde Sumied o fuera): el asiento de
 * liquidación, con la sesión de la persona (journal_entry_validar pide un
 * administrador o encargado de la empresa). Si no se puede, la presentación
 * NO se deshace: queda «Presentado» y se dice por qué no se ha contabilizado,
 * para que lo haga quien pueda desde la declaración.
 */
export async function contabilizarTrasPresentar(persona: ClienteBase, declaracion: string): Promise<{ ok: boolean; mensaje: string }> {
  try {
    const { data, error } = await persona.rpc('conta_impuesto_303_contabilizar', { p_return: declaracion })
    if (error) return { ok: false, mensaje: `Queda «Presentado» sin contabilizar: ${error.message}` }
    const m = (data as { mensaje?: unknown } | null)?.mensaje
    return { ok: true, mensaje: typeof m === 'string' ? m : 'Contabilizado.' }
  } catch {
    return { ok: false, mensaje: 'Queda «Presentado» sin contabilizar: no se ha podido hablar con la base. Contabilízalo desde la declaración.' }
  }
}

/**
 * I01b · «Descargar el fichero oficial» (tablero 9): el fichero del 303 tal
 * como se presentaría, para presentarlo fuera o mirarlo. No llama a Hacienda
 * ni abre el certificado: funciona con la puerta cerrada. La base dice si la
 * persona puede (conta_impuesto_gestiona) y da los datos; el fichero se genera
 * y se comprueba contra el diseño de registro, y si no vale se dice qué falla.
 */
export async function fichero303(base: ClienteBase, programa: Dependencias['programa'], a: {
  usuario: string; declaracion: string
  /** De la declaración: lo lee la función con la clave de servicio. */
  empresa: string
}): Promise<Salida> {
  try {
    const puede = await rpc<boolean>(base, 'conta_impuesto_gestiona', { p_user: a.usuario, p_company: a.empresa })
    if (puede !== true) return { ok: false, motivo: 'no_deja', mensaje: 'No puedes bajar el fichero de los impuestos de esta empresa.' }
    const datos = await rpc<Omit<DatosFichero, 'declaracion' | 'cuenta'>>(base, 'conta_impuesto_303_fichero', { p_return: a.declaracion })
    const d303: Datos303 = {
      ejercicio: datos.ejercicio, periodo: datos.periodo, nif: datos.nif, nombre: datos.nombre, tipo: datos.tipo, redeme: datos.redeme,
      sii: datos.sii, casillas: datos.casillas, iban: datos.iban, sinActividad: datos.sin_actividad, programa,
    }
    let fichero: string
    try {
      fichero = generar303(d303)
    } catch (e) {
      const fallos = e instanceof FicheroNoVale ? e.fallos : ['No se ha podido generar el fichero.']
      return { ok: false, motivo: 'fichero', mensaje: `El fichero no cumple el diseño de Hacienda: ${fallos.join(' ')}`, fallos }
    }
    const comprobado = comprobar303(fichero, d303)
    if (!comprobado.ok) {
      return { ok: false, motivo: 'fichero', mensaje: `El fichero no cumple el diseño de Hacienda: ${comprobado.fallos.join(' ')}`, fallos: comprobado.fallos }
    }
    return { ok: true, fichero, nombre: `303_${datos.ejercicio}_${datos.periodo}.txt`, mensaje: `El fichero del 303 del ${datos.periodo}/${datos.ejercicio}, comprobado contra el diseño de Hacienda.` }
  } catch (e) {
    const f = porQueFalla(e)
    return { ok: false, motivo: f.motivo, mensaje: f.mensaje }
  }
}

/**
 * S02 · «Descargar el fichero oficial» del 190: generado recorriendo el diseño
 * del anexo de la Orden EHA/3127/2009 y comprobado releyéndolo. No llama a
 * Hacienda. La base dice si la persona puede (conta_impuesto_gestiona) y da
 * los datos (conta_impuesto_190_fichero, que no los da con un error sin
 * resolver en lo comprobado).
 */
export async function fichero190(base: ClienteBase, a: { usuario: string; declaracion: string; empresa: string }): Promise<Salida> {
  try {
    const puede = await rpc<boolean>(base, 'conta_impuesto_gestiona', { p_user: a.usuario, p_company: a.empresa })
    if (puede !== true) return { ok: false, motivo: 'no_deja', mensaje: 'No puedes bajar el fichero de los impuestos de esta empresa.' }
    const x = await rpc<{
      ejercicio: number; nif: string; nombre: string; numero: string
      contacto: { telefono: string; nombre: string; correo: string }
      perceptores: { nif: string | null; nombre: string | null; provincia: string | null; clave: Datos190['perceptores'][number]['clave']; subclave: string | null
        integra: number; retenciones: number; anio_nacimiento: number | null; gastos?: number | null }[]
    }>(base, 'conta_impuesto_190_fichero', { p_return: a.declaracion, p_user: a.usuario })
    const d: Datos190 = {
      ejercicio: x.ejercicio, nif: x.nif, nombre: x.nombre, numero: x.numero, contacto: x.contacto,
      perceptores: x.perceptores.map((p) => ({
        nif: p.nif ?? '', nombre: p.nombre ?? '', provincia: p.provincia ?? '', clave: p.clave, subclave: p.subclave,
        integra: Number(p.integra), retenciones: Number(p.retenciones), anioNacimiento: p.anio_nacimiento, gastos: p.gastos === null || p.gastos === undefined ? null : Number(p.gastos),
      })),
    }
    let fichero: string
    try {
      fichero = generar190(d)
    } catch (e) {
      const fallos = e instanceof FicheroNoVale190 ? e.fallos : ['No se ha podido generar el fichero.']
      return { ok: false, motivo: 'fichero', mensaje: `El fichero no cumple el diseño de Hacienda: ${fallos.join(' ')}`, fallos }
    }
    const c = comprobar190(fichero, d)
    if (!c.ok) return { ok: false, motivo: 'fichero', mensaje: `El fichero no cumple el diseño de Hacienda: ${c.fallos.join(' ')}`, fallos: c.fallos }
    return {
      ok: true, fichero, nombre: `190_${x.ejercicio}.txt`,
      mensaje: `El fichero del 190 de ${x.ejercicio}: ${c.perceptores} ${c.perceptores === 1 ? 'perceptor' : 'perceptores'}, comprobado contra el diseño de Hacienda.`,
    }
  } catch (e) {
    const f = porQueFalla(e)
    return { ok: false, motivo: f.motivo, mensaje: f.mensaje }
  }
}

/**
 * S02 · «Descargar el fichero oficial» del 180: generado recorriendo el diseño
 * del anexo VI de la Orden de 21/11/2000 y comprobado releyéndolo. No llama a
 * Hacienda. La base dice si la persona puede (conta_impuesto_gestiona) y da
 * los datos (conta_impuesto_180_fichero, que no los da con un error sin
 * resolver o un aviso sin mirar en lo comprobado).
 */
export async function fichero180(base: ClienteBase, a: { usuario: string; declaracion: string; empresa: string }): Promise<Salida> {
  try {
    const puede = await rpc<boolean>(base, 'conta_impuesto_gestiona', { p_user: a.usuario, p_company: a.empresa })
    if (puede !== true) return { ok: false, motivo: 'no_deja', mensaje: 'No puedes bajar el fichero de los impuestos de esta empresa.' }
    type InmuebleBase = Record<string, string | null>
    const x = await rpc<{
      ejercicio: number; nif: string; nombre: string; numero: string
      contacto: { telefono: string; nombre: string }
      perceptores: { nif: string | null; nombre: string | null; provincia: string | null; modalidad: string | null
        base: number; porcentaje: number; retenciones: number; inmueble: InmuebleBase | null }[]
    }>(base, 'conta_impuesto_180_fichero', { p_return: a.declaracion, p_user: a.usuario })
    const inmueble = (i: InmuebleBase | null): Inmueble180 => ({
      situacion: (i?.situacion ?? '') as Inmueble180['situacion'], catastral: i?.catastral, tipoVia: i?.tipo_via, nombreVia: i?.nombre_via ?? '',
      tipoNumeracion: i?.tipo_numeracion, numero: i?.numero, calificador: i?.calificador, bloque: i?.bloque, portal: i?.portal,
      escalera: i?.escalera, planta: i?.planta, puerta: i?.puerta, complemento: i?.complemento, localidad: i?.localidad,
      municipio: i?.municipio ?? '', codigoMunicipio: i?.codigo_municipio, provincia: i?.provincia ?? '', cp: i?.cp ?? '',
    })
    const d: Datos180 = {
      ejercicio: x.ejercicio, nif: x.nif, nombre: x.nombre, numero: x.numero, contacto: x.contacto,
      perceptores: x.perceptores.map((p) => ({
        nif: p.nif ?? '', nombre: p.nombre ?? '', provincia: p.provincia ?? '', modalidad: p.modalidad === '2' ? '2' : '1',
        base: Number(p.base), porcentaje: Number(p.porcentaje), retenciones: Number(p.retenciones), inmueble: inmueble(p.inmueble),
      })),
    }
    let fichero: string
    try {
      fichero = generar180(d)
    } catch (e) {
      const fallos = e instanceof FicheroNoVale180 || e instanceof FicheroNoVale190 ? e.fallos : ['No se ha podido generar el fichero.']
      return { ok: false, motivo: 'fichero', mensaje: `El fichero no cumple el diseño de Hacienda: ${fallos.join(' ')}`, fallos }
    }
    const c = comprobar180(fichero, d)
    if (!c.ok) return { ok: false, motivo: 'fichero', mensaje: `El fichero no cumple el diseño de Hacienda: ${c.fallos.join(' ')}`, fallos: c.fallos }
    return {
      ok: true, fichero, nombre: `180_${x.ejercicio}.txt`,
      mensaje: `El fichero del 180 de ${x.ejercicio}: ${c.perceptores} ${c.perceptores === 1 ? 'arrendador' : 'arrendadores'}, comprobado contra el diseño de Hacienda.`,
    }
  } catch (e) {
    const f = porQueFalla(e)
    return { ok: false, motivo: f.motivo, mensaje: f.mensaje }
  }
}
