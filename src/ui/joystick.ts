export type JoystickState = {
  moveX: number
  moveY: number
  active: boolean
}

export function createJoystick(params: {
  base: HTMLDivElement
  knob: HTMLDivElement
  isEnabled: () => boolean
}) {
  const { base, knob, isEnabled } = params
  const state: JoystickState = { moveX: 0, moveY: 0, active: false }

  let activeId: number | null = null
  let cx = 0
  let cy = 0
  let radius = 1

  function setKnob(dx: number, dy: number) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`
  }

  function updateFromClient(clientX: number, clientY: number) {
    const dx = clientX - cx
    const dy = clientY - cy
    const len = Math.hypot(dx, dy)
    const max = radius
    const k = len > max ? max / len : 1
    const ndx = dx * k
    const ndy = dy * k
    setKnob(ndx, ndy)
    state.moveX = ndx / max
    state.moveY = -ndy / max
  }

  function reset() {
    activeId = null
    state.moveX = 0
    state.moveY = 0
    state.active = false
    setKnob(0, 0)
  }

  base.addEventListener('pointerdown', (ev) => {
    if (!isEnabled()) return
    ev.preventDefault()
    activeId = ev.pointerId
    state.active = true
    base.setPointerCapture(ev.pointerId)
    const rect = base.getBoundingClientRect()
    cx = rect.left + rect.width / 2
    cy = rect.top + rect.height / 2
    radius = Math.min(rect.width, rect.height) * 0.38
    updateFromClient(ev.clientX, ev.clientY)
  })

  base.addEventListener('pointermove', (ev) => {
    if (!isEnabled()) return
    if (activeId !== ev.pointerId) return
    ev.preventDefault()
    updateFromClient(ev.clientX, ev.clientY)
  })

  const end = (ev: PointerEvent) => {
    if (activeId !== ev.pointerId) return
    ev.preventDefault()
    reset()
  }
  base.addEventListener('pointerup', end)
  base.addEventListener('pointercancel', end)
  base.addEventListener('pointerleave', (ev) => {
    if (activeId !== ev.pointerId) return
    reset()
  })

  return { state, reset }
}
