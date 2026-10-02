// src/modules/conta/apartados/Pago.tsx
//
// Cómo se le paga: forma, plazo, días fijos, cuenta bancaria. Y lo que se
// añadió tras compararla con Holded (respuesta 2): BIC (obligatorio si el
// IBAN no es español), mandato SEPA (solo con domiciliación), moneda y
// descuento por pronto pago. Lo de Holded no cuenta para el %.
//
// El IBAN se comprueba al momento (ISO 13616, módulo 97) y se guarda sin
// espacios y en mayúsculas; uno válido queda «IBAN comprobado».

import { useMemo, useState } from 'react'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { Campo, Guardado } from '@/modules/conta/components/ui'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { formatearIban, normalizarIban, validarIban } from '@/modules/conta/lib/iban'
import { PAYMENT_METHOD_LABEL, type FichaProveedor, type PaymentMethod } from '@/modules/conta/types'
import type { ProblemaFicha } from '@/modules/conta/lib/validacionesFicha'

const MONEDAS = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN', 'CZK', 'HUF', 'RON']

function leerDias(t: string): number[] | null {
  if (!t.trim()) return []
  const ds = t.split(/[\s,;y]+/).filter(Boolean).map(Number)
  if (ds.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) return null
  return Array.from(new Set(ds)).sort((a, b) => a - b)
}

