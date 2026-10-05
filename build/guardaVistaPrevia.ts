import type { Plugin } from 'vite'

/**
 * Guarda de la vista previa (C02, 05/10): una rama `conta/**` o `reparto-**`
 * NO se construye en Vercel contra producción.
 *
 * Esas ramas se prueban contra staging-conta, con datos inventados. Su vista
 * previa solo va allí si en Vercel hay dos variables de vista previa
 * LIMITADAS A LA RAMA (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY). Si
 * faltan, Vercel usa las generales de vista previa, que son de PRODUCCIÓN, y
 * la vista previa sale verde y enseña los locales reales.
 *
 * Pasó tres veces: en el C00 y el R02 se vio a tiempo, y en el C02 la vio
 * Julio, con sus locales reales y sin Conta, después de que yo la diera por
 * lista. `antes-de-subir.sh` no puede comprobarlo, porque no ve Vercel. El
 * único sitio que ve a la vez la rama y la base con la que se construye es
 * el build. Por eso la guarda está aquí: si no cuadra, el build FALLA, el
 * despliegue sale en rojo en el PR y no hay vista previa que dar por buena.
 *
 * Solo mira las vistas previas de Vercel de esas ramas: ni producción, ni
 * `npm run build` en local, ni el bundle OTA de Actions.
 */

const REF_STAGING_CONTA = 'oseymswjlzplqoxrfjzi'
const RAMAS_DE_PRUEBA = /^(conta\/|reparto-)/

const refDeUrl = (url: string | undefined): string | null => {
  if (!url) return null
  try { return new URL(url).hostname.split('.')[0] } catch { return null }
}

/** El `ref` del proyecto de Supabase que lleva dentro una clave anónima (JWT), o null. */
const refDeClave = (clave: string | undefined): string | null => {
  const cuerpo = clave?.split('.')[1]
  if (!cuerpo) return null
  try {
    const datos = JSON.parse(Buffer.from(cuerpo.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { ref?: unknown }
    return typeof datos.ref === 'string' ? datos.ref : null
  } catch { return null }
}

/** Por qué este build NO debe salir, o null si puede. Pura: recibe el entorno. */
export function motivoParaParar(env: NodeJS.ProcessEnv): string | null {
  const rama = env.VERCEL_GIT_COMMIT_REF ?? ''
  if (env.VERCEL_ENV !== 'preview' || !RAMAS_DE_PRUEBA.test(rama)) return null
  const pista = `Crea en Vercel (folvy-app › Settings › Environment Variables) VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY de staging-conta, solo «Preview» y solo la rama «${rama}», y vuelve a desplegar.`
  const url = refDeUrl(env.VITE_SUPABASE_URL)
  if (url !== REF_STAGING_CONTA) {
    return `La vista previa de «${rama}» se construiría contra ${url ? `la base «${url}»` : 'ninguna base'}, no contra staging-conta (${REF_STAGING_CONTA}). ${pista}`
  }
  const clave = refDeClave(env.VITE_SUPABASE_ANON_KEY)
  if (clave !== REF_STAGING_CONTA) {
    return `La vista previa de «${rama}» tiene la URL de staging-conta pero la clave anónima ${clave ? `de «${clave}»` : 'no es de ningún proyecto'}. ${pista}`
  }
  return null
}

export function guardaVistaPrevia(): Plugin {
  return {
    name: 'folvy-guarda-vista-previa',
    apply: 'build',
    buildStart() {
      const motivo = motivoParaParar(process.env)
      const rama = process.env.VERCEL_GIT_COMMIT_REF ?? '(sin rama)'
      if (motivo) this.error(`[guarda de la vista previa] ${motivo}`)
      if (process.env.VERCEL_ENV === 'preview' && RAMAS_DE_PRUEBA.test(rama)) {
        console.log(`[guarda de la vista previa] «${rama}» se construye contra staging-conta (${REF_STAGING_CONTA}).`)
      }
    },
  }
}
