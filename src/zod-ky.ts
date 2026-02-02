import { type KyInstance, type Options } from "ky";
import { ZodType } from "zod";

import libKy from "ky";
import "./zod-ky.types";
import { AugmentedKyInstance } from "./zod-ky.types";

const enhanceKy = (ky: KyInstance) => {
  return Object.assign(ky.extend({
    hooks: {
      afterResponse: [
        async (request, options, response) => {
          return Object.assign(response, {
            parseJson: <T>(schema: ZodType<T>) => response.json().then(schema.parse),
            safeParseJson: <T>(schema: ZodType<T>) =>
              response
                .json()
                .then(schema.safeParse)
                .then((result) =>
                  result.success
                    ? { success: true as const, data: result.data }
                    : { success: false as const, error: result.error }
                ),
          })
        }
      ]
    }
  }), {
    extend: (defaultOptions: Options | ((parentOptions: Options) => Options)) => enhanceKy(ky.extend(defaultOptions))
  }) as unknown as AugmentedKyInstance
}

export const ky = enhanceKy(libKy) as AugmentedKyInstance
