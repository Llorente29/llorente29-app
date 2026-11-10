#!/usr/bin/env node
// scripts/video/gd/locucion.mjs — GD · El vídeo de Sumied para gestorías (nº96, aprobada por Julio en el nº97).
//
//   node scripts/video/gd/locucion.mjs <salida>     deja <salida>/voz/frases.json para voz_nube.py
//
// Como scripts/video/locucion.mjs (V01): cada frase va pegada a un gesto del guion (el guion la
// dice por su id y espera a que acabe), y el montaje (scripts/video/montar.mjs) hace zoom a lo que
// señala el ratón mientras suena. GESTOS dice a qué va pegada cada una.
//
// Tono técnico-comercial, de tú y sin jerga: qué se ve, qué hace Sumied por dentro y qué le ahorra
// a la gestoría. Solo se afirma lo que hace la pantalla. Ni fechas ni ferias.
// Los datos son de la Gestoría Demo (inventados).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FRASES = {
  // 00 · Portada
  portada: 'Sumied para gestorías: tus clientes, sus cuotas, el cobro, las facturas y la contabilidad, en un solo sitio.',

  // 01 · Clientes y cuotas
  '01.1': 'Aquí están todos tus clientes. Sumied los lee de tu Bitrix24, y las cuotas, de tu tarifa; GoCardless solo pasa el cargo. No das de alta nada dos veces.',
  '01.2': 'Arriba, lo que cobras cada mes, con las altas y las bajas.',
  '01.3': 'Lo que te deben: los recibos que el banco ha devuelto y nadie ha pagado después.',
  '01.4': 'Y lo que dejas de cobrar: clientes que están activos en tu Bitrix24 y no tienen cuota.',
  '01.5': 'Debajo, lo que tienes que hacer, ordenado por el dinero que mueve.',
  '01.6': 'Abres un cliente y ves, de un vistazo, lo que se le cobra este mes, lo que debe y cómo fue su último cobro.',

  // 02 · La ficha de Talleres Ruiz
  '02.1': 'Su cuota sale de tu tarifa. Sumied la calcula y te avisa si no coincide con lo que cobra GoCardless.',
  '02.2': 'Su próximo recibo, línea a línea: cada servicio, su precio y por qué se cobra.',
  '02.3': 'La gestión laboral va por trabajador, y aquí están todos, con nombre.',
  '02.4': 'El que entra nuevo sale marcado con su alta. Así nadie cobra de más ni de menos.',
  '02.5': 'Sus cobros, uno por uno, y sus datos de contacto…',
  '02.6': '…y lo que tienes de él en Bitrix24, tal cual está allí.',

  // 03 · Tarifa y paquetes
  '03.1': 'Tu tarifa, como la cobras hoy, y cuántos clientes tiene cada servicio.',
  '03.2': 'La gestoría mensual, en tres niveles, con lo que incluye cada uno y cuántos clientes están en él.',
  '03.3': 'Si a un cliente le cobras otro precio, queda como su precio especial, con el motivo.',
  '03.4': 'La gestión laboral, a tanto por trabajador: el recibo cambia solo cuando hay un alta o una baja.',
  '03.5': 'Las nóminas, por tramos. Y los paquetes, con lo que se ahorra el cliente.',

  // 04 · Bitrix24 y Sumied, al momento (tomas de Julio)
  '04.1': 'Sigues trabajando en tu Bitrix24. Aquí cambiamos la situación de un cliente, de Activo a Moroso.',
  '04.2': 'Y Sumied se entera en segundos, sin importar nada ni tocar un botón.',

  // 05 · La pestaña Sumied dentro de Bitrix24 (tomas: 05-pestana-resumen/cuotas/laboral/portal.gif)
  '05.1': 'Y sin salir de Bitrix24: en la ficha de cada empresa tienes una pestaña de Sumied.',
  '05.2': 'En Resumen, lo pendiente con ese cliente: cada cosa te lleva a donde se arregla.',
  '05.3': 'En Cuotas y cobros, sus servicios y sus cobros. Le cambias el nivel o el precio desde aquí, y antes de guardar te enseña cómo queda su recibo.',
  '05.4': 'En Laboral, sus trabajadores: das un alta o una baja desde Bitrix24, y Sumied la apunta en su recibo.',
  '05.5': 'Y en Portal, quién de ese cliente entra en su portal y lo que te ha pedido.',

  // 06 · El cobro del mes
  '06.1': 'Toca cobrar. Sumied prepara el recibo de cada cliente con tu tarifa y con sus altas y bajas.',
  '06.2': 'Y lo compara con el del mes anterior: solo te enseña lo que cambia, cada cambio con su porqué.',
  '06.3': 'Imprenta Rápida Sol pasa de Básica a Premium y su recibo sube un 67 %. Cuando un recibo cambia más de un 30 %, Sumied no te deja aprobarlo de un clic: te pide que lo mires.',
  '06.4': 'Talleres Ruiz paga más por el trabajador nuevo. Lo ves con su nombre y su alta.',
  '06.5': 'A Reformas Atalaya este mes no le cobras: lo dejas fuera de este cobro, y el mes que viene vuelve a entrar.',
  '06.6': 'Apruebas los cambios uno a uno, sabiendo por qué cambia cada uno.',
  '06.7': 'Y los que no cambian, todos de una vez.',
  '06.8': 'Sumied también te dice quién se queda fuera, y por qué: aquí, un cliente activo en Bitrix24 que no tiene cuota.',
  '06.9': 'Todo revisado: el cobro se envía a GoCardless.',
  '06.10': 'Antes de salir, te dice a cuántos clientes y por cuánto. Confirmas, y GoCardless pasa los cargos.',

  // 07 · Cobrado y facturado
  '07.1': 'Cuando GoCardless confirma cada cargo, Sumied hace la factura sola. Aquí ves cómo va cada recibo.',
  '07.2': 'La factura sale a nombre de tu gestoría, con la numeración de tu serie.',
  '07.3': 'Con todo lo que ha pasado, paso a paso: preparado, aprobado, enviado, cobrado y facturado.',
  '07.4': 'Y su asiento ya hecho: el cliente a su 430, la cuota a ventas y el IVA a la 477.',
  '07.5': 'El PDF lleva cada trabajador por el que se le cobra, y el que entra nuevo, con su fecha de alta.',

  // 07b · El buzón (toma)
  '07b.1': 'Y a tu cliente le llega por correo, con su factura en PDF, sin que nadie la mande.',

  // 08 · En la contabilidad
  '08.1': 'En el libro de IVA repercutido, la factura ya está, con su base y su IVA. El trimestre sale de aquí.',
  '08.2': 'La cuenta del cliente: la factura al debe y el cobro al haber. Saldada.',
  '08.3': 'Lo que cobra GoCardless pasa por esta cuenta puente hasta que llega al banco. Cuando llega, queda solo su comisión, al céntimo.',
  '08.4': 'Y en el banco, el ingreso que llega de GoCardless, neto, casado con sus cobros.',
  '08.5': 'De la cuota al banco, contabilizado solo. Sin teclear un asiento.',

  // 09 · El banco
  '09.1': 'En el banco, Sumied te dice qué ha casado solo, qué te propone y qué no sabe.',
  '09.2': 'Aquí, todo lo que ha casado sin ti. Nada pasa a la contabilidad sin que esté seguro o lo confirmes tú.',
  '09.3': 'El ingreso de Talleres Ruiz: el importe neto, exacto, y el porqué de que lo case.',
  '09.4': 'Y todo lo que hace solo, se deshace con un clic.',

  // 10 · El portal, desde tu gestoría
  '10.1': 'Cada cliente puede tener su portal. En su ficha ves quién entra…',
  '10.2': '…lo que le has pedido y lo que te ha escrito.',

  // 11 · El portal, como lo ve tu cliente
  '11.1': 'Esto es lo que ve tu cliente al entrar: lo que le pides y lo último de tu gestoría.',
  '11.2': 'Todas sus facturas, con lo que lleva cada una, en PDF, cuando quiera.',
  '11.3': 'Sus recibos y el próximo cargo. Si uno se devuelve, lo paga desde aquí: desde su banco, o con tarjeta o Bizum.',
  '11.4': 'Sus trabajadores. Pide un alta o una baja, y tú la haces desde Sumied.',
  '11.5': 'Te sube facturas y tickets con una foto desde el móvil, y ve sus impuestos presentados.',
  '11.6': 'Y habla contigo por aquí, sin correos sueltos ni llamadas.',
  '11.7': 'Hasta cambiar la cuenta donde se le cargan los recibos lo hace él.',

  // 12 · Cierre
  cierre: 'Sin teclear recibos, sin facturar a mano y sin descuadres. Sumied para gestorías.',
}

