const emailLine = document.querySelector('#rental-need-login')
const plan = document.querySelector('#rental-plan')
const hours = document.querySelector('#rental-hours')
const buy = document.querySelector('#rental-buy')
const status = document.querySelector('#rental-status')
const issued = document.querySelector('#rental-issued')
const form = document.querySelector('#rental')

let signedIn = false
let orderId = ''

function setStatus(text) {
  status.textContent = text
}

function fillPlans(list) {
  plan.replaceChildren()
  for (const row of list) {
    const option = document.createElement('option')
    option.value = row.id
    const price = row.price_cny_per_hour === undefined ? '' : ` ¥${String(row.price_cny_per_hour)}/小时`
    option.textContent = `${row.name ?? row.id}${price}`
    plan.append(option)
  }
}

function setArmed(on) {
  signedIn = on
  plan.disabled = !on
  hours.disabled = !on
  buy.disabled = !on
  emailLine.hidden = on
}

async function loadPlans() {
  try {
    const response = await fetch('/plans', { credentials: 'same-origin' })
    if (!response.ok) throw new Error(String(response.status))
    const body = await response.json()
    const list = Array.isArray(body) ? body : []
    fillPlans(list)
  } catch {
    fillPlans([
      { id: 'group5', name: 'Qwen3.6-27B 4-bit', price_cny_per_hour: 50 },
      { id: 'group6', name: 'Gemma 4 E2B IT', price_cny_per_hour: 25 },
    ])
  }
}

async function pollOrder() {
  if (orderId.length === 0) return
  const response = await fetch(`/orders/${orderId}`, { credentials: 'same-origin' })
  if (!response.ok) return
  const body = await response.json()
  if (typeof body.base_url !== 'string' || typeof body.key !== 'string') return
  issued.hidden = false
  issued.replaceChildren()
  for (const [label, value] of [
    ['地址', body.base_url],
    ['API 密钥', body.key],
    ['模型', body.model ?? ''],
  ]) {
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = String(value)
    issued.append(dt, dd)
  }
  setStatus('已开通。把地址和密钥填进 madecoding 的模型配置。')
  orderId = ''
}

function applyEmail(email) {
  setArmed(typeof email === 'string')
  if (typeof email === 'string') setStatus(`已登录：${email}。选择套餐和小时数后支付。`)
  else setStatus('')
}

window.addEventListener('madecoding-auth', (event) => {
  applyEmail(event.detail?.email)
})

void (async () => {
  try {
    const response = await fetch('/auth/me', { credentials: 'same-origin' })
    const body = await response.json()
    applyEmail(typeof body.email === 'string' ? body.email : null)
  } catch {
    applyEmail(null)
  }
})()

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!signedIn) {
    setStatus('请先点右上角登录或注册。')
    document.querySelector('.account-open')?.click()
    return
  }
  const paidHours = Number(hours.value)
  void (async () => {
    const response = await fetch('/orders', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_id: plan.value, hours: paidHours }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setStatus(typeof body.message === 'string' ? body.message : '下单失败')
      return
    }
    orderId = typeof body.order_id === 'string' ? body.order_id : ''
    if (typeof body.checkout === 'string' && body.checkout.startsWith('https://')) {
      setStatus('正在打开收银台…')
      window.open(body.checkout, '_blank', 'noopener,noreferrer')
      return
    }
    setStatus('订单已记下，支付通道未返回收银台。')
  })()
})

void loadPlans()
window.setInterval(() => { void pollOrder() }, 3_000)
