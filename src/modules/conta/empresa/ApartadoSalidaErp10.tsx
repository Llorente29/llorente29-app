// src/modules/conta/empresa/ApartadoSalidaErp10.tsx
//
// X04 · «Salida a ERP10» en Ajustes › Ejercicio, al lado de «Enviar a Diez»
// (ApartadoEnviarDiez.tsx es el modelo). Un extra temporal, por empresa: lo que se
// contabiliza en Sumied sale en ficheros para importarlos en ERP10.
//
//   · Encendida / apagada (apagada por defecto). Con el envío a Diez encendido no
//     se puede: se ve el mensaje que da la función.
//   · El código de la empresa en ERP10, cuántas cifras tienen sus subcuentas (8
//     si no se dice), desde qué día sale (si no se dice, el día de inicio) y la
//     carpeta del ordenador de ERP10 donde se dejan los PDF (si no se dice,
//     C:\Sumied\<código>\).
//   · Después de la primera salida, el código y las cifras ya no se cambian: se
//     ven en gris, con su porqué.
//   · Cada cambio confirma con lo que ha quedado (regla 8), con el texto de la base.
//   · X05: «Desde qué día sale», con el campo de fecha de Sumied (dd/mm/aaaa en
//     español, sea cual sea el idioma del navegador), no el nativo del navegador,
//     que en la captura del X04 salió en inglés («10/01/2026» por el 1 de octubre).
//   · X33: «Las facturas las emite Cegid: no se suben las de Sumied», con su propio botón (se guarda al pulsarlo y
//     confirma con la frase de la base, regla 8), y cuándo y quién lo cambió.

