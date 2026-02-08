import { ZodError, z } from 'zod'

/**
 * Mock for ky that replicates real ky's behavior:
 * - extend() deep-merges hooks by concatenating arrays
 * - afterResponse hooks all run in order on the response
 * - HTTP methods return a ResponsePromise (promise with .json(), .text() shortcuts)
 */
jest.mock('ky', () => {
  type HooksMap = {
    beforeRequest?: Array<(req: Request, opts: Record<string, unknown>) => void>
    beforeRetry?: Array<(state: Record<string, unknown>) => void>
    afterResponse?: Array<(req: Request, opts: Record<string, unknown>, res: Response) => Response | Promise<Response>>
    beforeError?: Array<(error: Error) => Error>
  }

  function mergeHooks(a: HooksMap = {}, b: HooksMap = {}): HooksMap {
    const result: HooksMap = {}
    const keys = new Set([
      ...Object.keys(a),
      ...Object.keys(b),
    ]) as Set<keyof HooksMap>
    for (const key of keys) {
      const aArr = a[key] ?? []
      const bArr = b[key] ?? []
        ; (result as Record<string, unknown[]>)[key] = [...aArr, ...bArr]
    }
    return result
  }

  /**
   * Wraps a Promise<Response> into a ResponsePromise-like object
   * with .json(), .text() etc. shortcuts (like real ky).
   */
  function toResponsePromise(promise: Promise<Response>) {
    const rp = promise as Promise<Response> & {
      json: <T = unknown>() => Promise<T>
      text: () => Promise<string>
      arrayBuffer: () => Promise<ArrayBuffer>
      blob: () => Promise<Blob>
      formData: () => Promise<FormData>
    }
    rp.json = <T = unknown>() => promise.then((r) => r.json() as Promise<T>)
    rp.text = () => promise.then((r) => r.text())
    rp.arrayBuffer = () => promise.then((r) => r.arrayBuffer())
    rp.blob = () => promise.then((r) => r.blob())
    rp.formData = () => promise.then((r) => r.formData())
    return rp
  }

  function createMockKy(mergedOptions: Record<string, unknown> = {}) {
    const baseUrl = (url: string) => {
      const prefix = (mergedOptions.prefixUrl as string) || ''
      if (!prefix) return url
      return prefix.replace(/\/$/, '') + '/' + String(url).replace(/^\//, '')
    }

    const hooks = (mergedOptions.hooks ?? {}) as HooksMap

    const runRequest = (method: string, url: string, options?: Record<string, unknown>) => {
      const resolvedUrl = baseUrl(url)
      const responsePromise = (async () => {
        let response = await fetch(resolvedUrl, { method, ...options })

        // Run all afterResponse hooks in order (like real ky)
        if (hooks.afterResponse) {
          for (const hook of hooks.afterResponse) {
            const result = await hook(new Request(resolvedUrl), {}, response)
            if (result) response = result
          }
        }

        return response
      })()

      return toResponsePromise(responsePromise)
    }

    const instance = {
      extend(options: Record<string, unknown> | ((parent: Record<string, unknown>) => Record<string, unknown>)) {
        const opts = typeof options === 'function' ? options(mergedOptions) : options
        const parentHooks = (mergedOptions.hooks ?? {}) as HooksMap
        const childHooks = (opts.hooks ?? {}) as HooksMap
        const { hooks: _childHooks, ...restOpts } = opts
        const { hooks: _parentHooks, ...restParent } = mergedOptions
        return createMockKy({
          ...restParent,
          ...restOpts,
          hooks: mergeHooks(parentHooks, childHooks),
        })
      },
      create(options: Record<string, unknown>) {
        return createMockKy(options)
      },
      get: (url: string, options?: Record<string, unknown>) => runRequest('GET', url, options),
      post: (url: string, options?: Record<string, unknown>) => runRequest('POST', url, options),
      put: (url: string, options?: Record<string, unknown>) => runRequest('PUT', url, options),
      delete: (url: string, options?: Record<string, unknown>) => runRequest('DELETE', url, options),
      patch: (url: string, options?: Record<string, unknown>) => runRequest('PATCH', url, options),
      head: (url: string, options?: Record<string, unknown>) => runRequest('HEAD', url, options),
      options: (url: string, options?: Record<string, unknown>) => runRequest('OPTIONS', url, options),
    }
    return instance
  }
  return { __esModule: true, default: createMockKy({}) }
})

import { ky } from '../src/zod-ky'
import type { AugmentedResponse } from '../src/zod-ky.types'

const userSchema = z.object({ id: z.number(), name: z.string() })
type User = z.infer<typeof userSchema>

const validUser: User = { id: 1, name: 'a' }
const invalidUserPayload = { id: 'not-a-number', name: 'a' }

function mockFetch(fetchMock: jest.SpyInstance, payload: unknown, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(payload), { status })
  )
}

