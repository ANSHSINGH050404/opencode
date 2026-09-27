import { Skill } from "@opencode/core/skill"
import { Plugin } from "@opencode/core/plugin"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle(
    "skill.list",
    Effect.fn(function* () {
      yield* Plugin.awaitActivation
      const skill = yield* Skill.Service
      return yield* response(skill.list())
    }),
  ),
)
