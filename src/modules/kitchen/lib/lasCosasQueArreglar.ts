// src/modules/kitchen/lib/lasCosasQueArreglar.ts
//
// B79 lote 4. Las cinco cosas del Resumen: qué se llama cada una en castellano,
// qué botón lleva y A DÓNDE. Fuera del componente para poder probarlo sin pintar
// nada, y porque un fichero de componente que exporta constantes rompe el fast
// refresh.
//
// LOS NÚMEROS NO ESTÁN AQUÍ. Los cuenta `kitchen_catalog_gaps`, y cada contador
// llega con su definición escrita desde la propia base. Aquí sólo está lo que la
// base no puede saber: cómo se le dice a una persona y a qué pantalla se le manda.
//
// LA REGLA QUE ESTO PROTEGE: ningún botón sin destino que exista hoy. Los cinco
// destinos son rutas reales del módulo (`src/modules/kitchen/module.tsx`), no
// inventadas: '' (Ingredientes) · 'menu' (Cartas) · 'casado' (Casado) ·
// 'recetas' (Platos) · 'ajustes' (Ajustes). La prueba lo comprueba contra esa
// misma lista, así que si alguien renombra una ruta, se pone roja sola.


/** Las rutas del módulo Kitchen que existen HOY, relativas a `/kitchen/`. */
export const RUTAS_DE_KITCHEN = [
  '', 'resumen', 'menu', 'casado', 'extras', 'disponibilidad', 'disponibilidad-informes',
  'proveedores', 'recetas', 'precios', 'rentabilidad', 'ingenieria-menus',
  'ofertas', 'ofertas-reglas', 'ofertas-clasico', 'ajustes',
] as const

export type ClaveDeCosa =
  | 'extras_que_cobran_sin_coste'
  | 'platos_en_carta_sin_coste'
  | 'platos_en_carta_sin_envase'
  | 'sin_objetivo_de_comida'
  | 'ingredientes_sin_precio'

/** Lo que devuelve `kitchen_catalog_gaps` por cada cosa, ya en camelCase. */
export interface CosaMedida {
  clave: ClaveDeCosa
  orden: number
  n: number
  de: number | null
  /** Castellano de persona. Es la ÚNICA que se pinta. */
  definicion: string
  /**
   * La regla técnica, con sus columnas. Viaja para soporte y para poder auditar
   * el número — y NO SE PINTA NUNCA en pantalla de cliente (B83). Si algún día
   * alguien la quiere ver, va detrás de un pliegue, no suelta bajo la fila.
   */
  reglaTecnica?: string
  porQueAqui: string
  accion: string
  peores: Array<{ brandId: string | null; marca: string; n: number; de: number }>
  /** Sólo en algunos contadores. */
  venden?: number
  sinFicha?: number
  conFichaSinCoste?: number
  usadosEnLineasDeReceta?: number
  platosConObjetivoPropio?: number
  hayFilaDeAjustes?: boolean
}

export interface CosaPintada {
  clave: ClaveDeCosa
  titulo: string
  motivo: string
  boton: string
  /** Ruta relativa a `/kitchen/`, con su parámetro o su ancla si los lleva. */
  destino: string
}

function pluraliza(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios
}

/**
 * El título, el motivo y el botón de una cosa, con sus números metidos.
 *
 * El motivo no repite el título: dice QUÉ PASA si no se arregla, que es lo que
 * decide si merece la pena. Y no afirma nada que el contador no haya medido.
 */
/**
 * LAS MARCAS QUE MÁS PESAN, en una frase: «The Urban Kebab 18 de 27 · Scandal
 * Burgers 16 de 17 · Big Mike´s 12 de 14 · y 8 marcas más».
 *
 * Estaba escrita dos veces —en la pantalla y en la captura— y las dos decían
 * «y 1 marcas más». Una frase repetida en dos sitios es una frase que se
 * corrige en uno solo; por eso baja aquí, donde se puede probar.
 */
