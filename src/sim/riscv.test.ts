import { describe, expect, it } from 'vitest'
import { DATA_BASE, STACK_TOP, UART_TX_ADDR, assemble, createMachine, stepProgram } from './riscv'

function mustAssemble(source: string) {
  const result = assemble(source)
  expect(result.errors).toEqual([])
  expect(result.program).not.toBeNull()
  return result.program!
}

describe('riscv teaching simulator', () => {
  it('assembles labels and initializes .data words', () => {
    const program = mustAssemble(`
.text
main:
  la t0, value
  halt

.data
value:
  .word 0x12345678
`)

    expect(program.labels.main).toBe(0)
    expect(program.labels.value).toBe(DATA_BASE)
    expect([...program.memory.slice(DATA_BASE, DATA_BASE + 4)]).toEqual([0x78, 0x56, 0x34, 0x12])
  })

  it('assembles common clang data directives', () => {
    const program = mustAssemble(`
.data
bytes:
  .byte 1, 2
halves:
  .half 0x3456
text:
  .string "hi"
ztext:
  .asciz "ok"
gap:
  .zero 2
`)

    expect([...program.memory.slice(DATA_BASE, DATA_BASE + 12)]).toEqual([1, 2, 0x56, 0x34, 104, 105, 111, 107, 0, 0, 0, 0])
  })

  it('executes one instruction and reports register trace', () => {
    const program = mustAssemble(`
.text
  li a0, 41
  addi a0, a0, 1
  halt
`)
    const initial = createMachine(program)
    const first = stepProgram(program, initial)
    const second = stepProgram(program, first.state)

    expect(first.state.registers[10]).toBe(41)
    expect(first.trace.regWrites).toEqual([{ reg: 10, value: 41, ignored: false }])
    expect(second.state.registers[10]).toBe(42)
    expect(second.trace.regReads).toEqual([10])
    expect(second.trace.regWrites).toEqual([{ reg: 10, value: 42, ignored: false }])
  })

  it('reports load and store memory trace', () => {
    const program = mustAssemble(`
.text
  la t0, value
  lw t1, 0(t0)
  sw t1, result(zero)
  halt

.data
value:
  .word 7
result:
  .word 0
`)

    let machine = createMachine(program)
    machine = stepProgram(program, machine).state
    const load = stepProgram(program, machine)
    const store = stepProgram(program, load.state)

    expect(load.state.registers[6]).toBe(7)
    expect(load.trace.memReads).toContainEqual({ addr: DATA_BASE, size: 4, kind: 'load' })
    expect(store.trace.memWrites).toEqual([{ addr: DATA_BASE + 4, size: 4, value: 7, kind: 'store' }])
  })

  it('branches by label and marks branch decision', () => {
    const program = mustAssemble(`
.text
  li t0, 0
  li t1, 2
loop:
  addi t0, t0, 1
  blt t0, t1, loop
  halt
`)

    let machine = createMachine(program)
    machine = stepProgram(program, machine).state
    machine = stepProgram(program, machine).state
    machine = stepProgram(program, machine).state
    const branch = stepProgram(program, machine)

    expect(branch.trace.branchTaken).toBe(true)
    expect(branch.state.pc).toBe(program.labels.loop)
  })

  it('supports common clang branch pseudo-instructions', () => {
    const program = mustAssemble(`
.text
main:
  li t0, -1
  bgez t0, fail
  bltz t0, ok
fail:
  li a0, 0
  halt
ok:
  li t1, 3
  bgt t1, t0, done
  li a0, 1
  halt
done:
  li a0, 7
  halt
`)

    let machine = createMachine(program)
    for (let guard = 0; !machine.halted && guard < 20; guard += 1) {
      machine = stepProgram(program, machine).state
    }

    expect(machine.registers[10]).toBe(7)
  })

  it('starts at main and exposes UART MMIO stores as output', () => {
    const program = mustAssemble(`
.text
__putchar:
  sb a0, ${UART_TX_ADDR}(zero)
  ret

main:
  li a0, 65
  call __putchar
  ret
`)

    let machine = createMachine(program)
    expect(machine.pc).toBe(program.labels.main)
    expect(machine.registers[2]).toBe(STACK_TOP)

    machine = stepProgram(program, machine).state
    const call = stepProgram(program, machine)
    const uart = stepProgram(program, call.state)

    expect(call.trace.regWrites).toContainEqual({ reg: 1, value: program.labels.main + 8, ignored: false })
    expect(uart.trace.memWrites).toEqual([{ addr: UART_TX_ADDR, size: 1, value: 65, kind: 'store' }])
    expect(uart.state.output).toBe('A')
  })

  it('does not treat word stores near UART as character output', () => {
    const program = mustAssemble(`
.text
main:
  li a0, 0x41424344
  sw a0, ${UART_TX_ADDR}(zero)
  halt
`)

    const machine = createMachine(program)
    const first = stepProgram(program, machine)
    const second = stepProgram(program, first.state)

    expect(second.trace.memWrites).toEqual([{ addr: UART_TX_ADDR, size: 4, value: 0x41424344, kind: 'store' }])
    expect(second.state.output).toBe('')
  })
})
