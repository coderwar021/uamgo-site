const params = new URLSearchParams(window.location.search)
const userCode = (params.get('code') ?? '').trim().toUpperCase()
const codeLine = document.querySelector('#cli-code')
const form = document.querySelector('#cli-form')
const hint = document.querySelector('#cli-hint')
const errorLine = document.querySelector('#cli-error')
const done = document.querySelector('#cli-done')
const keyInput = form?.elements.namedItem('api_key')

if (userCode.length > 0 && codeLine !== null) codeLine.textContent = userCode

function csrfToken() {
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === 'csrf' || name === '__Host-csrf') return rest.join('=')
  }
  return ''
}

/**
 * @param {{ email: string | null, has_key: boolean }} state
 */
function paint(state) {
  if (form === null || hint === null || done === null) return
  done.hidden = true
  if (userCode.length === 0) {
    form.hidden = true
    hint.textContent = ''
    return
  }
  if (state.email === null) {
    form.hidden = true
    hint.textContent = '请先点右上角登录或注册。'
    const open = document.querySelector('.account-open')
    if (open instanceof HTMLButtonElement) open.click()
    return
  }
  form.hidden = false
  hint.textContent = state.has_key
    ? `已登录 ${state.email}。可以直接授权，或粘贴新的密钥。`
    : `已登录 ${state.email}。把 madeapi.com 的密钥粘贴到下面。`
  if (keyInput instanceof HTMLInputElement) {
    keyInput.required = !state.has_key
    if (state.has_key) keyInput.placeholder = '已保存，可留空'
  }
}

async function refresh() {
  try {
    const response = await fetch('/cli/ready', { credentials: 'same-origin' })
    const body = await response.json()
    paint({
      email: typeof body.email === 'string' ? body.email : null,
      has_key: body.has_key === true,
    })
  } catch {
    paint({ email: null, has_key: false })
  }
}

window.addEventListener('madecoding-auth', () => {
  void refresh()
})

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  if (errorLine !== null) errorLine.textContent = ''
  const payload = {
    user_code: userCode,
    api_key: keyInput instanceof HTMLInputElement ? keyInput.value : '',
  }
  void (async () => {
    const response = await fetch('/cli/approve', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken(),
      },
      body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (errorLine !== null) errorLine.textContent = body.message ?? '授权失败'
      if (response.status === 401) void refresh()
      return
    }
    form.hidden = true
    if (done !== null) done.hidden = false
  })()
})

void refresh()
