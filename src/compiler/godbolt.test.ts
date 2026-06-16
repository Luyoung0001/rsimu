import { afterEach, describe, expect, it, vi } from 'vitest'
import { assemble, createMachine, stepProgram } from '../sim/riscv'
import { GODBOLT_RISCV32_CLANG, compileWithGodbolt } from './godbolt'

describe('Godbolt client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts to the rv32 clang compiler and joins asm lines', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        asm: [{ text: 'main:' }, { text: '        li      a0, 0' }, { text: '        ret' }],
        stderr: [],
        stdout: [],
      }),
    } as Response)

    const result = await compileWithGodbolt('int main(){return 0;}')

    expect(fetchMock).toHaveBeenCalledWith(
      `https://godbolt.org/api/compiler/${GODBOLT_RISCV32_CLANG}/compile`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.errors).toEqual([])
    expect(result.assembly).toBe('.text\nmain:\n        li      a0, 0\n        ret')
  })

  it('returns diagnostics when clang fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        asm: [],
        stderr: [{ text: 'example.c:3:2: error: expected expression' }],
        stdout: [],
      }),
    } as Response)

    const result = await compileWithGodbolt('int main(){')

    expect(result.assembly).toBeNull()
    expect(result.errors).toEqual([{ lineNumber: 3, message: 'example.c:3:2: error: expected expression' }])
  })

  it('keeps clang rodata local labels for string literals', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        asm: [
          { text: 'main:' },
          { text: '        lui     a0, %hi(.L.str)' },
          { text: '        addi    a0, a0, %lo(.L.str)' },
          { text: '        call    printf' },
          { text: '        ret' },
          { text: '        .section        .rodata.str1.1,"aMS",@progbits,1' },
          { text: '.L.str:' },
          { text: '        .asciz  "hello"' },
        ],
        stderr: [],
        stdout: [],
      }),
    } as Response)

    const result = await compileWithGodbolt('#include <stdio.h>\nint main(){printf("hello");return 0;}')

    expect(result.errors).toEqual([])
    expect(result.assembly).toContain('        la      a0, .L.str')
    expect(result.assembly).toContain('printf:')
    expect(result.assembly).toContain('.data\n.L.str:\n        .asciz  "hello"')
    expect(assemble(result.assembly ?? '').errors).toEqual([])
  })

  it('adds a small UART printf runtime for common format specifiers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        asm: [
          { text: 'main:' },
          { text: '        addi    sp, sp, -16' },
          { text: '        sw      ra, 12(sp)' },
          { text: '        la      a0, .L.fmt' },
          { text: '        li      a1, -42' },
          { text: '        li      a2, 42' },
          { text: '        la      a3, .L.text' },
          { text: '        li      a4, 65' },
          { text: '        call    printf' },
          { text: '        li      a0, 0' },
          { text: '        lw      ra, 12(sp)' },
          { text: '        addi    sp, sp, 16' },
          { text: '        ret' },
          { text: '        .section        .rodata.str1.1,"aMS",@progbits,1' },
          { text: '.L.fmt:' },
          { text: '        .asciz  "%d %x %s %c %%!"' },
          { text: '.L.text:' },
          { text: '        .asciz  "ok"' },
        ],
        stderr: [],
        stdout: [],
      }),
    } as Response)

    const result = await compileWithGodbolt('#include <stdio.h>\nint main(){return 0;}')
    const assembled = assemble(result.assembly ?? '')

    expect(assembled.errors).toEqual([])
    expect(assembled.program).not.toBeNull()

    let machine = createMachine(assembled.program!)
    for (let guard = 0; !machine.halted && guard < 2000; guard += 1) {
      machine = stepProgram(assembled.program!, machine).state
    }

    expect(machine.halted).toBe(true)
    expect(machine.output).toBe('-42 2a ok A %!')
  })
})
