namespace ClassicalFixture

theorem doubleNegation (p : Prop) (h : ¬¬p) : p := by
  exact Classical.byContradiction h

end ClassicalFixture
