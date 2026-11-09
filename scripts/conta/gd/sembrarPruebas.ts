// scripts/conta/gd/sembrarPruebas.ts
//
// GD · «GD · sembrar pruebas»: deja el Bitrix24 de pruebas y el sandbox de
// GoCardless con los clientes de la demo, siempre igual: se puede repetir para
// volver al estado inicial (Julio, nº27). Lo lanza
// .github/workflows/gd-sembrar-pruebas.yml. El núcleo vive en
// supabase/functions/_shared/gd/siembra.ts, el mismo que usa «Volver a empezar».
//
//   npx tsx scripts/conta/gd/sembrarPruebas.ts plan      solo lee: qué hay y qué haría
//   npx tsx scripts/conta/gd/sembrarPruebas.ts sembrar   borra lo de antes y siembra
//   npx tsx scripts/conta/gd/sembrarPruebas.ts tocar     un cambio pequeño en cada uno, para probar «Al instante»
//
// Las dos guardas (solo el portal b24-s3mr2y, solo el sandbox) están en el núcleo.
// Los secretos llegan por el entorno y no se escriben nunca.

import { crearSiembra } from '../../../supabase/functions/_shared/gd/siembra.ts'

const env = (k: string) => (process.env[k] ?? '').trim()
const fallo = (t: string): never => { console.log(`::error::${t}`); process.exit(1) }

const modo = process.argv[2]
if (!['plan', 'sembrar', 'tocar'].includes(modo)) fallo('uso: sembrarPruebas.ts plan | sembrar | tocar')
if (!env('G01D_B24_ENTRANTE_URL')) fallo('Falta el secreto G01D_B24_ENTRANTE_URL.')
if (modo !== 'plan' && !env('GD_GC_SANDBOX_RW_TOKEN')) fallo('Falta el secreto GD_GC_SANDBOX_RW_TOKEN (lectura y escritura del sandbox).')

try {
  const s = crearSiembra({ b24Url: env('G01D_B24_ENTRANTE_URL'), gcToken: env('GD_GC_SANDBOX_RW_TOKEN'), decir: (t) => console.log(t) })
  if (modo === 'plan') await s.plan()
  else if (modo === 'tocar') await s.tocar()
  else {
    console.log('Bitrix24 de pruebas:'); await s.borrarBitrix(); await s.sembrarBitrix()  // sin presupuesto: todo de una vez
    console.log('Sandbox de GoCardless:'); await s.borrarGoCardless(); await s.sembrarGoCardless()
    console.log('Hecho: el portal de pruebas y el sandbox están como el primer día de la demo.')
  }
} catch (e) {
  fallo(e instanceof Error ? e.message : String(e))
}
