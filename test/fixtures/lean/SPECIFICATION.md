# Reviewed Lean runner fixture contract

For every natural number n, adding zero leaves n unchanged. `Good.addZero`
formalizes this identity over Lean's standard `Nat` type. This is a formal
model fixture, not a claim about a TypeScript implementation.

Negative fixtures deliberately contain a transitive incomplete proof, a custom
axiom, a native-evaluation assumption, and an invalid proof respectively.
They exercise rejection, not accepted alternate foundations.
