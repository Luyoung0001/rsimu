import type { AssemblyIssue } from '../sim/riscv'

export const GODBOLT_RISCV32_CLANG = 'rv32-cclang'
export const UART_TX_ADDR = 0x7f0
export const GODBOLT_RISCV32_VM_FLAGS = [
  '-O0',
  '-S',
  '-march=rv32i',
  '-mabi=ilp32',
  '-ffreestanding',
  '-fno-builtin',
  '-nostdlib',
  '-nostdinc',
  '-I.',
  '-fno-unwind-tables',
  '-fno-asynchronous-unwind-tables',
  '-fno-stack-protector',
].join(' ')

const VM_STDIO_H = `int printf(const char *fmt, ...);
`

const VM_PRINTF_RUNTIME_ASM = `.text
printf:
  addi sp, sp, -48
  sw a1, 0(sp)
  sw a2, 4(sp)
  sw a3, 8(sp)
  sw a4, 12(sp)
  sw a5, 16(sp)
  sw a6, 20(sp)
  sw a7, 24(sp)
  sw ra, 28(sp)
  sw s0, 32(sp)
  sw s1, 36(sp)
  sw s2, 40(sp)
  mv s0, a0
  li s1, 0
  mv s2, sp
.Lrsimu_printf_loop:
  lbu t0, 0(s0)
  beqz t0, .Lrsimu_printf_done
  li t1, 37
  beq t0, t1, .Lrsimu_printf_percent
  mv a0, t0
  call __rsimu_putchar
  addi s0, s0, 1
  addi s1, s1, 1
  j .Lrsimu_printf_loop
.Lrsimu_printf_percent:
  addi s0, s0, 1
  lbu t0, 0(s0)
  beqz t0, .Lrsimu_printf_done
  li t1, 37
  beq t0, t1, .Lrsimu_printf_emit_percent
  li t1, 100
  beq t0, t1, .Lrsimu_printf_int
  li t1, 105
  beq t0, t1, .Lrsimu_printf_int
  li t1, 117
  beq t0, t1, .Lrsimu_printf_uint
  li t1, 120
  beq t0, t1, .Lrsimu_printf_hex
  li t1, 99
  beq t0, t1, .Lrsimu_printf_char
  li t1, 115
  beq t0, t1, .Lrsimu_printf_string
  li a0, 37
  call __rsimu_putchar
  lbu a0, 0(s0)
  call __rsimu_putchar
  addi s1, s1, 2
  j .Lrsimu_printf_advance
.Lrsimu_printf_emit_percent:
  li a0, 37
  call __rsimu_putchar
  addi s1, s1, 1
  j .Lrsimu_printf_advance
.Lrsimu_printf_int:
  lw a0, 0(s2)
  addi s2, s2, 4
  call __rsimu_putd
  add s1, s1, a0
  j .Lrsimu_printf_advance
.Lrsimu_printf_uint:
  lw a0, 0(s2)
  addi s2, s2, 4
  call __rsimu_putu10
  add s1, s1, a0
  j .Lrsimu_printf_advance
.Lrsimu_printf_hex:
  lw a0, 0(s2)
  addi s2, s2, 4
  call __rsimu_putx
  add s1, s1, a0
  j .Lrsimu_printf_advance
.Lrsimu_printf_char:
  lw a0, 0(s2)
  addi s2, s2, 4
  call __rsimu_putchar
  addi s1, s1, 1
  j .Lrsimu_printf_advance
.Lrsimu_printf_string:
  lw a0, 0(s2)
  addi s2, s2, 4
  call __rsimu_puts
  add s1, s1, a0
.Lrsimu_printf_advance:
  addi s0, s0, 1
  j .Lrsimu_printf_loop
.Lrsimu_printf_done:
  mv a0, s1
  lw ra, 28(sp)
  lw s0, 32(sp)
  lw s1, 36(sp)
  lw s2, 40(sp)
  addi sp, sp, 48
  ret

__rsimu_putchar:
  sb a0, ${UART_TX_ADDR}(zero)
  ret

__rsimu_puts:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  sw s1, 4(sp)
  bnez a0, .Lrsimu_puts_start
  la a0, .Lrsimu_null
.Lrsimu_puts_start:
  mv s0, a0
  li s1, 0
.Lrsimu_puts_loop:
  lbu a0, 0(s0)
  beqz a0, .Lrsimu_puts_done
  call __rsimu_putchar
  addi s0, s0, 1
  addi s1, s1, 1
  j .Lrsimu_puts_loop
.Lrsimu_puts_done:
  mv a0, s1
  lw ra, 12(sp)
  lw s0, 8(sp)
  lw s1, 4(sp)
  addi sp, sp, 16
  ret

__rsimu_putd:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  bgez a0, .Lrsimu_putd_positive
  mv s0, a0
  li a0, 45
  call __rsimu_putchar
  li a0, 0
  sub a0, a0, s0
  call __rsimu_putu10
  addi a0, a0, 1
  j .Lrsimu_putd_done
.Lrsimu_putd_positive:
  call __rsimu_putu10
.Lrsimu_putd_done:
  lw ra, 12(sp)
  lw s0, 8(sp)
  addi sp, sp, 16
  ret

__rsimu_putu10:
  addi sp, sp, -24
  sw ra, 20(sp)
  sw s0, 16(sp)
  sw s1, 12(sp)
  sw s2, 8(sp)
  mv s0, a0
  li s1, 0
  li s2, 0
  li a0, 1000000000
  call __rsimu_put_dec_digit
  li a0, 100000000
  call __rsimu_put_dec_digit
  li a0, 10000000
  call __rsimu_put_dec_digit
  li a0, 1000000
  call __rsimu_put_dec_digit
  li a0, 100000
  call __rsimu_put_dec_digit
  li a0, 10000
  call __rsimu_put_dec_digit
  li a0, 1000
  call __rsimu_put_dec_digit
  li a0, 100
  call __rsimu_put_dec_digit
  li a0, 10
  call __rsimu_put_dec_digit
  li a0, 1
  call __rsimu_put_dec_digit
  mv a0, s1
  lw ra, 20(sp)
  lw s0, 16(sp)
  lw s1, 12(sp)
  lw s2, 8(sp)
  addi sp, sp, 24
  ret

__rsimu_put_dec_digit:
  mv t1, a0
  li t0, 0
.Lrsimu_put_dec_loop:
  bltu s0, t1, .Lrsimu_put_dec_check
  sub s0, s0, t1
  addi t0, t0, 1
  j .Lrsimu_put_dec_loop
.Lrsimu_put_dec_check:
  bnez t0, .Lrsimu_put_dec_emit
  bnez s2, .Lrsimu_put_dec_emit
  li t2, 1
  beq t1, t2, .Lrsimu_put_dec_emit
  ret
.Lrsimu_put_dec_emit:
  addi a0, t0, 48
  sb a0, ${UART_TX_ADDR}(zero)
  addi s1, s1, 1
  li s2, 1
  ret

__rsimu_putx:
  addi sp, sp, -28
  sw ra, 24(sp)
  sw s0, 20(sp)
  sw s1, 16(sp)
  sw s2, 12(sp)
  sw s3, 8(sp)
  mv s0, a0
  li s1, 0
  li s2, 28
  li s3, 0
.Lrsimu_putx_loop:
  srl t0, s0, s2
  andi t0, t0, 15
  bnez t0, .Lrsimu_putx_emit
  bnez s3, .Lrsimu_putx_emit
  beqz s2, .Lrsimu_putx_emit
  j .Lrsimu_putx_next
.Lrsimu_putx_emit:
  li t1, 10
  bltu t0, t1, .Lrsimu_putx_digit
  addi a0, t0, 87
  j .Lrsimu_putx_write
.Lrsimu_putx_digit:
  addi a0, t0, 48
.Lrsimu_putx_write:
  sb a0, ${UART_TX_ADDR}(zero)
  addi s1, s1, 1
  li s3, 1
.Lrsimu_putx_next:
  addi s2, s2, -4
  bgez s2, .Lrsimu_putx_loop
  mv a0, s1
  lw ra, 24(sp)
  lw s0, 20(sp)
  lw s1, 16(sp)
  lw s2, 12(sp)
  lw s3, 8(sp)
  addi sp, sp, 28
  ret

.data
.Lrsimu_null:
  .asciz "(null)"`

