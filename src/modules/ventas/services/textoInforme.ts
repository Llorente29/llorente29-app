// src/modules/ventas/services/textoInforme.ts
//
// El informe, dicho en castellano.
//
// B78 §3.bis: la cabecera enseñaba `{"locales":["38158159-cd71-..."]}` y
// `account_id = la cuenta · is_active · status <> cancelled`. Eso es salida de
// desarrollador delante de un cliente. La banda de medida SE QUEDA —es lo que
// protege de medir una cosa y creer que se mide otra, y lo que permite cuadrar
// la pantalla con el correo— pero se dice con palabras.
//
// REGLA, y vale para toda pantalla de cliente: no se enseña un identificador
// interno, ni un nombre de columna, ni un trozo de SQL. Si un dato no se puede
// decir con palabras, no se enseña — se guarda para el soporte.
//
// Vive fuera del componente por lo mismo que `catalogPick.ts` en B72: un
// fichero de componente que exporta funciones rompe el fast refresh, y aquí
// además se puede probar sin pintar nada.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * «Del 24 al 30 de agosto» a partir de los dos instantes que devuelve la RPC.
 *
 * B78 §3.bis: la cabecera enseñaba `{"locales":["38158159-..."]}` y
 * `account_id = la cuenta · is_active · status <> cancelled` — salida de
 * desarrollador delante de un cliente. La banda SE QUEDA, porque es lo que
 * protege de medir una cosa y creer que se mide otra; lo que cambia es que se
 * dice en castellano. Si un dato no se puede decir con palabras, no se enseña.
 *
 * El límite superior es EXCLUSIVO —la ventana acaba el lunes 00:00— así que
 * para nombrar el último día se resta un minuto: «al 30», no «al 31».
 */
export function intervaloEnCastellano(desde: string, hasta: string): string {
  const d = parte(desde)
  const h = parte(hasta)
  const finExclusivo = h.hora === '00:00'
  const hDia = finExclusivo ? diaAnteriorDe(h) : h
  if (d.ymd === hDia.ymd) {
    return `El ${hDia.dia} de ${MESES[hDia.mes - 1]}` +
      (finExclusivo ? '' : `, hasta las ${h.hora}`)
  }
  const mismoMes = d.mes === hDia.mes && d.anio === hDia.anio
  return `Del ${d.dia}${mismoMes ? '' : ` de ${MESES[d.mes - 1]}`} al ${hDia.dia} de ${MESES[hDia.mes - 1]}` +
    (finExclusivo ? '' : `, hasta las ${h.hora}`)
}

function parte(v: string) {
  const [ymd, hora] = v.split(' ')
  const [anio, mes, dia] = ymd.split('-').map(Number)
  return { ymd, anio, mes, dia, hora: hora ?? '00:00' }
}

function diaAnteriorDe(p: { anio: number; mes: number; dia: number }) {
  const d = new Date(Date.UTC(p.anio, p.mes - 1, p.dia))
  d.setUTCDate(d.getUTCDate() - 1)
  return { ymd: d.toISOString().slice(0, 10), anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: '00:00' }
}