import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { rutaLibros } from '@/config/navegacion'
import { fechaLarga } from '@/modules/conta/lib/formato'
import { CampoTexto, Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { TarjetaCargando } from '@/modules/conta/ui/piezas'
import { CampoFecha } from '@/modules/conta/ui/fecha/CampoFecha'
import { leerFacturasFuera, leerSalidaEmpresa, ponerCarpeta, ponerFacturasFuera, ponerSalida, type SalidaEmpresa } from '@/modules/conta/services/erp10Service'
import { aFacturasFuera, NOMBRE_FACTURAS_FUERA, quienLoCambio, type FacturasFuera } from '@/modules/conta/erp10/qbo'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import type { Quien } from '@/modules/conta/empresa/apartados'
import { refrescarContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'

export function ApartadoSalidaErp10({ quien, movil, nombre }: { quien: Quien; movil: boolean; nombre: string | null }) {
  const [salida, setSalida] = useState<SalidaEmpresa | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [encendida, setEncendida] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [cifras, setCifras] = useState('8')
  const [desde, setDesde] = useState('')
  const idDesde = useId()
  const [carpeta, setCarpeta] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    leerSalidaEmpresa(quien.accountId, quien.companyId).then((x) => {
      if (!vivo) return
      setSalida(x); setError(null)
      setEncendida(x.encendida); setCodigo(x.codigo ?? ''); setCifras(String(x.largo ?? 8)); setDesde(x.desde ?? ''); setCarpeta(x.carpeta ?? '')
    }, (e: unknown) => { if (vivo) { setError(e instanceof Error ? e.message : String(e)); setSalida(null) } })
    return () => { vivo = false }
  }, [quien.accountId, quien.companyId, vuelta])

  if (!salida && !error) return <TarjetaCargando />
  const fijos = (salida?.lotes ?? 0) > 0
  const porDefecto = `C:\\Sumied\\${codigo.trim() || '<código>'}\\`

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setOcupado(true); setHecho(null); setFallo(null)
    try {
      const largo = Number(cifras)
      const textos: string[] = []
      textos.push(await ponerSalida(quien.companyId, {
        encender: encendida, codigo: codigo.trim() || null, largo: Number.isFinite(largo) && cifras.trim() ? largo : null, desde: desde || null, quien: nombre,
      }))
      if (encendida && (carpeta.trim() || null) !== (salida?.carpeta ?? null)) textos.push(await ponerCarpeta(quien.companyId, carpeta, nombre))
      setHecho(textos.join(' '))
      setVuelta((v) => v + 1)
      // X08 · Encender o apagar la salida enciende o apaga su entrada (Libros › Cierre) sin recargar.
      refrescarContextoEsqueleto()
    } catch (x) {
      setFallo(`No se ha cambiado: ${x instanceof Error ? x.message : 'no ha contestado'}`)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <TarjetaApartado titulo="Salida a ERP10" movil={movil}>
      <form onSubmit={(e) => { void guardar(e) }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Salida a ERP10">
        <label className="cx-campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" role="switch" checked={encendida} disabled={ocupado} aria-describedby="salida-erp10-ayuda"
            onChange={(e) => setEncendida(e.target.checked)} />
          <span className="cx-etiqueta" style={{ margin: 0 }}>{encendida ? 'Encendida' : 'Apagada'}</span>
        </label>
        <p className="cx-ayuda" id="salida-erp10-ayuda" style={{ margin: 0 }}>
          Es temporal: sirve para llevar esta empresa en Sumied y en ERP10 a la vez. Encendida, cada mes sacas de Sumied las cuentas nuevas,
          las facturas emitidas y recibidas y sus PDF, y los importas en ERP10.{salida?.encendida ? <> Se hace en <Link className="cx-enlace" to={rutaLibros('cierre', 'salida-erp10')}>Salida a ERP10</Link>.</> : null}
        </p>
        <CampoTexto etiqueta="Código de la empresa en ERP10" valor={codigo} cambiar={setCodigo} modo="numeric" deshabilitado={ocupado || fijos}
          ayuda={fijos ? 'Ya ha salido algo con este código: no se cambia.' : 'Es el número que sale entre corchetes arriba, en ERP10.'} />
        <CampoTexto etiqueta="Cifras de las subcuentas en ERP10" valor={cifras} cambiar={setCifras} modo="numeric" deshabilitado={ocupado || fijos}
          ayuda={fijos ? 'Ya han salido cuentas con estas cifras: no se cambian.' : 'Si no lo sabes, 8. Las cuentas de Sumied se rellenan con ceros por el medio.'} />
        <div className="cx-campo">
          <label htmlFor={idDesde}>Desde qué día sale</label>
          <CampoFecha id={idDesde} className="cx-input" valor={desde} alCambiar={setDesde} disabled={ocupado} aria-describedby={`${idDesde}-ayuda`} />
          <span id={`${idDesde}-ayuda`} className="cx-ayuda">Si no lo dices, el día en que la empresa empezó en Sumied.</span>
        </div>
        <CampoTexto etiqueta="Carpeta de los PDF en el ordenador de ERP10" valor={carpeta} cambiar={setCarpeta} deshabilitado={ocupado}
          ayuda={`Si no lo dices, ${porDefecto}. Tiene que ser la misma carpeta donde descomprimas los PDF. ERP10 los busca ahí.`} />
        <div><button type="submit" className="cx-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
      {salida?.cambiadoPor && salida.cambiadoEn && <p className="cx-ayuda" style={{ margin: 0 }}>Lo cambió {salida.cambiadoPor} el {fechaLarga(salida.cambiadoEn.slice(0, 10))}.</p>}
      {error && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer la salida a ERP10: {error}</p>}
      <Resultado hecho={hecho} fallo={fallo} />
      <FacturasDeCegid companyId={quien.companyId} nombre={nombre} />
    </TarjetaApartado>
  )
}

/** X33 · «Las facturas las emite Cegid: no se suben las de Sumied»: encendido, ninguna factura de la empresa sale a ERP10. */
function FacturasDeCegid({ companyId, nombre }: { companyId: string; nombre: string | null }) {
  const [f, setF] = useState<FacturasFuera | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    leerFacturasFuera(companyId, `${hoyEnMadrid().slice(0, 7)}-01`).then((x) => { if (vivo) setF(aFacturasFuera(x)) },
      (e: unknown) => { if (vivo) setFallo(`No he podido leer si las facturas las emite Cegid: ${e instanceof Error ? e.message : String(e)}`) })
    return () => { vivo = false }
  }, [companyId, vuelta])

  async function cambiar(encendido: boolean) {
    setOcupado(true); setHecho(null); setFallo(null)
    try {
      setHecho(await ponerFacturasFuera(companyId, encendido, nombre))
      setVuelta((v) => v + 1)
    } catch (x) {
      setFallo(`No se ha cambiado: ${x instanceof Error ? x.message : 'no ha contestado'}`)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }} data-prueba="facturas-cegid">
      <label className="cx-campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" role="switch" checked={f?.encendido ?? false} disabled={ocupado || !f} aria-describedby="facturas-cegid-ayuda"
          onChange={(e) => { void cambiar(e.target.checked) }} />
        <span className="cx-etiqueta" style={{ margin: 0 }}>{NOMBRE_FACTURAS_FUERA}</span>
      </label>
      <p className="cx-ayuda" id="facturas-cegid-ayuda" style={{ margin: 0 }}>
        Encendido, ninguna factura de Sumied de esta empresa sale a ERP10, ni emitida ni recibida: las lleva Cegid y saldrían dos veces.
        Los demás asientos (cobros, pagos, bancos) salen como siempre. Se guarda al pulsarlo.
      </p>
      {f && quienLoCambio(f) && <p className="cx-ayuda" style={{ margin: 0 }}>{quienLoCambio(f)}</p>}
      <Resultado hecho={hecho} fallo={fallo} />
    </div>
  )
}