export function lasQueMasPesan(
  peores: Array<{ marca: string; n: number; de: number }>,
  cuantas = 3,
): string | null {
  if (peores.length === 0) return null
  const primeras = peores.slice(0, cuantas).map((x) => `${x.marca} ${x.n} de ${x.de}`).join(' · ')
  const resto = peores.length - cuantas
  if (resto <= 0) return primeras
  return `${primeras} · y ${resto} ${pluraliza(resto, 'marca', 'marcas')} más`
}

export function pintaCosa(
  c: CosaMedida,
  envaseEur: number | null,
  /**
   * La comida sobre ventas que enseña la cifra grande, para poder decir la
   * consecuencia con el número delante (B83.3): «el coste real es mayor que el
   * 24,1 %» dice algo; «mayor que el de arriba» obliga a subir la vista y
   * acordarse. Opcional: sin ella se dice «el de arriba», que es lo que había.
   */
  comidaPct?: number | null,
): CosaPintada {
  const elDeArriba = comidaPct != null && Number.isFinite(comidaPct)
    ? `el ${comidaPct.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
    : 'el de arriba'
  switch (c.clave) {
    case 'extras_que_cobran_sin_coste': {
      const venden = c.venden ?? 0
      return {
        clave: c.clave,
        titulo: `${c.n} ${pluraliza(c.n, 'extra que cobra', 'extras que cobran')} sin coste`,
        motivo:
          `De ${c.de ?? '—'} opciones que cobran dinero, ${c.n} aportan 0,00 € al coste` +
          (venden > 0
            ? `, y ${venden} se ${pluraliza(venden, 'ha vendido', 'han vendido')} en los últimos 30 días. `
            : '. ') +
          'Entran por caja y no descuentan comida, así que la cifra de arriba sale mejor de lo que es. ' +
          'Se arreglan en Cartas, en la pestaña «Modificadores» de cada producto.',
        boton: c.accion,
        destino: 'menu',
      }
    }

    case 'platos_en_carta_sin_coste': {
      const sinFicha = c.sinFicha ?? 0
      const conFicha = c.conFichaSinCoste ?? 0
      // B83: el botón abre Casado EN LA MARCA que la propia fila nombra la
      // primera — la que más platos sin ficha tiene. Antes abría en la primera
      // por alfabeto, que en Foodint es «Ay Mamita Bowls» y encima cedida: la
      // pantalla correcta y la marca equivocada.
      const peor = c.peores[0]?.brandId ?? null
      const trozos: string[] = []
      if (sinFicha > 0) trozos.push(`${sinFicha} sin ficha enlazada`)
      if (conFicha > 0) trozos.push(`${conFicha} con ficha sin cerrar`)
      return {
        clave: c.clave,
        titulo: `${c.n} ${pluraliza(c.n, 'plato', 'platos')} sin ficha de coste`,
        motivo:
          `${trozos.join(' y ')}. Se venden sin que Folvy sepa lo que cuestan, así que se quedan ` +
          'FUERA de la cifra de arriba: no la empeoran, la dejan incompleta.',
        boton: c.accion,
        destino: peor ? `casado?marca=${peor}` : 'casado',
      }
    }

    case 'platos_en_carta_sin_envase': {
      const conEnvase = (c.de ?? 0) - c.n
      return {
        clave: c.clave,
        titulo: `${c.n} ${pluraliza(c.n, 'plato', 'platos')} sin envase`,
        motivo:
          `Su envase cuenta como cero. ${envaseEur !== null
            ? `El envase de los ${conEnvase} que sí lo tienen vale unos ${eurDeCocina(envaseEur)} de lo vendido en 30 días: `
            : `Con ${conEnvase} de ${c.de ?? '—'} con envase puesto: `}` +
          `el coste real de la comida es mayor que ${elDeArriba}.`,
        boton: c.accion,
        destino: 'recetas',
      }
    }

    case 'sin_objetivo_de_comida': {
      const propios = c.platosConObjetivoPropio ?? 0
      return {
        clave: c.clave,
        titulo: 'Sin objetivo de comida',
        motivo:
          (propios > 0
            ? `${propios} ${pluraliza(propios, 'plato tiene', 'platos tienen')} su objetivo; los demás usan el de la cuenta, que no está puesto. `
            : 'La cuenta no tiene objetivo puesto. ') +
          'Sin él, Folvy puede decirte cuánto cuesta cada plato, pero no si eso está bien o mal.',
        boton: c.accion,
        // El ancla existe desde el §3.11: es la sección nueva de Ajustes.
        destino: 'ajustes#objetivo-de-comida',
      }
    }

    case 'ingredientes_sin_precio': {
      const usados = c.usadosEnLineasDeReceta
      return {
        clave: c.clave,
        titulo: `${c.n} ${pluraliza(c.n, 'ingrediente', 'ingredientes')} sin precio`,
        motivo:
          (usados === 0
            ? 'Todavía no están en ninguna receta, así que hoy no bloquean ningún coste. '
            : usados != null
              ? `Aparecen en ${usados} ${pluraliza(usados, 'línea de receta', 'líneas de receta')}. `
              : '') +
          'Ponles precio antes de usarlos, o el primer plato que los lleve nacerá sin coste.',
        boton: c.accion,
        destino: '',
      }
    }
  }
}

/**
 * ¿Esta cosa está pendiente? Es lo único que decide si sale con el filtro «sólo
 * lo que hay que arreglar» puesto.
 *
 * Y ojo con la regla 7: el filtro decide el ORDEN y la ETIQUETA, nunca la
 * EXISTENCIA. Quien pinte esto tiene que decir cuántas está dejando fuera —
 * `cuantasResueltas` está justo debajo para eso.
 */
export function estaPendiente(c: CosaMedida): boolean {
  return c.n > 0
}

export function cuantasResueltas(cosas: CosaMedida[]): number {
  return cosas.filter((c) => !estaPendiente(c)).length
}

/** El destino sin su parámetro ni su ancla, que es lo que tiene que ser una ruta real. */
export function rutaDe(destino: string): string {
  return destino.split('#')[0].split('?')[0]
}

/**
 * EUROS ENTEROS COMO LOS PINTA LA MAQUETA: «6.693 €», «927 €», «7.181 €».
 *
 * `fmtInt` usa `toLocaleString('es-ES')` a secas, y en español eso NO agrupa los
 * números de cuatro cifras: «7181» sale sin punto y «14.473» con él, en la misma
 * columna. Medido, no supuesto — `(7181).toLocaleString('es-ES')` da «7181».
 *
 * No se arregla en `fmtInt` porque lo usan doce ficheros de toda la app —Supply,
 * Almacén, Personal, Órdenes— y cambiarlo movería el aspecto de pantallas que no
 * tienen su captura comparada (§11: eso es justo lo que no se hace). Aquí va
 * acotado a Kitchen, y queda escrito como deuda del formato común.
 */
export function eurDeCocina(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${Math.round(Number(v)).toLocaleString('es-ES', { useGrouping: true })} €`
}

/** El porcentaje de cobertura, entero: la maqueta pinta «96 %», no «96,2 %». */
export function pctEnteroDeCocina(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${Math.round(Number(v))} %`
}

/**
 * LA COLETILLA DE LO QUE NO CAMBIA AL ELEGIR UN LOCAL (B83, condición de Julio).
 *
 * Las cifras de catálogo salen de `kitchen_catalog_gaps`, que cuenta la CUENTA:
 * no acepta local y no cambiaría aunque lo aceptase — un plato sin ficha lo está
 * en los dos sitios. Sin decirlo, elegir Alcalá y ver el mismo «422 de 551» se
 * lee como un filtro roto; y quien lo lea así dejará de fiarse también de las
 * cifras que sí han cambiado. Es la regla 7 vista del revés: no se esconde que
 * algo NO se ha filtrado.
 *
 * Devuelve cadena vacía cuando no hay local elegido: sin filtro no hay nada que
 * matizar, y la coletilla en «Todos» sería ruido.
 */
export function loQueNoCambiaConElLocal(localElegido: string | null | undefined): string {
  return localElegido ? ' · toda la cuenta' : ''
}
