// scripts/conta/diez/cifrar.ts
//
// C04b · T3 · Imprime un fichero CIFRADO con la clave pública del testigo
// (testigo-clave-publica.pem), igual que testigo.ts: RSA-OAEP-SHA256 envuelve
// una clave AES-256-GCM que cifra el fichero comprimido. Para lo que lleva
// importes (las sumas por subcuenta de la tanda) y tiene que salir en un
// registro público: solo lo puede leer quien tiene la clave privada, que no
// está en el repositorio ni en el runner.
//
//   npx tsx scripts/conta/diez/cifrar.ts <fichero> <ETIQUETA>

import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const [fichero, etiqueta = 'CIFRADO'] = process.argv.slice(2)
if (!fichero) { console.log('Uso: cifrar.ts <fichero> <ETIQUETA>'); process.exit(1) }
const claro = gzipSync(readFileSync(fichero))
const clave = randomBytes(32), iv = randomBytes(12)
const cif = createCipheriv('aes-256-gcm', clave, iv)
const datos = Buffer.concat([cif.update(claro), cif.final()])
const envuelta = publicEncrypt({ key: readFileSync(new URL('./testigo-clave-publica.pem', import.meta.url)), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, clave)
const paquete = Buffer.from(JSON.stringify({ k: envuelta.toString('base64'), iv: iv.toString('base64'), tag: cif.getAuthTag().toString('base64'), d: datos.toString('base64') })).toString('base64')
process.stdout.write(`-----${etiqueta}-----\n`)
for (let i = 0; i < paquete.length; i += 100) process.stdout.write(`T ${paquete.slice(i, i + 100)}\n`)
process.stdout.write(`-----FIN ${etiqueta}-----\n`)
