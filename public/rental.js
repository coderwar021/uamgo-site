const RENTAL = 'https://rental.madecoding.com'

const FALLBACK_PLANS = [
  { id: 'group5', name: 'Qwen3.6-27B 4-bit', price_cny_per_hour: 50 },
  { id: 'group6', name: 'Gemma 4 E2B IT', price_cny_per_hour: 25 },
]

const email = document.querySelector('#rental-email')
const password = document.querySelector('#rental-password')
const plan = document.querySelector('#rental-plan')
const hours = document.querySelector('#rental-hours')
const buy = document.querySelector('#rental-buy')
const status = document.querySelector('#rental-status')
const issued = document.querySelector('#rental-issued')
const form = document.querySelector('#rental')

let token = ''
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

async function loadPlans() {
  try {
    const response = await fetch(`${RENTAL}/plans`)
    if (!response.ok) throw new Error(String(response.status))
    const body = await response.json()
    const list = Array.isArray(body) ? body : []
    fillPlans(list.length === 0 ? FALLBACK_PLANS : list)
  } catch {
    fillPlans(FALLBACK_PLANS)
  }
}

async function auth(path) {
  setStatus('')
  let response
  try {
    response = await fetch(`${RENTAL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value }),
    })
  } catch {
    setStatus(path === '/auth/register'
      ? '注册失败，邮箱可能已存在，或租赁服务未启动（rental.madecoding.com）。'
      : '登录失败。请检查邮箱密码，或确认租赁服务已启动。')
    return
  }
  if (!response.ok) {
    setStatus(path === '/auth/register'
      ? '注册失败，邮箱可能已存在，或租赁服务未启动（rental.madecoding.com）。'
      : '登录失败。请检查邮箱密码，或确认租赁服务已启动。')
    return
  }
  const body = await response.json()
  if (typeof body.token !== 'string') {
    setStatus('未返回登录令牌')
    return
  }
  token = body.token
  plan.disabled = false
  hours.disabled = false
  buy.disabled = false
  setStatus(`已登录：${email.value}。选择套餐和小时数后支付。小时数与开通时长相同。`)
}

async function pollOrder() {
  if (orderId.length === 0) return
  const response = await fetch(`${RENTAL}/orders/${orderId}`, {
    headers: { authorization: `Bearer ${token}` },
  })
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

document.querySelector('#rental-login')?.addEventListener('click', () => {
  void auth('/auth/login')
})
document.querySelector('#rental-register')?.addEventListener('click', () => {
  void auth('/auth/register')
})

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  if (token.length === 0) {
    setStatus('请先登录或注册')
    return
  }
  const paidHours = Number(hours.value)
  void (async () => {
    const response = await fetch(`${RENTAL}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ plan_id: plan.value, hours: paidHours }),
    })
    if (!response.ok) {
      setStatus('下单失败')
      return
    }
    const body = await response.json()
    orderId = typeof body.order_id === 'string' ? body.order_id : ''
    if (typeof body.checkout === 'string') {
      setStatus(`打开结账链接完成支付：${body.checkout}`)
      window.open(body.checkout, '_blank', 'noopener')
    } else {
      setStatus('已下单，等待支付与开通…')
    }
  })()
})

void loadPlans()
window.setInterval(() => { void pollOrder() }, 3_000)
