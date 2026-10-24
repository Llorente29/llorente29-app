// supabase/functions/_shared/certificados/almacen.ts
//
// I01a · 4 · EL ALMACÉN DE CERTIFICADOS: guardar, abrir para usar y quitar.
//
// Una sola pieza con dos implementaciones (informe I01 paso 1, §2.2 y §2.3):
//   · «vault»: el Vault de Supabase. Lo que hay hoy. Solo para la cuenta de
//     Foodint: lo impide la base (conta_cert_guardar), no esta pieza.
//   · «kms»: cifrado envolvente con un KMS externo. Obligatorio antes de
//     cualquier otro cliente. Todavía no existe: esta implementación se niega
//     a trabajar con un mensaje que lo dice, y pasar a KMS es escribirla aquí,
//     sin tocar a quien la usa (tax_certificate.storage dice dónde está cada
//     certificado).
//
// Abrir pide SIEMPRE un token de un solo uso (tax_certificate_confirmation),
// emitido por la base a una persona con permiso «puede presentar» al confirmar
// esa acción; la base comprueba token, persona, permiso y caducidad, apunta el
// uso y solo entonces devuelve el material. Quien abre cierra el uso con su
// resultado (terminarUso). Si no lo cierra, el uso queda como no terminado.
//
// Nunca se escribe en el registro nada del material.

import type { MaterialCertificado } from './mtls.ts'
import type { FichaCertificado } from './leerP12.ts'

export type Almacenamiento = 'vault' | 'kms'

/** Lo que hace falta del cliente de Supabase (con la clave de servicio). */
export interface ClienteBase {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
}

export interface Guardado {
  id: string
  custodia: string
}

export interface Abierto {
  material: MaterialCertificado
  usoId: string
  certificadoId: string
}

export type Accion = 'test' | 'file' | 'query' | 'receipt_pdf'

export interface Almacen {
  readonly almacenamiento: Almacenamiento
  guardar(a: { usuario: string; cuenta: string; ficha: FichaCertificado; material: MaterialCertificado }): Promise<Guardado>
  abrir(a: { confirmacion: string; usuario: string }): Promise<Abierto>
  terminarUso(a: { usoId: string; resultado: 'ok' | 'error'; mensaje: string; referencia?: string | null }): Promise<void>
}

/** Un error de la base, con el texto que la base ya da en palabras de oficina. */
export class AlmacenNoDeja extends Error {
  readonly codigo: string | null
  constructor(mensaje: string, codigo: string | null) {
    super(mensaje)
    this.name = 'AlmacenNoDeja'
    this.codigo = codigo
  }
}

async function llamar<T>(base: ClienteBase, fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await base.rpc(fn, params)
  if (error) throw new AlmacenNoDeja(error.message, error.code ?? null)
  return data as T
}

export class AlmacenVault implements Almacen {
  readonly almacenamiento = 'vault' as const
  constructor(private readonly base: ClienteBase) {}

  async guardar(a: { usuario: string; cuenta: string; ficha: FichaCertificado; material: MaterialCertificado }): Promise<Guardado> {
    const r = await llamar<{ id: string; custodia: string }>(this.base, 'conta_cert_guardar', {
      p_user: a.usuario,
      p_account: a.cuenta,
      p_ficha: {
        subject_name: a.ficha.titular,
        subject_tax_id_hash: a.ficha.nifHuella,
        subject_tax_id_tail: a.ficha.nifCola,
        issuer: a.ficha.emisor,
        serial: a.ficha.serie,
        valid_from: a.ficha.validoDesde,
        valid_to: a.ficha.validoHasta,
        fingerprint_sha256: a.ficha.huella,
        kind: a.ficha.tipo,
      },
      p_material: JSON.stringify(a.material),
    })
    return { id: r.id, custodia: r.custodia }
  }

  async abrir(a: { confirmacion: string; usuario: string }): Promise<Abierto> {
    const r = await llamar<{ ok: boolean; mensaje?: string; material?: string; uso_id?: string; certificate_id?: string }>(
      this.base, 'conta_cert_abrir', { p_confirmation: a.confirmacion, p_user: a.usuario })
    if (!r.ok || !r.material || !r.uso_id || !r.certificate_id) throw new AlmacenNoDeja(r.mensaje ?? 'No se puede usar el certificado.', '42501')
    const m = JSON.parse(r.material) as MaterialCertificado
    return { material: { cert: m.cert, key: m.key }, usoId: r.uso_id, certificadoId: r.certificate_id }
  }

  async terminarUso(a: { usoId: string; resultado: 'ok' | 'error'; mensaje: string; referencia?: string | null }): Promise<void> {
    await llamar(this.base, 'conta_cert_uso_terminar', {
      p_use: a.usoId, p_result: a.resultado, p_message: a.mensaje, p_aeat_ref_masked: a.referencia ?? null,
    })
  }
}

export const KMS_NO_PREPARADO =
  'El almacén con clave externa (KMS) todavía no está preparado. Hasta que lo esté, los certificados solo se guardan en el Vault, y solo los de la cuenta de Foodint.'

/** Preparada para el KMS: hoy no hace nada y lo dice. */
export class AlmacenKms implements Almacen {
  readonly almacenamiento = 'kms' as const
  guardar(): Promise<Guardado> { return Promise.reject(new AlmacenNoDeja(KMS_NO_PREPARADO, 'kms')) }
  abrir(): Promise<Abierto> { return Promise.reject(new AlmacenNoDeja(KMS_NO_PREPARADO, 'kms')) }
  terminarUso(): Promise<void> { return Promise.reject(new AlmacenNoDeja(KMS_NO_PREPARADO, 'kms')) }
}

/** El almacén donde está (o donde se va a guardar) un certificado. */
export function almacenPara(almacenamiento: Almacenamiento, base: ClienteBase): Almacen {
  return almacenamiento === 'vault' ? new AlmacenVault(base) : new AlmacenKms()
}

/** Para el registro: una referencia de Hacienda (CSV, justificante) con solo sus 4 últimos. */
export function enmascarar(ref: string | null | undefined): string | null {
  if (!ref) return null
  const s = ref.trim()
  return s.length <= 4 ? '****' : `${'*'.repeat(Math.min(12, s.length - 4))}${s.slice(-4)}`
}
