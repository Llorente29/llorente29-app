// src/modules/conta/alta/frases.ts
//
// Lo que dice la IA después de cada respuesta (respuesta 3 del C00). Nunca
// «Apuntado.» a secas: repite lo entendido en negrita y dice qué ha hecho con
// ello. La pregunta siguiente va a continuación, en la misma burbuja, con su
// porqué en el bocadillo. Puro: devuelve trozos de texto, unos en negrita.

import { codigoIae } from '@/modules/conta/empresa/datosEmpresa'
import { fecha } from '@/modules/conta/alta/guion'
import { TEXTO_IVA_VENTAS } from '@/modules/conta/lib/ivaVentas'

export interface Trozo { t: string; b?: true }
export type Frase = Trozo[]

const n = (t: string): Trozo => ({ t, b: true })
const y = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

/** El texto plano de una frase (para pruebas y para el lector de pantalla). */
export const enTexto = (f: Frase): string => f.map((x) => x.t).join('')

export function fraseNif(nif: string): Frase {
  return [{ t: 'Entendido: NIF ' }, n(nif), { t: '. Con él empiezo la ficha de tu empresa.' }]
}

export function fraseSinNif(): Frase {
  return [{ t: 'Sigo ' }, n('sin NIF'), { t: ' por ahora y se lo apunto a tu asesor. Sin él no se puede terminar el alta.' }]
}

export function fraseNombre(nombre: string): Frase {
  return [{ t: 'Entendido: ' }, n(nombre), { t: '. Lo he puesto como razón social.' }]
}

export function fraseDireccion(linea: string): Frase {
  return [{ t: 'Apuntada la dirección: ' }, n(linea), { t: '.' }]
}

export interface ActividadDicha { descripcion: string; iae: string | null }

export function fraseActividades(dicho: string, elegidas: ActividadDicha[], ivaVentas: string | null): Frase {
  const out: Frase = [{ t: 'Entendido: ' }, n(dicho.trim().replace(/[.\s]+$/, '')), { t: '. Lo he apuntado como ' }]
  elegidas.forEach((a, i) => {
    if (i > 0) out.push({ t: i === elegidas.length - 1 ? ' y ' : ', ' })
    out.push(n(a.descripcion.toLowerCase()))
    if (a.iae) out.push({ t: ` (epígrafe ${codigoIae(a.iae)})` })
  })
  if (ivaVentas) out.push({ t: ', y el IVA de tus ventas al ' }, n(TEXTO_IVA_VENTAS[ivaVentas] ?? ivaVentas))
  out.push({ t: '.' })
  return out
}

export function fraseActividadAMano(descripcion: string, iae: string | null, ivaVentas: string | null): Frase {
  const out: Frase = [{ t: 'Apuntada tu actividad: ' }, n(descripcion)]
  if (iae) out.push({ t: ` (epígrafe ${codigoIae(iae)})` })
  if (ivaVentas) out.push({ t: ', y el IVA de tus ventas al ' }, n(TEXTO_IVA_VENTAS[ivaVentas] ?? ivaVentas))
  out.push({ t: '.' })
  return out
}

export function frasePeriodo(valor: string): Frase {
  return [{ t: 'Entendido: el IVA ' }, n(valor === 'monthly' ? 'cada mes' : 'cada tres meses'), { t: '.' }]
}

export function fraseRetiene(si: boolean): Frase {
  return si
    ? [{ t: 'Entendido: ' }, n('retienes'), { t: ' en nóminas o facturas de profesionales.' }]
    : [{ t: 'Entendido: ' }, n('no retienes'), { t: ' a nadie.' }]
}

export function fraseAlquiler(si: boolean): Frase {
  return si
    ? [{ t: 'Entendido: ' }, n('pagas un alquiler con retención'), { t: '.' }]
    : [{ t: 'Entendido: ' }, n('sin alquiler con retención'), { t: '.' }]
}

export function fraseRetenido70(si: boolean): Frase {
  return [{ t: 'Entendido: ' }, n(si ? 'el 70 % o más llevó retención' : 'menos del 70 % llevó retención'), { t: '.' }]
}

export function fraseModelos(modelos: string[]): Frase {
  return modelos.length
    ? [{ t: 'Con eso, presentas los modelos ' }, n(y(modelos)), { t: '. El porqué de cada uno está en «Tu empresa».' }]
    : [{ t: 'Con eso no presentas ningún modelo de los que conozco.' }]
}

export function fraseCuentas(plan: 'pymes' | 'normal', digitos: number, ejercicio: { code: string; startsOn: string; endsOn: string }): Frase {
  return [
    { t: 'Entendido: ' }, n(plan === 'pymes' ? 'plan de pymes' : 'plan general'),
    { t: '. Te dejo cuentas de ' }, n(`${digitos} dígitos`), { t: ' y el ejercicio ' }, n(ejercicio.code),
    { t: ` abierto, del ${fecha(ejercicio.startsOn)} al ${fecha(ejercicio.endsOn)}.` },
  ]
}

export function fraseDuda(textoDuda: string): Frase {
  return [{ t: textoDuda }]
}
