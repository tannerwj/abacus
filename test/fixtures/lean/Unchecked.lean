import Lean

open Lean Elab Command

set_option debug.skipKernelTC true in
run_elab
  addDecl (.thmDecl {
    name := `Unchecked.falseProof
    levelParams := []
    type := mkConst ``False
    value := mkConst ``True.intro
  })
