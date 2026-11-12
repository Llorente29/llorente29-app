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


/** Una fila de «Descargar clientes y precios»: cada cliente con lo que tiene y lo que paga este mes. */
export interface FilaDePrecios { cliente: string; nif: string; servicios: string; esteMes: string }

const escapar = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** «Descargar clientes y precios · Excel» (CSV con punto y coma, que Excel abre en español). */
export function descargarPrecios(filas: FilaDePrecios[], empresa: string): Resultado {
  const c = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lineas = [['Cliente', 'NIF', 'Servicios, nivel y paquete', 'Lo que paga este mes'].map(c).join(';'), ...filas.map((f) => [f.cliente, f.nif, f.servicios, f.esteMes].map(c).join(';'))]
  const url = URL.createObjectURL(new Blob([`\ufeff${lineas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  const nombre = `clientes-y-precios-${empresa.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${hoyEnMadrid()}.csv`
  a.href = url; a.download = nombre; a.click()
  URL.revokeObjectURL(url)
  return { ok: true, texto: `Descargado ${nombre}: ${filas.length} clientes con sus servicios y lo que pagan este mes.` }
}

/** Abre una página lista para imprimir (o guardar en PDF). Si el navegador bloquea la ventana, lo dice. */
export type Resultado = { ok: boolean; texto: string }
function imprimir(titulo: string, cuerpo: string): Resultado {
  const w = window.open('', '_blank')
  if (!w) return { ok: false, texto: 'El navegador no ha dejado abrir la ventana para imprimir: permite las ventanas emergentes de esta página y vuelve a probar.' }
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(titulo)}</title><style>
body{font-family:Inter,system-ui,sans-serif;color:#0F1B2D;margin:32px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:24px 0 8px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E3E8F0}th{color:#4A5B74}
.der{text-align:right}.pie{color:#4A5B74;font-size:12px;margin-top:24px}.logo{max-height:56px;margin-bottom:12px}.caja{border:1px solid #E3E8F0;border-radius:10px;padding:12px 14px;margin:8px 0}
</style></head><body>${cuerpo}<script>window.onload=()=>window.print()</script></body></html>`)
  w.document.close()
  return { ok: true, texto: `«${titulo}» abierta en otra pestaña, para imprimir o guardar en PDF.` }
}

/** «Descargar clientes y precios · PDF»: el mismo listado, para imprimir. */
export function imprimirPrecios(filas: FilaDePrecios[], empresa: string, mes: string): Resultado {
  const cuerpo = `<h1>Clientes y precios · ${escapar(empresa)}</h1><div class="pie">Lo que paga cada cliente en ${escapar(mes)}, según Sumied.</div>
<table><thead><tr><th>Cliente</th><th>NIF</th><th>Servicios</th><th class="der">Este mes</th></tr></thead><tbody>
${filas.map((f) => `<tr><td>${escapar(f.cliente)}</td><td>${escapar(f.nif)}</td><td>${escapar(f.servicios)}</td><td class="der">${escapar(f.esteMes)}</td></tr>`).join('')}
</tbody></table><div class="pie">${filas.length} clientes.</div>`
  return imprimir(`Clientes y precios · ${empresa}`, cuerpo)
}

/** «Tarifa para enseñar a clientes · PDF»: los niveles y paquetes, con el logo de la cuenta si lo tiene. Sin nombres de clientes. */
export function imprimirTarifa(empresa: string, logo: string | null, secciones: { nombre: string; descripcion: string | null; lineas: string[] }[], mes: string): Resultado {
  const cuerpo = `${logo ? `<img class="logo" src="${escapar(logo)}" alt="">` : ''}<h1>Tarifa · ${escapar(empresa)}</h1>
${secciones.map((s) => `<h2>${escapar(s.nombre)}</h2>${s.descripcion ? `<div class="pie">${escapar(s.descripcion)}</div>` : ''}<div class="caja">${s.lineas.map((l) => `<div>${escapar(l)}</div>`).join('')}</div>`).join('')}
<div class="pie">Precios de ${escapar(mes)}.</div>`
  return imprimir(`Tarifa · ${empresa}`, cuerpo)
}
