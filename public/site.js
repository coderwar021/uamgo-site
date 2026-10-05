const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const PAGES = new Set(['/', '/install', '/deploy', '/config', '/terms'])
const TONES = ['#ffd23f', '#ff6b57', '#3ddc97', '#8f7bff', '#ff9fcb', '#7fd0ff']

let fxLayer = null

function effects() {
  if (fxLayer === null) {
    fxLayer = document.createElement('div')
    fxLayer.className = 'fx-layer'
    fxLayer.setAttribute('aria-hidden', 'true')
    document.body.append(fxLayer)
  }
  return fxLayer
}

function replay(node, name) {
  node.classList.remove(name)
  void node.offsetWidth
  node.classList.add(name)
}

function pointOf(event, node) {
  if (event.detail !== 0 && (event.clientX !== 0 || event.clientY !== 0)) {
    return { x: event.clientX, y: event.clientY }
  }
  const box = node.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

function burst(x, y, count = 10) {
  if (calm) return
  const host = effects()
  for (let i = 0; i < count; i += 1) {
    const star = document.createElement('span')
    star.className = 'star'
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6
    const distance = 42 + Math.random() * 56
    star.style.left = `${x}px`
    star.style.top = `${y}px`
    star.style.setProperty('--dx', `${Math.cos(angle) * distance}px`)
    star.style.setProperty('--dy', `${Math.sin(angle) * distance}px`)
    star.style.setProperty('--c', TONES[i % TONES.length])
    star.addEventListener('animationend', () => star.remove())
    host.append(star)
  }
}

function confetti(count = 70) {
  if (calm) return
  const host = effects()
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('span')
    piece.className = 'confetti'
    piece.style.left = `${Math.random() * 100}vw`
    piece.style.setProperty('--c', TONES[i % TONES.length])
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 30}vw`)
    piece.style.setProperty('--r', `${(Math.random() - 0.5) * 1440}deg`)
    piece.style.setProperty('--t', `${1.8 + Math.random() * 1.6}s`)
    piece.style.animationDelay = `${Math.random() * 0.5}s`
    piece.addEventListener('animationend', () => piece.remove())
    host.append(piece)
  }
}

function splitTitle(title) {
  title.setAttribute('aria-label', title.textContent.replace(/\s+/gu, ' ').trim())
  let index = 0
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child)
        continue
      }
      if (child.nodeType !== Node.TEXT_NODE) continue
      const fragment = document.createDocumentFragment()
      for (const char of child.textContent) {
        if (/\s/u.test(char)) {
          fragment.append(char)
          continue
        }
        const span = document.createElement('span')
        span.className = 'ch'
        span.setAttribute('aria-hidden', 'true')
        span.style.setProperty('--i', String(index))
        span.textContent = char
        fragment.append(span)
        index += 1
      }
      child.replaceWith(fragment)
    }
  }
  walk(title)
}

if (!calm) {
  for (const title of document.querySelectorAll('.title')) splitTitle(title)
}

for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', () => {
    const source = document.querySelector(button.dataset.copy)
    if (source === null) return
    void (async () => {
      try {
        await navigator.clipboard.writeText(source.textContent.trim())
        const previous = button.textContent
        button.textContent = '已复制'
        button.classList.add('done')
        setTimeout(() => {
          button.textContent = previous
          button.classList.remove('done')
        }, 1600)
      } catch {
        getSelection()?.selectAllChildren(source)
      }
    })()
  })
}

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest('button')
  if (button === null || button.disabled) return
  const { x, y } = pointOf(event, button)
  burst(x, y)
})

const reveal = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    entry.target.classList.add('in')
    reveal.unobserve(entry.target)
  }
}, { threshold: 0.18 })
for (const node of document.querySelectorAll('.scroll-reveal')) reveal.observe(node)

document.addEventListener('click', (event) => {
  if (calm || event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (!(event.target instanceof Element)) return
  const link = event.target.closest('a[href]')
  if (link === null || link.target !== '' || link.hasAttribute('download')) return
  const url = new URL(link.href, window.location.href)
  if (url.origin !== window.location.origin || !PAGES.has(url.pathname) || url.hash !== '') return
  if (url.pathname === window.location.pathname) return
  event.preventDefault()
  const { x, y } = pointOf(event, link)
  const shade = document.createElement('div')
  shade.className = 'iris-close'
  shade.setAttribute('aria-hidden', 'true')
  shade.style.setProperty('--x', `${x}px`)
  shade.style.setProperty('--y', `${y}px`)
  document.body.append(shade)
  try {
    const spot = `${((x / window.innerWidth) * 100).toFixed(1)},${((y / window.innerHeight) * 100).toFixed(1)}`
    sessionStorage.setItem('madecoding-iris', spot)
  } catch {
    // Storage blocked (private mode): the next page opens from its default center.
  }
  setTimeout(() => window.location.assign(url.href), 430)
})

window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return
  for (const shade of document.querySelectorAll('.iris-close')) shade.remove()
})

const lookers = [...document.querySelectorAll('.bot, .gpu-buddy')]
if (!calm && lookers.length > 0) {
  let frame = 0
  let pointerX = 0
  let pointerY = 0
  window.addEventListener('pointermove', (event) => {
    pointerX = event.clientX
    pointerY = event.clientY
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      for (const looker of lookers) {
        const box = looker.getBoundingClientRect()
        const dx = pointerX - (box.left + box.width / 2)
        const dy = pointerY - (box.top + box.height * 0.4)
        const length = Math.hypot(dx, dy) || 1
        const pull = Math.min(1, length / 260)
        looker.style.setProperty('--lx', `${(dx / length) * 7 * pull}px`)
        looker.style.setProperty('--ly', `${(dy / length) * 5 * pull}px`)
      }
    })
  }, { passive: true })
}

for (const bubble of document.querySelectorAll('.bubble[data-lines]')) {
  const lines = bubble.dataset.lines.split('|')
  if (calm || lines.length < 2) continue
  let at = 0
  setInterval(() => {
    at = (at + 1) % lines.length
    bubble.textContent = lines[at]
    replay(bubble, 'again')
  }, 3400)
}

for (const wrap of document.querySelectorAll('.bot-wrap')) {
  wrap.addEventListener('click', (event) => {
    if (calm) return
    replay(wrap, 'hop')
    burst(event.clientX, event.clientY, 14)
    const bubble = wrap.querySelector('.bubble')
    if (bubble !== null) {
      bubble.textContent = '嘿嘿，被你发现了！'
      replay(bubble, 'again')
    }
  })
  wrap.addEventListener('animationend', (event) => {
    if (event.animationName === 'hop') wrap.classList.remove('hop')
  })
}

for (const status of document.querySelectorAll('[role="status"]')) {
  new MutationObserver(() => {
    if (!calm) replay(status, 'boing')
  }).observe(status, { childList: true, characterData: true, subtree: true })
}

const issued = document.querySelector('#rental-issued')
if (issued !== null) {
  new MutationObserver(() => {
    if (issued.hidden || issued.dataset.cheered === '1') return
    issued.dataset.cheered = '1'
    document.body.classList.add('party')
    confetti()
  }).observe(issued, { attributes: true, attributeFilter: ['hidden'] })
}

const headerWrap = document.querySelector('.site-header .wrap')
if (headerWrap !== null) {
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'account-open'
  open.textContent = '登录'
  headerWrap.append(open)

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