describe('zodKy', () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchMock.mockRestore()
  })

  describe('parseJson', () => {
    it('returns parsed and validated data when JSON matches schema', async () => {
      mockFetch(fetchMock, validUser)

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse
      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('throws ZodError when JSON does not match schema', async () => {
      mockFetch(fetchMock, invalidUserPayload)

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse
      await expect(response.parseJson(userSchema)).rejects.toBeInstanceOf(ZodError)
    })
  })

  describe('safeParseJson', () => {
    it('returns { success: true, data } when JSON matches schema', async () => {
      mockFetch(fetchMock, validUser)

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse
      const result = await response.safeParseJson(userSchema)
      expect(result).toEqual({ success: true, data: validUser })
    })

    it('returns { success: false, error } with ZodError when JSON does not match schema', async () => {
      mockFetch(fetchMock, invalidUserPayload)

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
      const extended = ky.extend({ prefixUrl: 'https://api.example.com' })

      mockFetch(fetchMock, validUser)

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

      mockFetch(fetchMock, validUser)

      const response = (await extended.get('/user')) as AugmentedResponse
      expect(typeof response.parseJson).toBe('function')
      expect(typeof response.safeParseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('preserves augmentation when extending with custom hooks', async () => {
      const hookCalls: string[] = []

      const extended = ky.extend({
        hooks: {
          afterResponse: [
            (_req, _opts, response) => {
              hookCalls.push('customAfterResponse')
              return response
            },
          ],
        },
      })

      mockFetch(fetchMock, validUser)

      const response = (await extended.get('https://api.example.com/user')) as AugmentedResponse

      // Custom hook should have been called
      expect(hookCalls).toContain('customAfterResponse')

      // Augmentation should still be present
      expect(typeof response.parseJson).toBe('function')
      expect(typeof response.safeParseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('preserves augmentation when extending with hooks then chaining again', async () => {
      const hookCalls: string[] = []

      const extended = ky
        .extend({
          hooks: {
            afterResponse: [
              (_req, _opts, response) => {
                hookCalls.push('hook1')
                return response
              },
            ],
          },
        })
        .extend({
          hooks: {
            afterResponse: [
              (_req, _opts, response) => {
                hookCalls.push('hook2')
                return response
              },
            ],
          },
        })

      mockFetch(fetchMock, validUser)

      const response = (await extended.get('https://api.example.com/user')) as AugmentedResponse

      // Both custom hooks should have been called
      expect(hookCalls).toContain('hook1')
      expect(hookCalls).toContain('hook2')

      // Augmentation should still be present
      expect(typeof response.parseJson).toBe('function')
      expect(typeof response.safeParseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('preserves augmentation after extend with prefixUrl + hooks together', async () => {
      const hookCalls: string[] = []

      const extended = ky.extend({
        prefixUrl: 'https://api.example.com',
        hooks: {
          afterResponse: [
            (_req, _opts, response) => {
              hookCalls.push('afterResponseInExtend')
              return response
            },
          ],
        },
      })

      mockFetch(fetchMock, validUser)

      const response = (await extended.get('/user')) as AugmentedResponse

      expect(hookCalls).toContain('afterResponseInExtend')
      expect(typeof response.parseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('safeParseJson works on extended instance', async () => {
      const extended = ky.extend({ prefixUrl: 'https://api.example.com' })

      mockFetch(fetchMock, validUser)

      const response = (await extended.get('/user')) as AugmentedResponse
      const result = await response.safeParseJson(userSchema)
      expect(result).toEqual({ success: true, data: validUser })
    })

    it('safeParseJson works on double-extended instance with hooks', async () => {
      const extended = ky
        .extend({ prefixUrl: 'https://api.example.com' })
        .extend({
          hooks: {
            afterResponse: [(_req, _opts, response) => response],
          },
        })

      mockFetch(fetchMock, invalidUserPayload)

      const response = (await extended.get('/user')) as AugmentedResponse
      const result = await response.safeParseJson(userSchema)
      expect(result.success).toBe(false)
    })
  })

  describe('HTTP methods return AugmentedResponsePromise', () => {
    it('get returns response with parseJson and safeParseJson', async () => {
      mockFetch(fetchMock, validUser)

      const response = (await ky.get('https://api.example.com/user')) as AugmentedResponse

      expect(typeof response.parseJson).toBe('function')
      expect(typeof response.safeParseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('post returns response with parseJson and safeParseJson', async () => {
      mockFetch(fetchMock, validUser)

      const response = (await ky.post('https://api.example.com/user', {
        json: { name: 'new' },
      })) as AugmentedResponse

      expect(typeof response.parseJson).toBe('function')
      expect(typeof response.safeParseJson).toBe('function')

      const data = await response.parseJson(userSchema)
      expect(data).toEqual(validUser)
    })
  })

  describe('AugmentedResponsePromise (promise-level API)', () => {
    it('parseJson can be called directly on the promise (without awaiting first)', async () => {
      mockFetch(fetchMock, validUser)

      // ky.get() returns AugmentedResponsePromise which has parseJson on the promise itself
      const data = await ky.get('https://api.example.com/user').parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('safeParseJson can be called directly on the promise (without awaiting first)', async () => {
      mockFetch(fetchMock, validUser)

      const result = await ky.get('https://api.example.com/user').safeParseJson(userSchema)
      expect(result).toEqual({ success: true, data: validUser })
    })

    it('parseJson on promise throws ZodError for invalid data', async () => {
      mockFetch(fetchMock, invalidUserPayload)

      await expect(
        ky.get('https://api.example.com/user').parseJson(userSchema)
      ).rejects.toBeInstanceOf(ZodError)
    })

    it('safeParseJson on promise returns error for invalid data', async () => {
      mockFetch(fetchMock, invalidUserPayload)

      const result = await ky.get('https://api.example.com/user').safeParseJson(userSchema)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ZodError)
      }
    })

    it('parseJson works on promise from post()', async () => {
      mockFetch(fetchMock, validUser)

      const data = await ky
        .post('https://api.example.com/user', { json: { name: 'new' } })
        .parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('parseJson works on promise from extended instance', async () => {
      const extended = ky.extend({ prefixUrl: 'https://api.example.com' })
      mockFetch(fetchMock, validUser)

      const data = await extended.get('/user').parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('parseJson works on promise from chained extend()', async () => {
      const extended = ky
        .extend({ prefixUrl: 'https://api.example.com' })
        .extend({ timeout: 1000 })

      mockFetch(fetchMock, validUser)

      const data = await extended.get('/user').parseJson(userSchema)
      expect(data).toEqual(validUser)
    })

    it('parseJson works on promise from extend() with custom hooks', async () => {
      const hookCalls: string[] = []

      const extended = ky.extend({
        hooks: {
          afterResponse: [
            (_req, _opts, response) => {
              hookCalls.push('custom')
              return response
            },
          ],
        },
      })

      mockFetch(fetchMock, validUser)

      const data = await extended.get('https://api.example.com/user').parseJson(userSchema)
      expect(data).toEqual(validUser)
      expect(hookCalls).toContain('custom')
    })
  })

  describe('ResponsePromise methods are preserved', () => {
    it('.json() shortcut works on the promise (before await)', async () => {
      mockFetch(fetchMock, validUser)

      const data = await ky.get('https://api.example.com/user').json()
      expect(data).toEqual(validUser)
    })

    it('.text() shortcut works on the promise (before await)', async () => {
      mockFetch(fetchMock, validUser)

      const text = await ky.get('https://api.example.com/user').text()
      expect(text).toBe(JSON.stringify(validUser))
    })

    it('.json() and .parseJson() both work on the same promise reference', async () => {
      mockFetch(fetchMock, validUser)

      const promise = ky.get('https://api.example.com/user')

      expect(typeof promise.json).toBe('function')
      expect(typeof promise.text).toBe('function')
      expect(typeof promise.arrayBuffer).toBe('function')
      expect(typeof promise.blob).toBe('function')
      expect(typeof promise.formData).toBe('function')
      expect(typeof promise.parseJson).toBe('function')
      expect(typeof promise.safeParseJson).toBe('function')

      const data = await promise.json()
      expect(data).toEqual(validUser)
    })

    it('ResponsePromise methods survive extend()', async () => {
      const extended = ky.extend({ prefixUrl: 'https://api.example.com' })
      mockFetch(fetchMock, validUser)

      const promise = extended.get('/user')

      expect(typeof promise.json).toBe('function')
      expect(typeof promise.text).toBe('function')
      expect(typeof promise.parseJson).toBe('function')
      expect(typeof promise.safeParseJson).toBe('function')

      const data = await promise.json()
      expect(data).toEqual(validUser)
    })
  })
})
