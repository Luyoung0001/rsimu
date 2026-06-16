import { describe, expect, it } from 'vitest'
import { assemble, createMachine, stepProgram } from '../sim/riscv'
import { compileMiniC } from './miniC'

const DEMO_C = `int main() {
  int data[4] = {3, 5, 7, 9};
  int sum = 0;

  for (int i = 0; i < 4; i++) {
    sum += data[i];
  }

  return sum;
}`

describe('mini-C compiler', () => {
  it('compiles the demo sum loop into runnable RV32I assembly', () => {
    const compiled = compileMiniC(DEMO_C)
    expect(compiled.errors).toEqual([])
    expect(compiled.assembly).toContain('lw   t3, 0(t0)')
    expect(compiled.assembly).toContain('sum_result:')

    const assembled = assemble(compiled.assembly!)
    expect(assembled.errors).toEqual([])
    expect(assembled.program).not.toBeNull()

    let machine = createMachine(assembled.program!)
    let guard = 0
    while (!machine.halted && guard < 64) {
      machine = stepProgram(assembled.program!, machine).state
      guard += 1
    }

    expect(machine.halted).toBe(true)
    expect(machine.registers[10]).toBe(24)
  })

  it('reports unsupported loop forms clearly', () => {
    const compiled = compileMiniC(`int main() {
  int data[2] = {1, 2};
  int sum = 0;
  while (1) {
    sum += data[0];
  }
  return sum;
}`)

    expect(compiled.assembly).toBeNull()
    expect(compiled.errors[0]?.message).toContain('Expected loop form')
  })
})
