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

  const dialog = document.createElement('dialog')
  dialog.className = 'account-dialog'
  dialog.innerHTML = `
    <form method="dialog" class="account-form">
      <p class="kicker">Aether</p>
      <h2>登录或注册</h2>
      <p>验证码由 <a href="https://mail.uamgo.com/" target="_blank" rel="noopener">mail.uamgo.com</a> 发到你的邮箱。</p>
      <label><span>名称</span><input name="name" type="text" autocomplete="name" placeholder="注册时填写"></label>
      <label><span>邮箱</span><input name="email" type="email" autocomplete="username" required></label>
      <label><span>密码</span><input name="password" type="password" autocomplete="current-password" required minlength="8"></label>
      <label><span>确认密码</span><input name="confirm" type="password" autocomplete="new-password" minlength="8" placeholder="注册时填写"></label>
      <label class="otp-row"><span>验证码</span>
        <span class="otp-fields">
          <input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required>
          <button type="button" data-otp="1">发送验证码</button>
        </span>
      </label>
      <p class="account-status" role="status"></p>
      <div class="rental-actions">
        <button type="button" data-auth="login">登录</button>
        <button type="button" data-auth="register">注册</button>
      </div>
      <button type="submit" class="account-close" value="close">关闭</button>
    </form>
  `
  document.body.append(dialog)

  const status = dialog.querySelector('.account-status')
  const form = dialog.querySelector('form')
  let currentEmail = null

  function paint() {
    open.textContent = currentEmail === null ? '登录' : currentEmail
    open.title = currentEmail === null ? '登录或注册' : `${currentEmail}，点击退出`
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
        await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' })
        currentEmail = null
        paint()
      })()
      return
    }
    status.textContent = ''
    dialog.showModal()
  })

  form.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    const data = new FormData(form)
    const email = String(data.get('email') ?? '')
    if (target.dataset.otp === '1') {
      event.preventDefault()
      status.textContent = '正在发送验证码…'
      void (async () => {
        let response
        try {
          response = await fetch('/auth/otp', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              email,
              purpose: String(data.get('name') ?? '').trim().length > 0 ? 'register' : 'login',
            }),
          })
        } catch {
          status.textContent = '网络失败，请重试。'
          return
        }
        const body = await response.json().catch(() => ({}))
        status.textContent = typeof body.message === 'string' ? body.message : '发送失败。'
      })()
      return
    }
    const action = target.dataset.auth
    if (action !== 'login' && action !== 'register') return
    event.preventDefault()
    const password = String(data.get('password') ?? '')
    const confirm = String(data.get('confirm') ?? '')
    const name = String(data.get('name') ?? '')
    const code = String(data.get('code') ?? '')
    const path = action === 'register' ? '/auth/register' : '/auth/login'
    status.textContent = '正在提交…'
    void (async () => {
      let response
      try {
        response = await fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            confirmPassword: confirm.length > 0 ? confirm : password,
            name,
            code,
          }),
        })
      } catch {
        status.textContent = '网络失败，请重试。'
        return
      }
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        status.textContent = typeof body.message === 'string' ? body.message : '登录失败。'
        form.classList.remove('shake')
        void form.offsetWidth
        form.classList.add('shake')
        return
      }
      currentEmail = typeof body.email === 'string' ? body.email : email
      paint()
      dialog.close()
    })()
  })

  void refresh()
}
