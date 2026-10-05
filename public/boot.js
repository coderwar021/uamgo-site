const root = document.documentElement

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  root.classList.add('motion')
  try {
    const spot = sessionStorage.getItem('madecoding-iris')
    if (spot !== null) {
      sessionStorage.removeItem('madecoding-iris')
      const [x, y] = spot.split(',').map(Number)
      if (Number.isFinite(x) && Number.isFinite(y)) {
        root.style.setProperty('--ix', `${x}%`)
        root.style.setProperty('--iy', `${y}%`)
      }
    }
  } catch {
    // Storage blocked (private mode): the iris opens from the default center.
  }
}
