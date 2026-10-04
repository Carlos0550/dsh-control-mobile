import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface AccessInfo {
  loginUrl?: string
  mode: string
  hostname?: string
  declared: boolean
}

interface MissionApi {
  access(): Promise<AccessInfo>
  revoke(): Promise<{ ok: boolean; restartRequired: boolean }>
}

const MODE_LABELS: Record<string, string> = {
  tailnet: 'Red privada (Tailscale)',
  public: 'Túnel público',
  loopback: 'Solo local',
}

interface Props {
  api: MissionApi
}

export function Access({ api }: Props) {
  const [info, setInfo] = useState<AccessInfo | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [revoked, setRevoked] = useState(false)

  useEffect(() => {
    api.access().then(async (i) => {
      setInfo(i)
      if (i.loginUrl) {
        try {
          const url = await QRCode.toDataURL(i.loginUrl)
          setQr(url)
        } catch {
          setQrError('No se pudo generar el código QR')
        }
      }
    }).catch(console.error)
  }, [api])

  const handleRevoke = async () => {
    await api.revoke()
    setRevoked(true)
  }

  if (!info) return <p>Cargando...</p>

  const modeLabel = MODE_LABELS[info.mode] ?? info.mode

  return (
    <div className="access-view">
      <h2>Acceso</h2>

      <p className="mode-line">
        <strong>{modeLabel}</strong>
      </p>

      {info.hostname && <p className="hostname">{info.hostname}</p>}

      {!info.declared && (
        <p className="warning">
          ⚠️ El equipo <strong>no está en trustedHosts</strong>: añádelo con --trusted-host
        </p>
      )}

      {qr ? (
        <div className="qr-container">
          <img width={220} height={220} src={qr} alt="Código QR de acceso" />
        </div>
      ) : qrError ? (
        <p className="qr-error">{qrError}{info.loginUrl ? ': ' + info.loginUrl : null}</p>
      ) : (
        <p className="no-qr">Abre la URL de acceso desde el propio PC</p>
      )}

      <button
        className="revoke-btn"
        onClick={handleRevoke}
        disabled={revoked}
      >
        Cerrar todas las sesiones de navegador
      </button>

      {revoked && (
        <p className="revoked-msg">hecho — reinicia dsh para que surta efecto</p>
      )}
    </div>
  )
}
