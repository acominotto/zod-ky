import { ZodError, z } from 'zod'

jest.mock('ky', () => {
  function createMockKy(mergedOptions: Record<string, unknown> = {}) {
    const baseUrl = (url: string) => {
      const prefix = (mergedOptions.prefixUrl as string) || ''
      if (!prefix) return url
      return prefix.replace(/\/$/, '') + '/' + String(url).replace(/^\//, '')
    }
    const hooks = mergedOptions.hooks as { afterResponse?: unknown[] } | undefined
    const hook = hooks?.afterResponse?.[0] as ((_r: unknown, _o: unknown, res: Response) => Promise<Response>) | undefined
    const runRequest = (method: string, url: string, options?: Record<string, unknown>) =>
      fetch(baseUrl(url), { method, ...options }).then(async (res) => {
        const response = res as Response
        return hook ? hook(new Request(baseUrl(url)), {}, response) : response
      })
    return {
      extend(options: Record<string, unknown> | ((parent: Record<string, unknown>) => Record<string, unknown>)) {
        const next = typeof options === 'function' ? options(mergedOptions) : { ...mergedOptions, ...options }
        return createMockKy(next)
      },
      get: (url: string, options?: Record<string, unknown>) => runRequest('GET', url, options),
      post: (url: string, options?: Record<string, unknown>) => runRequest('POST', url, options),
      put: (url: string, options?: Record<string, unknown>) => runRequest('PUT', url, options),
      delete: (url: string, options?: Record<string, unknown>) => runRequest('DELETE', url, options),
      patch: (url: string, options?: Record<string, unknown>) => runRequest('PATCH', url, options),
      head: (url: string, options?: Record<string, unknown>) => runRequest('HEAD', url, options),
      options: (url: string, options?: Record<string, unknown>) => runRequest('OPTIONS', url, options),
    }
  }
  return { __esModule: true, default: createMockKy({}) }
})

import { ky } from '../src/zod-ky'
import type { AugmentedResponse } from '../src/zod-ky.types'

const userSchema = z.object({ id: z.number(), name: z.string() })
type User = z.infer<typeof userSchema>

const validUser: User = { id: 1, name: 'a' }
const invalidUserPayload = { id: 'not-a-number', name: 'a' }

describe('ky', () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchMock.mockRestore()
  })

  describe('parseJson', () => {
    it('returns parsed and validated data when JSON matches schema', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validUser), { status: 200 })
      )

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse
      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('throws ZodError when JSON does not match schema', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(invalidUserPayload), { status: 200 })
      )

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse
      await expect(response.parseJson(userSchema)).rejects.toBeInstanceOf(
        ZodError
      )
    })
  })

  describe('safeParseJson', () => {
    it('returns { success: true, data } when JSON matches schema', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validUser), { status: 200 })
      )

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse
      const result = await response.safeParseJson(userSchema)

      expect(result).toEqual({ success: true, data: validUser })
    })

    it('returns { success: false, error } with ZodError when JSON does not match schema', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(invalidUserPayload), { status: 200 })
      )

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse
      const result = await response.safeParseJson(userSchema)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ZodError)
      }
    })
  })

  describe('extend()', () => {
    it('returns an augmented instance with parseJson/safeParseJson on responses', async () => {
      const extended = ky.extend({
        prefixUrl: 'https://api.example.com',
      })

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validUser), { status: 200 })
      )

      const response = (await extended.get('/user')) as AugmentedResponse
      const data = await response.parseJson(userSchema)

      expect(data).toEqual(validUser)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/user',
        expect.any(Object)
      )
    })

    it('preserves augmentation when chaining extend()', async () => {
      const extended = ky
        .extend({ prefixUrl: 'https://api.example.com' })
        .extend({ timeout: 1000 })

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validUser), { status: 200 })
      )

      const response = (await extended.get('/user')) as AugmentedResponse
      expect(typeof response.parseJson).toBe('function')
      expect(typeof response.safeParseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })
  })

  describe('HTTP methods return AugmentedResponsePromise', () => {
    it('get returns response with parseJson and safeParseJson', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validUser), { status: 200 })
      )

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse

      expect(typeof response.parseJson).toBe('function')
      expect(typeof response.safeParseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('post returns response with parseJson and safeParseJson', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validUser), { status: 200 })
      )

      const response = (await ky.post('https://api.example.com/user', {
        json: { name: 'new' },
      })) as AugmentedResponse

      expect(typeof response.parseJson).toBe('function')
      expect(typeof response.safeParseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })
  })
})