export type GodboltCompileResult = {
  assembly: string | null
  errors: AssemblyIssue[]
}

type GodboltTextLine = {
  text?: string
}

type GodboltResponse = {
  code?: number
  asm?: GodboltTextLine[]
  stdout?: GodboltTextLine[]
  stderr?: GodboltTextLine[]
  timedOut?: boolean
  truncated?: boolean
}

export async function compileWithGodbolt(source: string): Promise<GodboltCompileResult> {
  try {
    const response = await fetch(`https://godbolt.org/api/compiler/${GODBOLT_RISCV32_CLANG}/compile`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source,
        options: {
          userArguments: GODBOLT_RISCV32_VM_FLAGS,
          compilerOptions: {
            skipAsm: false,
            executorRequest: false,
          },
          filters: {
            binary: false,
            binaryObject: false,
            commentOnly: true,
            directives: false,
            labels: true,
            trim: false,
            libraryCode: false,
            debugCalls: false,
          },
        },
        files: [{ filename: 'stdio.h', contents: VM_STDIO_H }],
      }),
    })

    if (!response.ok) {
      return {
        assembly: null,
        errors: [{ lineNumber: 0, message: `Godbolt compile request failed: HTTP ${response.status}.` }],
      }
    }

    const payload = (await response.json()) as GodboltResponse
    const diagnostics = [...linesToMessages(payload.stderr), ...linesToMessages(payload.stdout)]

    if (payload.timedOut) {
      diagnostics.push({ lineNumber: 0, message: 'Godbolt compile request timed out.' })
    }
    if (payload.truncated) {
      diagnostics.push({ lineNumber: 0, message: 'Godbolt response was truncated.' })
    }

    const assembly = addRuntimeAssembly(normalizeAssembly(payload.asm?.map((line) => line.text ?? '').join('\n') ?? ''))
    if ((payload.code ?? 1) !== 0) {
      return {
        assembly: assembly || null,
        errors: diagnostics.length > 0 ? diagnostics : [{ lineNumber: 0, message: 'Clang failed without diagnostics.' }],
      }
    }

    return {
      assembly,
      errors: diagnostics,
    }
  } catch (error) {
    return {
      assembly: null,
      errors: [
        {
          lineNumber: 0,
          message: error instanceof Error ? `Godbolt compile request failed: ${error.message}` : 'Godbolt compile request failed.',
        },
      ],
    }
  }
}