export default function Pago() {
  const { datos, guardar } = useFicha()
  const f = datos.ficha
  const [metodo, setMetodo] = useState<PaymentMethod | ''>(f.paymentMethod ?? '')
  const [plazo, setPlazo] = useState(f.paymentTermsDays !== null ? String(f.paymentTermsDays) : '')
  const [dias, setDias] = useState(f.paymentFixedDays.join(', '))
  const [iban, setIban] = useState(f.iban ? formatearIban(f.iban) : '')
  const [bic, setBic] = useState(f.bic ?? '')
  const [banco, setBanco] = useState(f.bankName ?? '')
  const [mandRef, setMandRef] = useState(f.sepaMandateRef ?? '')
  const [mandFecha, setMandFecha] = useState(f.sepaMandateDate ?? '')
  const [moneda, setMoneda] = useState(f.currency)
  const [pronto, setPronto] = useState(f.earlyPaymentDiscountPct !== null ? String(f.earlyPaymentDiscountPct) : '')
  const [errores, setErrores] = useState<ProblemaFicha[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, avisar] = useAvisoGuardado()

  const ibanAlMomento = useMemo(() => {
    if (!iban.trim()) return null
    const r = validarIban(iban)
    return r.ok ? null : r.motivo
  }, [iban])
  const ibanNorm = iban.trim() ? normalizarIban(iban) : ''
  const extranjero = ibanNorm !== '' && !ibanNorm.startsWith('ES')
  const err = (c: keyof FichaProveedor) => errores.find((e) => e.campo === c)?.mensaje ?? null

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setFallo(null)
    const errs: ProblemaFicha[] = []
    const plazoN = plazo.trim() === '' ? null : Number(plazo)
    if (plazoN !== null && (!Number.isInteger(plazoN) || plazoN < 0 || plazoN > 365)) errs.push({ campo: 'paymentTermsDays', mensaje: 'El plazo son días, de 0 a 365. 0 = al contado.' })
    const diasN = leerDias(dias)
    if (diasN === null) errs.push({ campo: 'paymentFixedDays', mensaje: 'Escribe los días del mes separados por comas, del 1 al 31: «5, 20».' })
    if (ibanAlMomento) errs.push({ campo: 'iban', mensaje: ibanAlMomento })
    const prontoN = pronto.trim() === '' ? null : Number(pronto.replace(',', '.'))
    if (prontoN !== null && (Number.isNaN(prontoN) || prontoN < 0 || prontoN > 100)) errs.push({ campo: 'earlyPaymentDiscountPct', mensaje: 'El descuento por pronto pago va de 0 a 100 %.' })
    if (errs.length) { setErrores(errs); return }

    const nuevoIban = ibanNorm || null
    const cambios: Partial<FichaProveedor> = {
      paymentMethod: metodo || null,
      paymentTermsDays: plazoN,
      paymentFixedDays: diasN ?? [],
      iban: nuevoIban,
      bic: bic.trim().toUpperCase() || null,
      bankName: banco.trim() || null,
      currency: moneda,
      earlyPaymentDiscountPct: prontoN,
      // El mandato solo tiene sentido con domiciliación; si se cambia la forma, se conserva pero no se enseña.
      sepaMandateRef: mandRef.trim() || null,
      sepaMandateDate: mandFecha || null,
    }
    if (nuevoIban !== f.iban) cambios.ibanVerifiedAt = nuevoIban ? new Date().toISOString() : null
    setOcupado(true)
    try {
      const r = await guardar(cambios)
      setErrores(r.errores)
      if (r.errores.length === 0) {
        if (nuevoIban) setIban(formatearIban(nuevoIban))
        avisar(nuevoIban && nuevoIban !== f.iban ? 'Guardado. IBAN comprobado.' : 'Forma de pago guardada.')
      }
    } catch (e2) {
      setFallo(e2 instanceof Error ? e2.message : 'No se pudo guardar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <form className="cf-form" onSubmit={enviar} noValidate>
      {fallo && <div className="cf-error" role="alert">{fallo}</div>}
      <Campo campo="paymentMethod" etiqueta="Forma de pago">
        {(p) => (
          <select {...p} className="cf-select" value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod | '')}>
            <option value="">Sin decir</option>
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
          </select>
        )}
      </Campo>
      <div className="cf-fila">
        <Campo campo="paymentTermsDays" etiqueta="Plazo (días desde la factura)" error={err('paymentTermsDays')} ayuda="0 = al contado.">
          {(p) => <input {...p} className="cf-input" value={plazo} inputMode="numeric" onChange={(e) => setPlazo(e.target.value)} />}
        </Campo>
        <Campo campo="paymentFixedDays" etiqueta="Días fijos de pago" error={err('paymentFixedDays')} ayuda="Si paga solo ciertos días del mes: «5, 20». Opcional.">
          {(p) => <input {...p} className="cf-input" value={dias} inputMode="numeric" onChange={(e) => setDias(e.target.value)} />}
        </Campo>
      </div>
      <Campo campo="iban" etiqueta="IBAN" error={err('iban') ?? ibanAlMomento}
        ayuda={ibanNorm && !ibanAlMomento ? 'IBAN correcto.' : 'Lo comprobamos al momento con sus dígitos de control.'}>
        {(p) => <input {...p} className="cf-input" value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} autoComplete="off" placeholder="ES12 3456 7890 1234 5678 9012" style={{ fontVariantNumeric: 'tabular-nums' }} />}
      </Campo>
      <Campo campo="bic" etiqueta={extranjero ? 'BIC / SWIFT (obligatorio con un IBAN de fuera de España)' : 'BIC / SWIFT (opcional)'} error={err('bic')}>
        {(p) => <input {...p} className="cf-input" value={bic} onChange={(e) => setBic(e.target.value.toUpperCase())} autoComplete="off" placeholder="CAIXESBBXXX" />}
      </Campo>
      <Campo campo="bankName" etiqueta="Banco">
        {(p) => <input {...p} className="cf-input" value={banco} onChange={(e) => setBanco(e.target.value)} />}
      </Campo>
      {metodo === 'direct_debit' && (
        <div className="cf-fila">
          <Campo campo="sepaMandateRef" etiqueta="Referencia del mandato de domiciliación">
            {(p) => <input {...p} className="cf-input" value={mandRef} onChange={(e) => setMandRef(e.target.value)} />}
          </Campo>
          <Campo campo="sepaMandateDate" etiqueta="Fecha de firma del mandato">
            {(p) => <input {...p} className="cf-input" type="date" value={mandFecha} onChange={(e) => setMandFecha(e.target.value)} />}
          </Campo>
        </div>
      )}
      <div className="cf-fila">
        <Campo campo="currency" etiqueta="Moneda">
          {(p) => <select {...p} className="cf-select" value={moneda} onChange={(e) => setMoneda(e.target.value)}>{MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
        </Campo>
        <Campo campo="earlyPaymentDiscountPct" etiqueta="Descuento por pronto pago (%)" error={err('earlyPaymentDiscountPct')}>
          {(p) => <input {...p} className="cf-input" value={pronto} inputMode="decimal" onChange={(e) => setPronto(e.target.value)} />}
        </Campo>
      </div>
      <div className="cf-pie-form">
        <button type="submit" className="cf-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        <Guardado texto={aviso} />
      </div>
    </form>
  )
}