/** A qué gesto va pegada cada frase (lo que señala el ratón y donde hace zoom el montaje). */
export const GESTOS = {
  portada: 'portada', '01.1': 'la lista entera', '01.2': 'zoom a «Cuotas al mes»', '01.3': 'zoom a «Te deben»', '01.4': 'zoom a «Dejas de cobrar»',
  '01.5': 'zoom a «Lo que tienes que hacer»', '01.6': 'clic en Talleres Ruiz y zoom al panel',
  '02.1': 'zoom a «Se le cobra al mes»', '02.2': 'zoom al recibo', '02.3': 'clic en «Ver trabajadores»', '02.4': 'zoom al trabajador nuevo',
  '02.5': 'pestañas Cobros y Contacto', '02.6': 'pestaña Datos de Bitrix24',
  '03.1': 'la pantalla entera', '03.2': 'zoom a los tres niveles', '03.3': 'zoom a «precio especial»', '03.4': 'zoom a Gestión laboral', '03.5': 'zoom a Nóminas y Pack Empresa',
  '04.1': 'toma de Bitrix24', '04.2': 'toma de Sumied',
  '05.1': 'toma: la pestaña Sumied', '05.2': 'toma: Resumen', '05.3': 'toma: Cuotas y cobros', '05.4': 'toma: Laboral', '05.5': 'toma: Portal',
  '06.1': 'clic en «Preparar el cobro»', '06.2': 'zoom a «Lo que cambia»', '06.3': 'zoom al cambio de Imprenta Rápida Sol', '06.4': 'zoom al cambio de Talleres Ruiz',
  '06.5': 'clic en «Este mes no» de Reformas Atalaya', '06.6': 'aprueba los cambios', '06.7': 'clic en «Aprobar» de los que no cambian', '06.8': 'zoom a «No entran»',
  '06.9': 'clic en «Enviar el cobro»', '06.10': 'zoom al diálogo de confirmación',
  '07.1': 'zoom a «Cómo va cada recibo»', '07.2': 'la factura de Talleres Ruiz', '07.3': 'zoom a «Lo que ha pasado»', '07.4': 'zoom a «En la contabilidad»', '07.5': 'el PDF',
  '07b.1': 'toma: el correo con el PDF',
  '08.1': 'libro de IVA repercutido, fila de Talleres Ruiz', '08.2': 'mayor de su 430, zoom al saldo', '08.3': 'mayor de la 57200002, zoom al saldo',
  '08.4': 'banco 57200000, el ingreso', '08.5': 'plano entero',
  '09.1': 'zoom al aviso de lo que ha hecho', '09.2': 'pestaña «Casados solos»', '09.3': 'abre el de Talleres Ruiz', '09.4': 'zoom a «Deshacer»',
  '10.1': 'pestaña Portal de la ficha', '10.2': 'zoom a lo pedido y los mensajes',
  '11.1': 'portal · Inicio', '11.2': 'portal · Facturas', '11.3': 'portal · Pagos', '11.4': 'portal · Trabajadores', '11.5': 'portal · Documentos',
  '11.6': 'portal · Mensajes', '11.7': 'portal · Tu cuenta',
  cierre: 'cierre',
}

