// src/lib/registroDeJornadaTexto.ts
//
// L1a · PR 1 (27/10/2026). Qué se guarda cuando una persona ficha, para qué y
// cuánto tiempo. Un solo texto con dos salidas: lo lee el trabajador en
// «Mi portal › Ajustes» y lo descarga la empresa desde Control horario para
// entregarlo o colgarlo (el deber de informar del art. 90 de la LOPDGDD, sobre
// todo por la ubicación).
//
// Lo que dice tiene que ser lo que hace la base: fichar() y
// conservar_registro_de_jornada() de la migración 20261027T1905. Si cambia una,
// cambia este texto en el mismo PR.

export interface ApartadoDelTexto {
  titulo: string
  parrafos: string[]
}

export const TITULO_REGISTRO_DE_JORNADA = 'Tu registro de jornada: qué se guarda y cuánto tiempo'

export const APARTADOS_REGISTRO_DE_JORNADA: ApartadoDelTexto[] = [
  {
    titulo: 'Para qué',
    parrafos: [
      'La ley obliga a la empresa a llevar un registro diario de la jornada de cada persona, con la hora de entrada y la de salida, y a guardarlo cuatro años (art. 34.9 del Estatuto de los Trabajadores). Lo pueden pedir tú, tus representantes y la Inspección de Trabajo.',
      'Los datos de tus fichajes se usan para eso y para calcular tus horas. No se usan para nada más.',
    ],
  },
  {
    titulo: 'Qué se guarda cada vez que fichas',
    parrafos: [
      'Si es entrada o salida, y la hora. La hora la pone el servidor, no tu móvil: así nadie puede adelantarla ni atrasarla.',
      'Desde dónde: tu móvil o la tablet del local.',
      'Tu ubicación, solo en el momento de fichar. La app no te sigue durante el turno ni cuando no estás trabajando: pide la ubicación una vez, al pulsar «Fichar», y nada más. Con ella se calcula a cuántos metros estabas del local y si estabas dentro del radio que tiene configurado.',
      'Si fichas fuera del radio, por defecto el fichaje se guarda igual: queda marcado y se avisa a tu encargado. Cada local puede ajustar el radio y elegir si un fichaje fuera se guarda marcado o no se deja hacer.',
      'La app no hace fotos al fichar.',
    ],
  },
  {
    titulo: 'Si fichas sin cobertura',
    parrafos: [
      'Puedes fichar igual. El fichaje se queda en tu móvil con su hora y se envía solo en cuanto vuelve la red. Se guardan las dos horas: la de tu móvil cuando pulsaste y la de cuando llegó al servidor.',
      'Si al llegar no se puede guardar (por ejemplo, porque han pasado más de tres días sin red), lo verás en tu portal con el motivo, para que pidas la corrección.',
    ],
  },
  {
    titulo: 'Si hay que corregir un fichaje',
    parrafos: [
      'Una marca que pone o cambia el encargado o la administración es una corrección: lleva siempre un motivo y queda apuntado quién la hizo y cuándo, junto a cómo estaba antes. Nada se borra sin dejar rastro.',
      'Tú puedes pedir una corrección desde «Mis fichajes».',
    ],
  },
  {
    titulo: 'Quién lo ve',
    parrafos: [
      'Tú, lo tuyo.',
      'El encargado de tu local, los fichajes y las ausencias de las personas de sus locales. No ve tu salario, tu DNI ni tu fecha de nacimiento. Si estás de baja, le sale como «ausente», sin el motivo.',
      'La administración de la empresa, todo.',
    ],
  },
  {
    titulo: 'Cuánto tiempo',
    parrafos: [
      'La ubicación exacta, tres meses. Después se borra y se quedan solo la distancia al local y si estabas dentro o fuera del radio.',
      'El registro de jornada, cuatro años, como pide la ley. Después se anonimiza: se quitan los textos libres y lo que pueda identificar el sitio desde el que fichaste, y queda la cuenta de horas.',
      'Esto lo hace el sistema solo, cada noche.',
    ],
  },
  {
    titulo: 'Lo que puedes ver tú',
    parrafos: [
      'Después de cada fichaje, tu portal te enseña lo que se guardó: la hora, desde dónde y a qué distancia del local.',
      'Para cualquier duda sobre tus datos, o para ejercer tus derechos de acceso, rectificación u oposición, dirígete a la administración de la empresa.',
    ],
  },
]

function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** El texto como página HTML imprimible, para que la empresa lo entregue. */
export function htmlDelTextoRegistroDeJornada(empresa?: string | null): string {
  const cabecera = empresa ? `<p class="empresa">${escapar(empresa)}</p>` : ''
  const cuerpo = APARTADOS_REGISTRO_DE_JORNADA.map(a =>
    `<h2>${escapar(a.titulo)}</h2>\n${a.parrafos.map(p => `<p>${escapar(p)}</p>`).join('\n')}`,
  ).join('\n')
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(TITULO_REGISTRO_DE_JORNADA)}</title>
<style>
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1f2328; background: #fff; max-width: 680px; margin: 32px auto; padding: 0 16px; line-height: 1.55; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 6px; }
  p { margin: 0 0 8px; font-size: 14px; }
  .empresa { color: #57606a; font-size: 13px; margin-bottom: 20px; }
  @media print { body { margin: 0 auto; } }
</style>
</head>
<body>
<h1>${escapar(TITULO_REGISTRO_DE_JORNADA)}</h1>
${cabecera}
${cuerpo}
</body>
</html>
`
}

/** Descarga el texto como .html (se abre en cualquier navegador y se imprime). */
export function descargarTextoRegistroDeJornada(empresa?: string | null): void {
  const blob = new Blob([htmlDelTextoRegistroDeJornada(empresa)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'registro-de-jornada-que-se-guarda.html'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
