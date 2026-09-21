for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    const source = document.querySelector(button.dataset.copy)
    if (source === null) return
    try {
      await navigator.clipboard.writeText(source.textContent.trim())
      const previous = button.textContent
      button.textContent = '已复制'
      setTimeout(() => { button.textContent = previous }, 1600)
    } catch {
      getSelection()?.selectAllChildren(source)
    }
  })
}

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
      <p class="kicker">Account</p>
      <h2>登录或注册</h2>
      <label><span>邮箱</span><input name="email" type="email" autocomplete="username" required></label>
      <label><span>密码</span><input name="password" type="password" autocomplete="current-password" required minlength="8"></label>
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
    const action = target.dataset.auth
    if (action !== 'login' && action !== 'register') return
    event.preventDefault()
    const data = new FormData(form)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const path = action === 'register' ? '/auth/register' : '/auth/login'
    status.textContent = '正在提交…'
    void (async () => {
      let response
      try {
        response = await fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      } catch {
        status.textContent = '网络失败，请重试。'
        return
      }
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        status.textContent = typeof body.message === 'string' ? body.message : '登录失败。'
        return
      }
      currentEmail = typeof body.email === 'string' ? body.email : email
      paint()
      dialog.close()
    })()
  })

  void refresh()
}
