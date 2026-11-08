// src/modules/conta/gestoria/g04/enlaces.ts
//
// G04 · Tarea 4 · Lo que usa la página de Clientes y no es un componente: el
// mes en palabras, el enlace a la ficha en el CRM conectado y «Exportar» (la
// lista que se ve, en CSV para Excel).

import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import type { FilaDeLaLista } from './modelo'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const mesEnPalabras = (hoy: string) => `${MESES[Number(hoy.slice(5, 7)) - 1]} de ${hoy.slice(0, 4)}`

/** La dirección de la ficha de un cliente en el CRM conectado (hoy, Bitrix24), si se sabe el portal. */
export function enlaceAlCrm(crm: string | null, portal: string | null, tipoFicha: string | null, idExterno: string | null): string | null {
  if (crm !== 'bitrix24' || !portal || !idExterno) return null
  return `https://${portal}/crm/${tipoFicha === 'contacto' ? 'contact' : 'company'}/details/${encodeURIComponent(idExterno)}/`
}

/** Exportar la lista que se ve, en CSV (se abre con Excel). */
export function exportar(filas: FilaDeLaLista[]) {
  const c = (v: string) => `"${v.replace(/"/g, '""')}"`
  // eslint-disable-next-line no-restricted-syntax -- cálculo local: «x» ya se comprobó que no es null
  const cent = (x: number | null) => (x === null ? '' : (x / 100).toFixed(2).replace('.', ','))
  const lineas = [['Cliente', 'NIF', 'Le factura', 'Qué le cobras', 'Este mes (GoCardless)', 'Sumied calcula', 'Debe', 'Cobro'].map(c).join(';'),
    ...filas.map((f) => [f.nombre, f.nif ?? '', f.empresa ?? 'Sin empresa', f.servicios, cent(f.esteMes.principalCent), cent(f.esteMes.comparacionCent), cent(f.debeCent), f.estado.texto].map(c).join(';'))]
  const url = URL.createObjectURL(new Blob([`\ufeff${lineas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = `clientes-${hoyEnMadrid()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

