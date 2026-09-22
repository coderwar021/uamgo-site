function addRipple(event) {
  const button = event.currentTarget
  const box = button.getBoundingClientRect()
  const ripple = document.createElement('span')
  ripple.className = 'ripple'
  const size = 20
  ripple.style.width = ripple.style.height = `${size}px`
  ripple.style.left = `${event.clientX - box.left - size / 2}px`
  ripple.style.top = `${event.clientY - box.top - size / 2}px`
  button.append(ripple)
  setTimeout(() => ripple.remove(), 600)
}

for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', (event) => {
    addRipple(event)
    const source = document.querySelector(button.dataset.copy)
    if (source === null) return
    void (async () => {
      try {
        await navigator.clipboard.writeText(source.textContent.trim())
        const previous = button.textContent
        button.textContent = '已复制'
        setTimeout(() => { button.textContent = previous }, 1600)
      } catch {
        getSelection()?.selectAllChildren(source)
      }
    })()
  })
}

const reveal = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) entry.target.classList.add('in')
  }
}, { threshold: 0.18 })
for (const node of document.querySelectorAll('.scroll-reveal')) reveal.observe(node)

const wrap = document.querySelector('.site-header .wrap')
if (wrap !== null) {
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'account-open'
  open.textContent = '登录'
  wrap.append(open)

  let currentEmail = null

  function csrfToken() {
    for (const part of document.cookie.split(';')) {
      const [name, ...rest] = part.trim().split('=')
      if (name === 'csrf' || name === '__Host-csrf') return rest.join('=')
    }
    return ''
  }

  function paint() {
    open.textContent = currentEmail === null ? '登录' : currentEmail
    open.title = currentEmail === null ? '用 Aether 登录' : `${currentEmail}，点击退出`
    window.dispatchEvent(new CustomEvent('madecoding-auth', { detail: { email: currentEmail } }))
  }

  async function refresh() {
    try {
      const response = await fetch('/auth/me', { credentials: 'same-origin' })
      const body = await response.json()
      currentEmail = typeof body.email === 'string' ? body.email : null
    } catch {
      currentEmail = null
    }
    paint()
  }

  open.addEventListener('click', () => {
    if (currentEmail !== null) {
      void (async () => {
        await fetch('/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-csrf-token': csrfToken() },
        })
        currentEmail = null
        paint()
      })()
      return
    }
    window.location.assign('/auth/aether')
  })

  void refresh()
}