/** Las 6 frases de la muestra de voz (nº96, fase 2): 2 del cobro, 2 de la contabilidad y 2 del banco. */
export const MUESTRA = ['06.3', '06.10', '08.3', '08.5', '09.2', '09.4']

/**
 * nº99 · Cómo se escribe, para ElevenLabs, lo que si no suena mal («GoCardless» salía «GoKarlis» con las dos voces).
 * Solo cambia lo que se oye: los subtítulos dicen el nombre de verdad. La grafía buena sale de la muestra de
 * pronunciación (modo «muestras-voz», carpeta pronunciacion/); hasta elegirla, la primera de VARIANTES.
 */
export const VARIANTES = {
  GoCardless: ['Gou Cárdles', 'Go Cárdles', 'Gou Cárdless', 'Gocárdles'],
  Sumied: ['Sumied', 'Sumiéd', 'Súmied', 'Su mied'],
}
export const PRONUNCIA = { GoCardless: VARIANTES.GoCardless[0], Sumied: VARIANTES.Sumied[0] }
/** El texto tal como se le pasa a la voz. */
export const paraLaVoz = (texto, pronuncia = PRONUNCIA) =>
  Object.entries(pronuncia).reduce((t, [de, a]) => t.replace(new RegExp(`\\b${de}\\b`, 'g'), a), texto)
/** La frase para probar la pronunciación, con los dos nombres. */
export const FRASE_PRONUNCIACION = 'Sumied prepara el cobro solo, y GoCardless pasa los cargos.'

/** Lo que dura una frase si no hay voz (para el ritmo): unas 15 letras por segundo. */
export const estimada = (texto) => 0.5 + texto.length / 15

if (process.argv[1] && process.argv[1].endsWith('locucion.mjs')) {
  const salida = process.argv[2]
  if (!salida) { console.error('uso: locucion.mjs <salida> [--muestra]'); process.exit(2) }
  const dir = join(salida, 'voz')
  mkdirSync(dir, { recursive: true })
  let frases
  if (process.argv.includes('--pronunciacion')) {
    // La misma frase con cada grafía: Sumied y GoCardless, cada una con sus variantes (la otra, la primera).
    frases = [...VARIANTES.GoCardless.map((v, i) => ({ id: `gocardless-${i + 1}`, voz: paraLaVoz(FRASE_PRONUNCIACION, { ...PRONUNCIA, GoCardless: v }) })),
      ...VARIANTES.Sumied.map((v, i) => ({ id: `sumied-${i + 1}`, voz: paraLaVoz(FRASE_PRONUNCIACION, { ...PRONUNCIA, Sumied: v }) }))]
      .map((f) => ({ ...f, texto: FRASE_PRONUNCIACION, salida: join(dir, `${f.id}.wav`) }))
  } else {
    const ids = process.argv.includes('--muestra') ? MUESTRA : Object.keys(FRASES)
    frases = ids.map((id) => ({ id, texto: FRASES[id], voz: paraLaVoz(FRASES[id]), salida: join(dir, `${id}.wav`) }))
  }
  writeFileSync(join(dir, 'frases.json'), JSON.stringify(frases, null, 1))
  console.log(`${frases.length} frases en ${join(dir, 'frases.json')}`)
}
