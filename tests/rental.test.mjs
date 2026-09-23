import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import {
  createRentalOrder,
  fetchRentalOrder,
  fetchRentalPlans,
  forwardWaffoWebhook,
  rentalOrigin,
  rentalReady,
} from '../rental.mjs'

test('rental origin defaults to gateway.madecoding.com', () => {
  const saved = process.env.RENTAL_ORIGIN
  delete process.env.RENTAL_ORIGIN
  try {
    assert.equal(rentalOrigin(), 'https://gateway.madecoding.com')
  } finally {
    if (saved !== undefined) process.env.RENTAL_ORIGIN = saved
  }
})

test('without RENTAL_SITE_KEY the site does not call the gateway', async () => {
  const saved = process.env.RENTAL_SITE_KEY
  delete process.env.RENTAL_SITE_KEY
  let called = 0
  const fetchImpl = async () => {
    called += 1
    return new Response('{}', { status: 500 })
  }
  try {
    assert.equal(rentalReady(), false)
    assert.equal(await createRentalOrder({ id: 'a' }, fetchImpl), 'a')
    assert.equal(await fetchRentalPlans(fetchImpl), undefined)
    assert.equal(await fetchRentalOrder('a', fetchImpl), undefined)
    await forwardWaffoWebhook(Buffer.from('{}'), 'sig', fetchImpl)
    assert.equal(called, 0)
  } finally {
    if (saved !== undefined) process.env.RENTAL_SITE_KEY = saved
  }
})

test('createRentalOrder posts the site uuid with X-Site-Key', async () => {
  process.env.RENTAL_SITE_KEY = 'shared'
  process.env.RENTAL_ORIGIN = 'https://gateway.madecoding.com'
  const id = '550e8400-e29b-41d4-a716-446655440000'
  let seen
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), headers: init.headers, body: JSON.parse(String(init.body)) }
    return new Response(JSON.stringify({ order_id: id }), { status: 201 })
  }
  try {
    assert.equal(await createRentalOrder({ id, user_id: 'u1', plan_id: 'group5', hours: 2 }, fetchImpl), id)
    assert.equal(seen.url, 'https://gateway.madecoding.com/orders')
    assert.equal(seen.headers['x-site-key'], 'shared')
    assert.equal(seen.body.id, id)
    assert.equal(seen.body.hours, 2)
  } finally {
    delete process.env.RENTAL_SITE_KEY
    delete process.env.RENTAL_ORIGIN
  }
})
