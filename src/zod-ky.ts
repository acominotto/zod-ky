import { type KyInstance, type Options, type ResponsePromise } from "ky";
import { ZodType } from "zod";

import libKy from "ky";
import "./zod-ky.types";
import { AugmentedResponse, type AugmentedKyInstance, type AugmentedResponsePromise } from "./zod-ky.types";

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const

/**
 * Wraps a ky ResponsePromise so that parseJson/safeParseJson are available
 * both on the promise itself (before await) and on the resolved response,
 * while preserving the original ResponsePromise shortcut methods (.json(), .text(), etc.).
 */
function augmentPromise<T>(promise: ResponsePromise<T>): AugmentedResponsePromise<T> {
  // .then() returns a plain Promise, losing ResponsePromise methods.
  // We chain .then() for the resolved value, then copy everything back.
  const chained = promise.then((res) => {
    const response = res as AugmentedResponse<T>
    response.parseJson = <U>(schema: ZodType<U>): Promise<U> => response.json().then(schema.parse)
    response.safeParseJson = <U>(schema: ZodType<U>) =>
      response
        .json()
        .then(schema.safeParse)
        .then((result) =>
          result.success
            ? { success: true as const, data: result.data }
            : { success: false as const, error: result.error }
        )
    return response
  }) as unknown as AugmentedResponsePromise<T>

  // Preserve original ResponsePromise shortcut methods (.json, .text, .blob, etc.)
  chained.json = <J = T>() => promise.json<J>()
  chained.text = () => promise.text()
  chained.arrayBuffer = () => promise.arrayBuffer()
  chained.blob = () => promise.blob()
  chained.formData = () => promise.formData()
  if ('bytes' in promise) {
    (chained as any).bytes = () => promise.bytes()
  }

  // Add parseJson/safeParseJson on the promise itself (before await)
  chained.parseJson = <U>(schema: ZodType<U>): Promise<U> =>
    chained.then((res: any) => res.parseJson(schema))
  chained.safeParseJson = <U>(schema: ZodType<U>) =>
    chained.then((res: any) => res.safeParseJson(schema))

  return chained
}

const enhanceKy = (ky: KyInstance): AugmentedKyInstance => {
  const enhanced = {} as Record<string, unknown>

  // Wrap each HTTP method to return an AugmentedResponsePromise
  for (const method of HTTP_METHODS) {
    enhanced[method] = (url: string | URL, options?: Options) =>
      augmentPromise((ky as any)[method](url, options))
  }

  enhanced.extend = (defaultOptions: Options | ((parentOptions: Options) => Options)) =>
    enhanceKy(ky.extend(defaultOptions))
  enhanced.create = (options: Options) =>
    enhanceKy(libKy.create(options))

  // Copy over non-method properties (stop, retry, etc.)
  for (const key of Object.keys(ky)) {
    if (!(key in enhanced)) {
      enhanced[key] = (ky as unknown as Record<string, unknown>)[key]
    }
  }

  return enhanced as unknown as AugmentedKyInstance
}

export const ky = enhanceKy(libKy)
