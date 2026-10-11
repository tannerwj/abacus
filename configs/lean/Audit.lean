import Lean

open Lean

namespace AbacusAudit

def tag (name : String) (items : Array Json) : Json :=
  .arr (#[.str name] ++ items)

def nameJson : Name → Json
  | .anonymous => tag "anonymous" #[]
  | .str parent value => tag "str" #[nameJson parent, .str value]
  | .num parent value => tag "num" #[nameJson parent, .str (toString value)]

partial def levelJson : Level → Json
  | .zero => tag "zero" #[]
  | .succ value => tag "succ" #[levelJson value]
  | .max left right => tag "max" #[levelJson left, levelJson right]
  | .imax left right => tag "imax" #[levelJson left, levelJson right]
  | .param name => tag "param" #[nameJson name]
  | .mvar _ => tag "invalid-universe-metavariable" #[]

partial def exprJson : Expr → Json
  | .bvar index => tag "bvar" #[.str (toString index)]
  | .fvar _ => tag "invalid-free-variable" #[]
  | .mvar _ => tag "invalid-metavariable" #[]
  | .sort level => tag "sort" #[levelJson level]
  | .const name levels => tag "const" #[nameJson name, .arr (levels.toArray.map levelJson)]
  | .app fn arg => tag "app" #[exprJson fn, exprJson arg]
  | .lam name type body info => tag "lam" #[nameJson name, exprJson type, exprJson body, .str (toString info.toUInt64)]
  | .forallE name type body info => tag "forall" #[nameJson name, exprJson type, exprJson body, .str (toString info.toUInt64)]
  | .letE name type value body nondep => tag "let" #[nameJson name, exprJson type, exprJson value, exprJson body, .bool nondep]
  | .lit (.natVal value) => tag "nat" #[.str (toString value)]
  | .lit (.strVal value) => tag "string" #[.str value]
  | .mdata _ value => exprJson value
  | .proj name index value => tag "proj" #[nameJson name, .str (toString index), exprJson value]

structure AuditState where
  visited : NameSet := {}
  axioms : NameSet := {}

partial def visit (env : Kernel.Environment) (name : Name) : StateT AuditState IO Unit := do
  if (← get).visited.contains name then return
  modify fun state => { state with visited := state.visited.insert name }
  let some info := env.find? name
    | throw <| IO.userError s!"Unknown transitive dependency: {name}"
  if info matches .axiomInfo _ then
    modify fun state => { state with axioms := state.axioms.insert name }
  for dependency in info.type.getUsedConstants do
    visit env dependency
  match info with
  | .thmInfo value => value.value.getUsedConstants.forM (visit env)
  | .defnInfo value => value.value.getUsedConstants.forM (visit env)
  | .opaqueInfo value => value.value.getUsedConstants.forM (visit env)
  | .inductInfo value => value.ctors.forM (visit env)
  | _ => pure ()

def audit (moduleName theoremName : String) : IO Json := do
  let moduleId := moduleName.toName
  let target := theoremName.toName
  let env ← importModules #[{ module := moduleId }] {} 0
  let kernel := env.toKernelEnv
  let some (.thmInfo declaration) := kernel.find? target
    | throw <| IO.userError s!"Required theorem not found: {theoremName}"
  let some moduleIndex := env.getModuleIdxFor? target
    | throw <| IO.userError s!"Required theorem has no source module: {theoremName}"
  unless env.header.moduleNames[moduleIndex]! == moduleId do
    throw <| IO.userError s!"Theorem does not belong to required module: {theoremName}"
  if declaration.type.hasMVar || declaration.type.hasFVar || declaration.type.hasLevelMVar then
    throw <| IO.userError "Invalid theorem type"
  let (_, state) ← (visit kernel target).run {}
  let axioms := state.axioms.toArray.qsort Name.lt
  return Json.mkObj [
    ("module", .str moduleName),
    ("name", .str theoremName),
    ("type", .arr #[.arr (declaration.levelParams.toArray.map nameJson), exprJson declaration.type]),
    ("axioms", .arr (axioms.map fun name => .str name.toString))
  ]

end AbacusAudit

def main (args : List String) : IO UInt32 := do
  let [buildPath, moduleName, theoremName] := args
    | throw <| IO.userError "Expected build path, module, and theorem"
  initSearchPath (← findSysroot) [buildPath]
  IO.println (← AbacusAudit.audit moduleName theoremName).compress
  return 0
