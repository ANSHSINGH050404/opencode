import path from "node:path"
import { expect } from "bun:test"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { Plugin } from "@opencode/plugin/effect"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live(
  "skill reads wait for plugin activation instead of reporting an empty registry",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-skill-endpoints-")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const context = yield* Layer.build(
        createRoutes({
          password: "secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false },
          config: { directory: tmp.path, project: false, content: "{}" },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const sdk = Context.get(context, SdkPlugins.Service)
      yield* sdk.register(
        Plugin.define({
          id: "slow-skill-plugin",
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              yield* ctx.skill.transform((editor) =>
                editor.add({
                  id: Skill.ID.make("released"),
                  name: Skill.Name.make("released"),
                  description: "Registered once activation settles",
                  path: AbsolutePath.make(path.join(tmp.path, "SKILL.md")),
                  content: "# released",
                }),
              )
            }),
        }),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const request = (route: string) =>
        Effect.promise((signal) => {
          const url = new URL(route, "http://opencode.local")
          url.searchParams.set("location[directory]", tmp.path)
          return handler(
            new Request(url, {
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              signal,
            }),
          )
        })
      let settled = false
      const pending = yield* request("/api/skill").pipe(
        Effect.onExit(() => Effect.sync(() => (settled = true))),
        Effect.forkScoped,
      )
      // SDK plugins activate before config plugins, so this read starts on a cold location whose
      // registry is still empty and stays that way until the plugin above is released.
      yield* Deferred.await(started)
      yield* Effect.sleep("1 second")
      expect(settled).toBe(false)
      yield* Deferred.succeed(release, undefined)
      const response = yield* Fiber.join(pending)
      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        location: { directory: tmp.path },
        data: expect.arrayContaining([expect.objectContaining({ id: "released" })]),
      })
    }),
  15_000,
)
