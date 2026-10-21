#!/usr/bin/env node
// scripts/textos/papel.mjs — dónde dice «papel» un texto que ve alguien.
//
// Regla de Julio (21/10): nunca «papel» ni «papeles». Cada documento se llama
// por lo que es (albarán, factura, abono, justificante, extracto,
// liquidación…); si un texto agrupa varios tipos, se dicen («Ver el albarán y
// la factura», «Ver los 2 albaranes»); si de verdad no se sabe qué es,
// «documento». En Contactos, «papel» era el rol: «como cliente, plataforma o
// socio».
//
// Lee cada .ts y .tsx de src con el analizador de TypeScript y mira SOLO lo
// que puede llegar a una pantalla, un aviso o un correo: cadenas, plantillas y
// texto JSX. No mira comentarios ni nombres (VerPapel, ivaDelPapel, p.papel),
// y una cadena que es solo una clave («papel», «papel_y_ficha») tampoco: no es
// una frase.
//
// Fuera, solo el papel DE VERDAD (Julio, 21/10: «lo que queda fuera es solo
// el ticket impreso de la bolsa en cocina y reparto»): el rollo de la
// impresora, cuando sale o no sale. Va frase a frase (IMPRESO), no por
// carpetas: una carpeta entera fuera escondería un «papel» que sí es un
// documento, como pasaba con la pantalla de recepciones.
//
//   node scripts/textos/papel.mjs        → una línea por texto, y sale con 1 si hay alguno

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * El papel impreso: lo que sale (o no sale) de una impresora de tickets.
 * Cada frase, con su sitio: si alguien añade otra, la prueba la caza y se
 * decide aquí, a la vista.
 */
export const IMPRESO = [
  /Saldrá papel si la estación/,           // printing/PrintersSettingsPage: la impresora de la estación
  /hasta que haya papel: sin etiqueta/,    // pase/PaseBoard: la etiqueta de la bolsa
  /NO ha salido papel/,                    // pos/TpvSalePage: la comanda y el ticket del TPV
]

// Con un guion o un subrayado pegado es un nombre (cxt-papeles, papel_y_ficha), no una palabra.
const PALABRA = /(?<![\w-])papel(es)?(?![\w-])/i
/**
 * Una cadena que es solo una clave, no una frase: sin espacios, en minúscula y
 * con un _, un - o un : (papel_y_ficha, sin_papel, «:papel:» de una clave de
 * caché). «papel» o «papeles» a secas SÍ cuentan: pueden ser una palabra que se
 * ve (n === 1 ? 'papel' : 'papeles').
 */
const CLAVE = /^(?=.*[_:-])[a-z_:-]*papel[a-z_:-]*$/
/** Una lista de columnas de un select («brand_id, papel, company_account_id»). */
const COLUMNAS = /^[a-z_]+(\s*,\s*[a-z_]+)+$/

export function textosDe(codigo, fichero = 'x.tsx') {
  const sf = ts.createSourceFile(fichero, codigo, ts.ScriptTarget.Latest, true, fichero.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const r = []
  const mira = (n, texto, cadena = true) => {
    if (!PALABRA.test(texto) || IMPRESO.some((re) => re.test(texto.replace(/\s+/g, ' ')))) return
    // Una clave o una lista de columnas solo puede ir en una cadena o una plantilla; en el texto JSX todo se ve.
    if (cadena && (CLAVE.test(texto) || COLUMNAS.test(texto.trim()))) return
    r.push({ linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, texto: texto.trim().replace(/\s+/g, ' ') })
  }
  const andar = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      // Un import o una clave de propiedad no se enseña.
      // Ni un import, ni el nombre de una propiedad, ni un tipo (Pick<Factura, 'papel'>).
      if (!ts.isImportDeclaration(n.parent) && !ts.isExportDeclaration(n.parent) && !ts.isLiteralTypeNode(n.parent)
          && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) mira(n, n.text)
    } else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      mira(n, n.text)
    } else if (ts.isJsxText(n)) {
      mira(n, n.text, false)
    }
    ts.forEachChild(n, andar)
  }
  andar(sf)
  return r
}

function ficheros(dir) {
  const r = []
  for (const x of readdirSync(dir)) {
    const p = join(dir, x)
    if (statSync(p).isDirectory()) r.push(...ficheros(p))
    else if (/\.(ts|tsx)$/.test(x) && !/\.d\.ts$/.test(x)) r.push(p)
  }
  return r
}

/** Todos los textos con «papel» de src, salvo el papel impreso (IMPRESO). */
export function papelEnLaApp(raiz = 'src') {
  const r = []
  for (const f of ficheros(raiz)) {
    const codigo = readFileSync(f, 'utf8')
    if (!/papel/i.test(codigo)) continue // sin la palabra, no hace falta analizarlo
    for (const t of textosDe(codigo, f)) r.push({ fichero: f, ...t })
  }
  return r
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = papelEnLaApp()
  for (const x of r) console.log(`${x.fichero}:${x.linea}  ${x.texto}`)
  console.log(`${r.length} textos con «papel»`)
  process.exit(r.length ? 1 : 0)
}