function normalizeAssembly(assembly: string): string {
  if (assembly.trim().length === 0) {
    return ''
  }

  const lines = assembly.split(/\r?\n/)
  const output: string[] = []
  let inData = false
  let skippingSection = false

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const trimmed = rawLine.trim()

    if (trimmed.length === 0) {
      continue
    }
    if (trimmed.startsWith('.section') && trimmed.includes('.rodata')) {
      skippingSection = false
      if (!inData) {
        output.push('.data')
        inData = true
      }
      continue
    }
    if (trimmed.startsWith('.section') && trimmed.includes('.debug_')) {
      skippingSection = true
      continue
    }
    if (shouldDropLine(trimmed)) {
      continue
    }
    if (trimmed === '.text') {
      skippingSection = false
      output.push('.text')
      inData = false
      continue
    }
    if (trimmed === '.data') {
      skippingSection = false
      output.push('.data')
      inData = true
      continue
    }
    if (skippingSection) {
      continue
    }
    if (trimmed.startsWith('.') && !isLocalLabel(trimmed) && !isSupportedDataDirective(trimmed)) {
      continue
    }

    const luiMatch = trimmed.match(/^lui\s+(\w+),\s*%hi\(([^)]+)\)$/)
    const nextTrimmed = lines[index + 1]?.trim() ?? ''
    const addiMatch = nextTrimmed.match(/^addi\s+(\w+),\s+\1,\s*%lo\(([^)]+)\)$/)
    if (luiMatch && addiMatch && luiMatch[2] === addiMatch[2]) {
      output.push(`        la      ${luiMatch[1]}, ${luiMatch[2]}`)
      index += 1
      continue
    }

    output.push(rawLine)
  }

  if (!output.some((line) => line.trim() === '.text')) {
    output.unshift('.text')
  }

  return output.join('\n').trimEnd()
}

function addRuntimeAssembly(assembly: string): string {
  if (!/\bcall\s+printf\b/.test(assembly)) {
    return assembly
  }

  const lines = assembly.split('\n')
  const dataIndex = lines.findIndex((line) => line.trim() === '.data')
  if (dataIndex < 0) {
    return `${assembly}\n${VM_PRINTF_RUNTIME_ASM}`
  }

  return [...lines.slice(0, dataIndex), VM_PRINTF_RUNTIME_ASM, ...lines.slice(dataIndex)].join('\n')
}

function shouldDropLine(trimmed: string): boolean {
  return (
    trimmed.startsWith('.attribute') ||
    trimmed.startsWith('.file') ||
    trimmed.startsWith('.loc') ||
    trimmed.startsWith('.cfi_') ||
    trimmed.startsWith('.globl') ||
    trimmed.startsWith('.p2align') ||
    trimmed.startsWith('.type') ||
    trimmed.startsWith('.size') ||
    trimmed.startsWith('.ident') ||
    trimmed.startsWith('.addrsig') ||
    trimmed.startsWith('.debug_') ||
    (trimmed.endsWith(':') && trimmed.startsWith('.Lfunc_'))
  )
}

function isLocalLabel(trimmed: string): boolean {
  return /^[A-Za-z_.$][\w.$]*:$/.test(trimmed)
}

function isSupportedDataDirective(trimmed: string): boolean {
  return (
    trimmed.startsWith('.byte') ||
    trimmed.startsWith('.half') ||
    trimmed.startsWith('.word') ||
    trimmed.startsWith('.zero') ||
    trimmed.startsWith('.string') ||
    trimmed.startsWith('.asciz')
  )
}

function linesToMessages(lines: GodboltTextLine[] | undefined): AssemblyIssue[] {
  return (lines ?? [])
    .map((line) => line.text?.trim() ?? '')
    .filter(Boolean)
    .map((message) => ({
      lineNumber: extractLineNumber(message),
      message,
    }))
}

function extractLineNumber(message: string): number {
  const match = message.match(/<source>:(\d+):\d+:/) ?? message.match(/example\.c:(\d+):\d+:/)
  return match ? Number(match[1]) : 0
}
