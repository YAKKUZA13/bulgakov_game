export type CameraStartResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; error: string; cause?: unknown }

export async function startRearCamera(video: HTMLVideoElement): Promise<CameraStartResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: 'getUserMedia is not supported in this browser.' }
  }

  // iOS Safari requires playsinline attribute (already in markup), and user gesture.
  // Prefer the rear camera; browsers may ignore this hint.
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    video.srcObject = stream

    // Some browsers resolve play() only after metadata is loaded.
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) resolve()
      else video.onloadedmetadata = () => resolve()
    })

    // play() can throw if not in a user gesture; we call start from a click.
    await video.play()
    return { ok: true, stream }
  } catch (cause) {
    const err = cause as any
    const name = String(err?.name || '')
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { ok: false, error: 'Camera permission denied.', cause }
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { ok: false, error: 'No suitable camera found for this device.', cause }
    }
    return { ok: false, error: 'Failed to start camera.', cause }
  }
}

export function stopCamera(stream: MediaStream | null) {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}


