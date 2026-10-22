// src/modules/conta/empresa/ApartadoLogo.tsx
//
// S01 · «El logo de la empresa», en Ajustes › Empresa. Sale en la cabecera, con
// el selector de empresa. Sin logo de la empresa se usa el de la cuenta; sin
// ninguno, la inicial. PNG, JPG o WebP de hasta 1 MB, en el bucket privado
// company-logos (0120).
//
// Regla 8: subir y quitar dicen lo que ha pasado; lo que no se puede subir
// (tipo o tamaño) se dice antes de subir nada.

import { useEffect, useRef, useState } from 'react'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { LOGO_TIPOS, motivoLogoNoValido, quitarLogoEmpresa, subirLogoEmpresa, urlDelLogo } from '@/modules/conta/services/esqueletoService'
import { refrescarContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import type { DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'
import type { Quien } from '@/modules/conta/empresa/apartados'

export function ApartadoLogo({ d, quien, alCambiar, movil }: { d: DatosEmpresa; quien: Quien; alCambiar: () => void; movil: boolean }) {
  const h = useHacer(() => { alCambiar(); refrescarContextoEsqueleto() })
  const ruta = d.empresa.logoPath ?? null
  const [url, setUrl] = useState<{ ruta: string; url: string | null } | null>(null)
  const fichero = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!ruta) return
    let vivo = true
    void urlDelLogo(ruta).then((u) => { if (vivo) setUrl({ ruta, url: u }) })
    return () => { vivo = false }
  }, [ruta])
  const vista = ruta && url?.ruta === ruta ? url.url : null

  const subir = (f: File | undefined) => {
    if (fichero.current) fichero.current.value = ''
    if (!f) return
    const motivo = motivoLogoNoValido(f)
    if (motivo) { void h.hacer(() => Promise.reject(new Error(`${motivo} No se ha subido nada.`)), ''); return }
    void h.hacer(async () => { await subirLogoEmpresa(quien.accountId, quien.companyId, f, ruta) },
      `Logo ${ruta ? 'cambiado' : 'puesto'}: «${f.name}». Ya sale en la cabecera, al lado del nombre de la empresa.`)
  }
  const quitar = () => void h.hacer(async () => { await quitarLogoEmpresa(quien.accountId, quien.companyId, ruta) },
    'Logo quitado. En la cabecera sale el de la cuenta o, si no hay, la inicial de la empresa.')

  return (
    <TarjetaApartado titulo="El logo de la empresa" movil={movil}>
      <div className="cx-fila" style={{ alignItems: 'center', gap: 12 }}>
        {ruta
          ? (vista ? <img src={vista} alt="El logo de la empresa" className="s-empresa-cuadrado" data-testid="logo-empresa" /> : <span className="cx-ayuda">Leyendo el logo…</span>)
          : <span className="cx-ayuda" data-testid="logo-empresa-sin">Sin logo: en la cabecera sale la inicial de la empresa.</span>}
      </div>
      <p className="cx-ayuda">PNG, JPG o WebP de hasta 1 MB. Sale en la cabecera, con el selector de empresa.</p>
      <input ref={fichero} type="file" accept={LOGO_TIPOS.join(',')} className="cx-oculto" aria-label="Elegir el logo de la empresa"
        onChange={(e) => subir(e.target.files?.[0])} />
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" disabled={h.guardando} onClick={() => fichero.current?.click()}>{ruta ? 'Cambiar el logo' : 'Subir el logo'}</button>
        {ruta && <button type="button" className="cx-boton-sec" disabled={h.guardando} onClick={quitar}>Quitar el logo</button>}
      </div>
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}
