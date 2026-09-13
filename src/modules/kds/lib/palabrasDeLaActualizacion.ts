// El castellano de las dos caras que se ven cuando una tablet se actualiza.
//
// Vive en `lib/` y no dentro de los componentes por dos motivos: se puede
// probar contra los estados REALES sin montar React, y se puede leer y discutir
// sin abrir un .tsx. (Exportar funciones desde un fichero de componente además
// enciende `react-refresh` en el lint — lección del 05/09.)
//
// LAS DOS CARAS:
//   · la FRANJA de la tablet — la lee un cocinero de pie, entre dos comandas;
//   · la LÍNEA de la oficina — la lee un administrativo que acaba de publicar.
// Ninguna de las dos dice números de versión: eso es un identificador, no una
// explicación.

import type { UpdateWindow } from '@/native/appUpdate'

/** Los motivos que devuelve `kds_device_bundle_status.motivo_espera`. */
export type MotivoEspera =
  | 'aparato_apagado' | 'no_da_senales' | 'servicio_o_margen'
  | 'sin_horario_declarado_hoy' | 'fuera_de_ventana' | 'cocina_ocupada'
  | 'a_punto_de_instalarse' | null

export interface EstadoParaLaOficina {
  estado: 'al_dia' | 'atrasado' | 'muy_atrasado' | 'builtin' | 'desconocido'
  motivoEspera: MotivoEspera
  aplicadoEn: string | null
  horasDesfase: number | null
  /** El local de esta tablet. La línea NOMBRA de dónde sale la ventana. */
  local?: string | null
  /** La última vez que alguien pulsó «Instalar ahora» aquí. */
  instaladoAManoAt?: string | null
}

export function laHora(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

// ── LA FRANJA DE LA TABLET ─────────────────────────────────────────────────
// Qué está esperando esta tablet, dicho para quien está cocinando.
export function loQueEsperaLaTablet(w: UpdateWindow | null, tabletLibre: boolean): string {
  if (!w) return 'Se instalará sola cuando no haya pedidos en marcha.'
  if (w.pendingJobs > 0) return 'Hay tickets imprimiéndose; se instalará al terminar.'
  if (w.activeOrders > 0) return 'Hay pedidos en marcha; se instalará al terminar el servicio.'
  if (!w.enVentana && w.motivoVentana === 'servicio_o_margen') {
    return 'Se instalará sola al cerrar el local.'
  }
  if (!tabletLibre) return 'Se instalará cuando la tablet quede libre.'
  return 'Se instalará sola cuando no haya pedidos en marcha.'
}

/** Lo que se dice cuando la tablet NO puede preguntar a la base. */
export const NO_PUEDE_PREGUNTAR =
  'No se puede consultar si la cocina está libre, así que no se instalará sola.'

// ── LA LÍNEA DE LA OFICINA ─────────────────────────────────────────────────
// EN PALABRAS, NO EN IDENTIFICADORES. Antes decía «bundle 284 · el último es el
// 285»: verdad, y no sirve. Quien publica desde la oficina no sabe qué es un
// bundle, y sobre todo no sabía POR QUÉ una tablet iba retrasada — o sea, no
// podía distinguir «espera porque hay servicio» de «algo está roto», que es la
// única distinción que importa.
//
// El ROJO se reserva para lo que pide una acción (regla 7): una tablet que
// espera a que acabe el servicio NO es una alarma, es el sistema funcionando.
// Si todo se pinta rojo, el rojo deja de significar nada.
export function loQueLeeLaOficina(b: EstadoParaLaOficina): { texto: string; rojo: boolean } {
  // De dónde sale la ventana, con el local por su nombre. Si alguien no
  // entiende por qué son las 17:15, la pantalla ha fallado (Julio, 13/09).
  const donde = b.local ? ` de ${b.local}` : ''

  // El rastro de «Instalar ahora» acompaña SIEMPRE, esté la tablet al día o no:
  // es el único camino que se salta la ventana, y saltársela es justo lo que
  // hay que poder leer sin deducirlo.
  const aMano = laHora(b.instaladoAManoAt ?? null)
  const rastro = aMano ? ` · alguien la instaló a mano a las ${aMano}` : ''

  if (b.estado === 'al_dia') {
    const cuando = laHora(b.aplicadoEn)
    return {
      texto: (cuando ? `Puesta al día a las ${cuando}` : 'Puesta al día') + rastro,
      rojo: false,
    }
  }
  if (b.estado === 'builtin') {
    return { texto: 'Nunca se ha actualizado: sigue con lo que traía de fábrica', rojo: true }
  }
  if (b.estado === 'desconocido') {
    return { texto: 'No dice qué versión lleva, así que nadie la está vigilando', rojo: true }
  }

  // Va por detrás. El texto lo decide POR QUÉ espera, no cuánto lleva.
  const desde = laHora(b.aplicadoEn)
  const cola = desde ? ` (sigue con la del ${desde})` : ''
  switch (b.motivoEspera) {
    case 'servicio_o_margen':
      return {
        texto: `Esperando a que acabe el servicio${donde}${cola}${rastro}`,
        rojo: false,
      }
    case 'cocina_ocupada':
      return {
        texto: `Esperando: hay pedidos o tickets en marcha${donde}${cola}${rastro}`,
        rojo: false,
      }
    case 'a_punto_de_instalarse':
      return {
        texto: `A punto de instalarse: ${b.local ?? 'el local'} está fuera de su horario${cola}${rastro}`,
        rojo: false,
      }
    case 'sin_horario_declarado_hoy':
      return {
        texto: `No se actualiza: ${b.local ?? 'el local'} no tiene horario puesto para hoy, `
             + 'y sin horario no se sabe cuándo es seguro' + rastro,
        rojo: true,
      }
    case 'aparato_apagado':
      return { texto: 'Revocada: no va a actualizarse', rojo: false }
    case 'no_da_senales':
      return {
        texto: (b.horasDesfase != null
          ? `No da señales, y lleva ${b.horasDesfase} h sin coger lo nuevo`
          : 'No da señales desde hace rato') + rastro,
        rojo: true,
      }
    default:
      // Va por detrás y nada lo explica: eso sí pide que alguien mire.
      return {
        texto: (b.horasDesfase != null
          ? `Lleva ${b.horasDesfase} h sin coger lo nuevo y no se sabe por qué`
          : 'Va por detrás y no se sabe por qué') + rastro,
        rojo: b.estado === 'muy_atrasado',
      }
  }
}

// ── LAS DOS LLAVES, EN UN SOLO SITIO ───────────────────────────────────────
// La decisión de si se puede aplicar ahora. Está aquí y no en el componente
// para que se pueda probar sin montar React: es la regla que decide si una
// tablet se recarga en mitad de una cena.
export function sePuedeAplicarAhora(opciones: {
  w: UpdateWindow | null
  esEstacion: boolean
  tabletLibre: boolean
  urgente: boolean
  blind: boolean
}): { puede: boolean; ciego: boolean } {
  const { w, esEstacion, tabletLibre, urgente, blind } = opciones

  // Ciego = no se puede saber. Sin respuesta, sin la RPC, o con una base que
  // todavía no conoce la primera llave. Antes esto ABRÍA la puerta; ahora la
  // cierra, y la única salida es que una persona marque la publicación como
  // urgente.
  const ciego = w === null || w.unsupported === true || !w.soportaVentana || blind

  if (!esEstacion) return { puede: tabletLibre, ciego }
  if (ciego) return { puede: urgente, ciego }

  const lasDos = w.enVentana === true && w.safe === true
  return { puede: lasDos && (tabletLibre || urgente), ciego }
}
