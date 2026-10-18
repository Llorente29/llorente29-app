// supabase/functions/_shared/certificados/leerP12.ts
//
// I01a · 4 · LEER UN CERTIFICADO .p12/.pfx AL SUBIRLO, Y RECHAZARLO SI NO VALE.
// Núcleo puro: sin red, sin base, sin Deno ni Node. La librería (node-forge) se
// pasa como parámetro: la función la importa de npm: y las pruebas, de
// node_modules.
//
// Lo que sale, para guardar (con el almacén) y para enseñar:
//   · material: el certificado (y su cadena) y la clave privada, en PEM, que es
//     lo que pide Deno.createHttpClient. Es lo único secreto: va al almacén y a
//     ningún sitio más.
//   · ficha: titular, NIF (en huella y sus 3 últimos), emisor, número de serie,
//     válido desde/hasta, huella SHA-256 y tipo.
//
// Lo que se comprueba ANTES de guardar (prueba mTLS del 17/10: una clave mala
// colgó la función sin dar error ni dejar rastro; tiene que salir aquí, al
// subirlo, y no meses después en una presentación):
//   · que la contraseña abre el fichero;
//   · que trae una clave privada RSA y un certificado;
//   · que la clave corresponde al certificado (mismo módulo y exponente);
//   · que el certificado ya vale y no ha caducado.
//
// Nunca: ni la contraseña ni el .p12 salen de aquí, y ningún mensaje de error
// lleva nada del fichero.

// node-forge no tiene tipos que Deno vaya a resolver aquí: se usa sin tipos.
/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
export type Forge = any

export type TipoCertificado = 'legal_representative' | 'natural_person' | 'other'

export interface FichaCertificado {
  titular: string
  nif: string | null
  nifHuella: string | null
  nifCola: string | null
  emisor: string
  serie: string
  validoDesde: string
  validoHasta: string
  huella: string
  tipo: TipoCertificado
}

export interface CertificadoLeido {
  ficha: FichaCertificado
  /** El certificado (el del titular primero y después su cadena) y la clave, en PEM. */
  material: { cert: string; key: string }
}

export type MotivoRechazo =
  | 'vacio' | 'grande' | 'contrasena' | 'sin_clave' | 'clave_no_rsa' | 'sin_certificado'
  | 'no_corresponde' | 'caducado' | 'aun_no_vale' | 'ilegible'

/** Por qué no se guarda, en palabras de oficina. */
export class CertificadoNoVale extends Error {
  readonly motivo: MotivoRechazo
  constructor(motivo: MotivoRechazo, mensaje: string) {
    super(mensaje)
    this.name = 'CertificadoNoVale'
    this.motivo = motivo
  }
}

/** Un .p12 de verdad pesa unos pocos KB; más de esto no es un certificado. */
export const TAMANO_MAXIMO = 64 * 1024

const fecha = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/')

/** El NIF que lleva el certificado: el de la entidad si es de representante; si no, el de la persona. */
export function nifDelCertificado(serialNumber: string | null, organizationIdentifier: string | null): string | null {
  const limpio = (v: string | null) => {
    if (!v) return null
    const s = v.toUpperCase().replace(/^(IDCES|VATES|IDC|PASES|PAS)-?/, '').replace(/[^0-9A-Z]/g, '')
    return s.length >= 8 ? s : null
  }
  return limpio(organizationIdentifier) ?? limpio(serialNumber)
}

function campo(nombre: { name?: string; type?: string }, quien: any): string | null {
  const f = quien.getField(nombre)
  return f && typeof f.value === 'string' && f.value.trim() ? f.value.trim() : null
}

/**
 * Abre el .p12 con su contraseña y devuelve la ficha y el material, o lanza
 * CertificadoNoVale con el motivo. `ahora` se pasa para poder probarlo.
 */
