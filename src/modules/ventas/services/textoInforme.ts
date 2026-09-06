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
export function intervaloEnCastellano(desde: string, hasta: string): string | null {
  const d = parte(desde)
  const h = parte(hasta)
  // B82 (06/09/2026): un formato que esta funcion no sabe leer NO puede tumbar
  // la pantalla. Antes seguia adelante con `dia = NaN`, llegaba a `Date.UTC(...,
  // NaN)` y `toISOString()` lanzaba `RangeError: Invalid time value` en pleno
  // render — tres pantallas de Kitchen en blanco. Ahora devuelve null y quien
  // llama decide qué decir. El contrato es `YYYY-MM-DD HH:MM`, con ESPACIO: un
  // ISO con «T» no vale (ver `fechaParaIntervalo` abajo).
  if (!d || !h) return null
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
  const [ymd, hora] = (v ?? '').split(' ')
  const [anio, mes, dia] = (ymd ?? '').split('-').map(Number)
  // Se comprueba lo que se va a usar, no «que parezca una fecha»: si alguno de
  // los tres no es un numero, no hay dia que nombrar.
  if (!Number.isFinite(anio) || !Number.isFinite(mes) || !Number.isFinite(dia)) return null
  if (mes < 1 || mes > 12) return null
  return { ymd, anio, mes, dia, hora: hora ?? '00:00' }
}

/**
 * Un `Date` en el formato que ESTA funcion sabe leer: `YYYY-MM-DD HH:MM`, en
 * hora LOCAL — que es la que hay que enseñarle a una persona, y la misma que
 * manda la RPC de Informes.
 *
 * Existe porque tres pantallas le pasaron `toISOString()` y la reventaron: el
 * ISO lleva «T» donde esta espera un espacio, asi que el dia salia `NaN`. Si
 * hace falta una fecha para esta funcion, se construye aqui y no a mano.
 */
export function fechaParaIntervalo(d: Date): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * El intervalo a partir de dos `Date`, sin que quien llame tenga que saber el
 * formato.
 *
 * `minuscula` es para cuando la frase NO empieza aquí: «vendido del 8 de junio»,
 * no «vendido Del 8 de junio» (B83). Sólo baja la primera letra; los meses ya van
 * en minúscula y los nombres propios no aparecen en este texto.
 */
export function intervaloDeFechas(
  desde: Date, hasta: Date, opciones?: { minuscula?: boolean },
): string | null {
  const a = fechaParaIntervalo(desde)
  const b = fechaParaIntervalo(hasta)
  if (a === null || b === null) return null
  const texto = intervaloEnCastellano(a, b)
  if (texto === null) return null
  return opciones?.minuscula ? texto.charAt(0).toLowerCase() + texto.slice(1) : texto
}

function diaAnteriorDe(p: { anio: number; mes: number; dia: number }) {
  const d = new Date(Date.UTC(p.anio, p.mes - 1, p.dia))
  d.setUTCDate(d.getUTCDate() - 1)
  return { ymd: d.toISOString().slice(0, 10), anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: '00:00' }
}
