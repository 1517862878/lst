import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { ApiError, translateDbError } from '../lib/errors.js'
import { registerProfileRoutes } from './profiles.js'

async function buildTestApp() {
  const app = Fastify()
  app.setErrorHandler((err, _req, reply) => {
    const apiError = err instanceof ApiError ? err : translateDbError(err)
    if (apiError) {
      return reply.status(apiError.status).send({ code: apiError.code, message: apiError.message })
    }
    return reply.status(500).send({ code: 'INTERNAL', message: '服务器内部错误' })
  })
  await registerProfileRoutes(app)
  return app
}

for (const limit of ['0', '-1', '1.5', 'NaN']) {
  test(`profile interactions rejects limit=${limit} before database access`, async () => {
    const app = await buildTestApp()
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/profiles/pi_alice/interactions?kind=likes&limit=${limit}`,
      })
      assert.equal(response.statusCode, 400, response.body)
      assert.equal(response.json().code, 'VALIDATION')
    } finally {
      await app.close()
    }
  })
}