export function leerP12(forge: Forge, p12: Uint8Array, contrasena: string, ahora: Date = new Date()): CertificadoLeido {
  if (!p12 || p12.length === 0) throw new CertificadoNoVale('vacio', 'No ha llegado ningún fichero.')
  if (p12.length > TAMANO_MAXIMO) throw new CertificadoNoVale('grande', 'Ese fichero es demasiado grande para ser un certificado (.p12 o .pfx).')

  let contenedor: any
  try {
    const binario = forge.util.binary.raw.encode(p12)
    contenedor = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(binario), false, contrasena)
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e)
    if (/password|MAC could not be verified|decrypt/i.test(texto)) {
      throw new CertificadoNoVale('contrasena', 'La contraseña no abre el certificado. Comprueba que es la que pusiste al exportarlo.')
    }
    throw new CertificadoNoVale('ilegible', 'Ese fichero no es un certificado .p12 o .pfx que se pueda leer.')
  }

  const oids = forge.pki.oids
  const bolsas = [
    ...(contenedor.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
    ...(contenedor.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? []),
  ]
  if (bolsas.length === 0) throw new CertificadoNoVale('sin_clave', 'El fichero no trae la clave privada: expórtalo «con la clave privada».')
  // node-forge solo entiende claves RSA: una de curva elíptica llega con key a null.
  const clave = bolsas.find((b: any) => b.key)?.key
  if (!clave) throw new CertificadoNoVale('clave_no_rsa', 'La clave del certificado no es RSA, y de momento solo se admiten claves RSA (las de la FNMT lo son).')

  const certs: any[] = (contenedor.getBags({ bagType: oids.certBag })[oids.certBag] ?? []).map((b: any) => b.cert).filter(Boolean)
  if (certs.length === 0) throw new CertificadoNoVale('sin_certificado', 'El fichero trae la clave pero no el certificado.')

  const delTitular = certs.find((c) => c.publicKey?.n && c.publicKey.n.equals(clave.n) && c.publicKey.e.equals(clave.e))
  if (!delTitular) {
    throw new CertificadoNoVale('no_corresponde', 'La clave del fichero no corresponde a su certificado. No se guarda: con él no se podría presentar.')
  }
  const desde: Date = delTitular.validity.notBefore
  const hasta: Date = delTitular.validity.notAfter
  if (ahora.getTime() >= hasta.getTime()) throw new CertificadoNoVale('caducado', `El certificado caducó el ${fecha(hasta)}. No se guarda: pide uno nuevo.`)
  if (ahora.getTime() < desde.getTime()) throw new CertificadoNoVale('aun_no_vale', `El certificado no vale hasta el ${fecha(desde)}.`)

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(delTitular)).getBytes()
  const huella = forge.md.sha256.create().update(der).digest().toHex()

  const sujeto = delTitular.subject
  const serialNumber = campo({ type: '2.5.4.5' }, sujeto)
  const organizationIdentifier = campo({ type: '2.5.4.97' }, sujeto)
  const nif = nifDelCertificado(serialNumber, organizationIdentifier)
  const titular = campo({ name: 'commonName' }, sujeto) ?? campo({ name: 'organizationName' }, sujeto) ?? 'Sin nombre'
  const emisor = campo({ name: 'organizationName' }, delTitular.issuer) ?? campo({ name: 'commonName' }, delTitular.issuer) ?? 'Sin emisor'

  const resto = certs.filter((c) => c !== delTitular)
  const cert = [delTitular, ...resto].map((c) => forge.pki.certificateToPem(c)).join('')
  const key = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(clave)))

  return {
    ficha: {
      titular,
      nif,
      nifHuella: nif ? forge.md.sha256.create().update(nif).digest().toHex() : null,
      nifCola: nif ? nif.slice(-3) : null,
      emisor,
      serie: String(delTitular.serialNumber).toLowerCase(),
      validoDesde: desde.toISOString(),
      validoHasta: hasta.toISOString(),
      huella,
      tipo: organizationIdentifier ? 'legal_representative' : serialNumber ? 'natural_person' : 'other',
    },
    material: { cert, key },
  }
}

/** Quien firma una presentación (FIRNIF y FIRNOMBRE): el titular del certificado, leído de su PEM. */
export interface Firmante {
  nif: string
  nombre: string
  /** El NIF de la entidad, si el certificado es de representante. */
  nifEntidad: string | null
}

/**
 * El firmante del primer certificado del PEM (el del titular: leerP12 lo pone
 * primero). La persona es el titular: su NIF va en el serialNumber; si es de
 * representante, la entidad va aparte.
 */
export function firmanteDelPem(forge: Forge, pem: string): Firmante {
  const c = forge.pki.certificateFromPem(pem)
  const s = c.subject
  const nifPersona = nifDelCertificado(campo({ type: '2.5.4.5' }, s), null)
  const nifEntidad = nifDelCertificado(null, campo({ type: '2.5.4.97' }, s))
  const nombre = [campo({ type: '2.5.4.42' }, s), campo({ type: '2.5.4.4' }, s)].filter(Boolean).join(' ') ||
    campo({ name: 'commonName' }, s) || ''
  const nif = nifPersona ?? nifEntidad
  if (!nif || !nombre) throw new CertificadoNoVale('ilegible', 'El certificado no dice de quién es (NIF y nombre): con él no se puede presentar.')
  return { nif, nombre, nifEntidad }
}
