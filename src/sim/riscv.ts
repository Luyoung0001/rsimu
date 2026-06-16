export const MEMORY_SIZE = 2048
export const TEXT_BASE = 0
export const DATA_BASE = 0x600
export const UART_TX_ADDR = 0x7f0
export const STACK_TOP = UART_TX_ADDR

export const ABI_REGISTER_NAMES = [
  'zero',
  'ra',
  'sp',
  'gp',
  'tp',
  't0',
  't1',
  't2',
  's0',
  's1',
  'a0',
  'a1',
  'a2',
  'a3',
  'a4',
  'a5',
  'a6',
  'a7',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
  's11',
  't3',
  't4',
  't5',
  't6',
] as const

export type MemoryReadKind = 'fetch' | 'load'
export type MemoryWriteKind = 'store'
export type AccessSize = 1 | 2 | 4

export type MemoryRead = {
  addr: number
  size: AccessSize
  kind: MemoryReadKind
}

export type MemoryWrite = {
  addr: number
  size: AccessSize
  value: number
  kind: MemoryWriteKind
}

export type RegisterWrite = {
  reg: number
  value: number
  ignored?: boolean
}

export type StepTrace = {
  pcBefore: number
  pcAfter: number
  instrText: string
  regReads: number[]
  regWrites: RegisterWrite[]
  memReads: MemoryRead[]
  memWrites: MemoryWrite[]
  branchTaken?: boolean
  sourceLine?: number
  halted?: boolean
  trap?: string
}

export type Instruction = {
  address: number
  op: string
  args: string[]
  source: string
  lineNumber: number
}

export type Program = {
  instructions: Instruction[]
  labels: Record<string, number>
  memory: Uint8Array
  addressToIndex: Map<number, number>
}

export type AssemblyIssue = {
  lineNumber: number
  message: string
}

export type AssemblyResult = {
  program: Program | null
  errors: AssemblyIssue[]
}

export type MachineState = {
  pc: number
  registers: Int32Array
  memory: Uint8Array
  halted: boolean
  stepCount: number
  output: string
  trap?: string
}

type Section = 'text' | 'data'

type TextRecord = {
  address: number
  lineNumber: number
  source: string
}

type DataRecord = {
  address: number
  lineNumber: number
} & (
  | {
      kind: 'values'
      itemSize: 1 | 2 | 4
      values: string[]
    }
  | {
      kind: 'bytes'
      bytes: number[]
    }
)

const SUPPORTED_OPS = new Set([
  'add',
  'sub',
  'and',
  'or',
  'xor',
  'sll',
  'srl',
  'sra',
  'slt',
  'sltu',
  'addi',
  'andi',
  'ori',
  'xori',
  'slti',
  'sltiu',
  'slli',
  'srli',
  'srai',
  'lw',
  'lh',
  'lhu',
  'lb',
  'lbu',
  'sw',
  'sh',
  'sb',
  'beq',
  'bne',
  'blt',
  'bge',
  'bltu',
  'bgeu',
  'beqz',
  'bnez',
  'bltz',
  'bgez',
  'bgtz',
  'blez',
  'bgt',
  'ble',
  'bgtu',
  'bleu',
  'lui',
  'auipc',
  'jal',
  'jalr',
  'call',
  'j',
  'ret',
  'li',
  'la',
  'mv',
  'nop',
  'halt',
  'ecall',
])

const REGISTER_ALIASES: Record<string, number> = {
  zero: 0,
  ra: 1,
  sp: 2,
  gp: 3,
  tp: 4,
  t0: 5,
  t1: 6,
  t2: 7,
  s0: 8,
  fp: 8,
  s1: 9,
  a0: 10,
  a1: 11,
  a2: 12,
  a3: 13,
  a4: 14,
  a5: 15,
  a6: 16,
  a7: 17,
  s2: 18,
  s3: 19,
  s4: 20,
  s5: 21,
  s6: 22,
  s7: 23,
  s8: 24,
  s9: 25,
  s10: 26,
  s11: 27,
  t3: 28,
  t4: 29,
  t5: 30,
  t6: 31,
}

for (let index = 0; index < 32; index += 1) {
  REGISTER_ALIASES[`x${index}`] = index
}

export function assemble(source: string): AssemblyResult {
  const labels: Record<string, number> = {}
  const errors: AssemblyIssue[] = []
  const textRecords: TextRecord[] = []
  const dataRecords: DataRecord[] = []
  let section: Section = 'text'
  let pc = TEXT_BASE
  let dataCursor = DATA_BASE

  source.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const lineNumber = lineIndex + 1
    let line = stripComment(rawLine).trim()

    while (line.length > 0) {
      const labelMatch = line.match(/^([A-Za-z_.$][\w.$]*):\s*/)
      if (!labelMatch) {
        break
      }

      const label = labelMatch[1]
      if (labels[label] !== undefined) {
        errors.push({ lineNumber, message: `Duplicate label "${label}".` })
      } else {
        labels[label] = section === 'text' ? pc : dataCursor
      }
      line = line.slice(labelMatch[0].length).trim()
    }

    if (line.length === 0) {
      return
    }

    if (line.startsWith('.')) {
      const [directive = '', ...restParts] = line.split(/\s+/)
      const rest = line.slice(directive.length).trim()

      if (directive === '.text') {
        section = 'text'
        return
      }
      if (directive === '.data') {
        section = 'data'
        return
      }
      if (directive === '.byte' || directive === '.half' || directive === '.word') {
        if (section !== 'data') {
          errors.push({ lineNumber, message: `${directive} is only supported in .data.` })
          return
        }

        const values = splitValues(rest)
        if (values.length === 0) {
          errors.push({ lineNumber, message: `${directive} needs at least one value.` })
          return
        }

        const itemSize = directive === '.byte' ? 1 : directive === '.half' ? 2 : 4
        if (dataCursor + values.length * itemSize > MEMORY_SIZE) {
          errors.push({ lineNumber, message: 'Data segment exceeds 2KB memory.' })
          return
        }

        dataRecords.push({ address: dataCursor, lineNumber, kind: 'values', itemSize, values })
        dataCursor += values.length * itemSize
        return
      }
      if (directive === '.zero') {
        if (section !== 'data') {
          errors.push({ lineNumber, message: '.zero is only supported in .data.' })
          return
        }

        const size = resolveImmediate(rest, labels, lineNumber, errors)
        if (size === null) {
          return
        }
        if (size < 0 || dataCursor + size > MEMORY_SIZE) {
          errors.push({ lineNumber, message: 'Data segment exceeds 2KB memory.' })
          return
        }

        dataRecords.push({ address: dataCursor, lineNumber, kind: 'bytes', bytes: new Array(size).fill(0) })
        dataCursor += size
        return
      }
      if (directive === '.asciz' || directive === '.string') {
        if (section !== 'data') {
          errors.push({ lineNumber, message: `${directive} is only supported in .data.` })
          return
        }

        const bytes = parseStringBytes(rest, lineNumber, errors, directive === '.asciz')
        if (!bytes) {
          return
        }
        if (dataCursor + bytes.length > MEMORY_SIZE) {
          errors.push({ lineNumber, message: 'Data segment exceeds 2KB memory.' })
          return
        }

        dataRecords.push({ address: dataCursor, lineNumber, kind: 'bytes', bytes })
        dataCursor += bytes.length
        return
      }

      errors.push({
        lineNumber,
        message: `Unsupported directive "${directive}${restParts.length > 0 ? ' ...' : ''}".`,
      })
      return
    }

    if (section !== 'text') {
      errors.push({ lineNumber, message: 'Instructions must be placed in .text.' })
      return
    }

    const [op = ''] = tokenizeInstruction(line)
    if (!SUPPORTED_OPS.has(op.toLowerCase())) {
      errors.push({ lineNumber, message: `Unsupported instruction "${op}".` })
      return
    }

    if (pc + 4 > DATA_BASE) {
      errors.push({ lineNumber, message: 'Text segment overlaps the .data area.' })
      return
    }

    textRecords.push({ address: pc, lineNumber, source: line })
    pc += 4
  })

  const memory = new Uint8Array(MEMORY_SIZE)
  for (const record of dataRecords) {
    if (record.kind === 'values') {
      record.values.forEach((token, index) => {
        const value = resolveImmediate(token, labels, record.lineNumber, errors)
        if (value !== null) {
          writeScalar(memory, record.address + index * record.itemSize, record.itemSize, value)
        }
      })
    } else {
      memory.set(record.bytes, record.address)
    }
  }

  const instructions = textRecords.map((record) => {
    const [op = '', ...args] = tokenizeInstruction(record.source)
    return {
      address: record.address,
      op: op.toLowerCase(),
      args,
      source: record.source,
      lineNumber: record.lineNumber,
    }
  })

  instructions.forEach((instruction) => {
    validateInstruction(instruction, errors)
  })

  if (errors.length > 0) {
    return { program: null, errors }
  }

  return {
    program: {
      instructions,
      labels,
      memory,
      addressToIndex: new Map(instructions.map((instruction, index) => [instruction.address, index])),
    },
    errors: [],
  }
}

export function createMachine(program: Program): MachineState {
  const registers = new Int32Array(32)
  registers[2] = STACK_TOP
  registers[1] = (program.instructions.at(-1)?.address ?? TEXT_BASE) + 4

  return {
    pc: program.labels.main ?? program.instructions[0]?.address ?? TEXT_BASE,
    registers,
    memory: new Uint8Array(program.memory),
    halted: program.instructions.length === 0,
    stepCount: 0,
    output: '',
  }
}

export function stepProgram(program: Program, state: MachineState): {
  state: MachineState
  trace: StepTrace
} {
  if (state.halted) {
    const trace = makeTrace(state.pc, state.pc, 'halted', undefined)
    trace.halted = true
    trace.trap = state.trap
    return { state, trace }
  }

  const instructionIndex = program.addressToIndex.get(state.pc)
  if (instructionIndex === undefined) {
    const trap = `No instruction at PC ${formatHex(state.pc, 3)}.`
    const trace = makeTrace(state.pc, state.pc, 'trap', undefined)
    trace.trap = trap
    return {
      state: { ...state, halted: true, trap },
      trace,
    }
  }

  const instruction = program.instructions[instructionIndex]
  const registers = new Int32Array(state.registers)
  const memory = new Uint8Array(state.memory)
  const trace = makeTrace(state.pc, state.pc + 4, instruction.source, instruction.lineNumber)
  const regReads = new Set<number>()

  const readReg = (reg: number): number => {
    regReads.add(reg)
    return reg === 0 ? 0 : registers[reg] | 0
  }

  const writeReg = (reg: number, value: number) => {
    const nextValue = value | 0
    trace.regWrites.push({ reg, value: nextValue, ignored: reg === 0 })
    if (reg !== 0) {
      registers[reg] = nextValue
    }
  }

  let nextPc = state.pc + 4
  let halted = false
  let trap: string | undefined

  try {
    const { op, args } = instruction

    if (isRType(op)) {
      requireArgCount(instruction, 3)
      const rd = parseRegister(args[0])
      const rs1 = parseRegister(args[1])
      const rs2 = parseRegister(args[2])
      const left = readReg(rs1)
      const right = readReg(rs2)
      writeReg(rd, executeRType(op, left, right))
    } else if (isIType(op)) {
      requireArgCount(instruction, 3)
      const rd = parseRegister(args[0])
      const rs1 = parseRegister(args[1])
      const immediate = mustResolveImmediate(args[2], program.labels)
      const left = readReg(rs1)
      writeReg(rd, executeIType(op, left, immediate))
    } else if (isShiftIType(op)) {
      requireArgCount(instruction, 3)
      const rd = parseRegister(args[0])
      const rs1 = parseRegister(args[1])
      const shift = mustResolveImmediate(args[2], program.labels) & 31
      const value = readReg(rs1)
      writeReg(rd, executeShiftIType(op, value, shift))
    } else if (isLoad(op)) {
      requireArgCount(instruction, 2)
      const rd = parseRegister(args[0])
      const operand = parseMemoryOperand(args[1], program.labels)
      const base = readReg(operand.baseReg)
      const addr = (base + operand.offset) | 0
      writeReg(rd, readMemory(memory, addr, loadSize(op), op !== 'lbu' && op !== 'lhu', trace))
    } else if (isStore(op)) {
      requireArgCount(instruction, 2)
      const rs2 = parseRegister(args[0])
      const operand = parseMemoryOperand(args[1], program.labels)
      const base = readReg(operand.baseReg)
      const value = readReg(rs2)
      writeMemory(memory, (base + operand.offset) | 0, storeSize(op), value, trace)
    } else if (isBranch(op)) {
      requireArgCount(instruction, 3)
      const rs1 = parseRegister(args[0])
      const rs2 = parseRegister(args[1])
      const left = readReg(rs1)
      const right = readReg(rs2)
      const taken = branchTaken(op, left, right)
      trace.branchTaken = taken
      if (taken) {
        nextPc = mustResolveTarget(args[2], program.labels)
      }
    } else if (isZeroBranch(op)) {
      requireArgCount(instruction, 2)
      const value = readReg(parseRegister(args[0]))
      const taken = zeroBranchTaken(op, value)
      trace.branchTaken = taken
      if (taken) {
        nextPc = mustResolveTarget(args[1], program.labels)
      }
    } else if (op === 'lui') {
      requireArgCount(instruction, 2)
      writeReg(parseRegister(args[0]), mustResolveImmediate(args[1], program.labels) << 12)
    } else if (op === 'auipc') {
      requireArgCount(instruction, 2)
      writeReg(parseRegister(args[0]), state.pc + (mustResolveImmediate(args[1], program.labels) << 12))
    } else if (op === 'jal') {
      if (args.length === 1) {
        writeReg(1, state.pc + 4)
        nextPc = mustResolveTarget(args[0], program.labels)
      } else {
        requireArgCount(instruction, 2)
        writeReg(parseRegister(args[0]), state.pc + 4)
        nextPc = mustResolveTarget(args[1], program.labels)
      }
    } else if (op === 'call') {
      requireArgCount(instruction, 1)
      writeReg(1, state.pc + 4)
      nextPc = mustResolveTarget(args[0], program.labels)
    } else if (op === 'jalr') {
      requireArgCount(instruction, 2)
      const rd = parseRegister(args[0])
      const operand = parseMemoryOperand(args[1], program.labels)
      const base = readReg(operand.baseReg)
      writeReg(rd, state.pc + 4)
      nextPc = (base + operand.offset) & ~1
    } else if (op === 'j') {
      requireArgCount(instruction, 1)
      nextPc = mustResolveTarget(args[0], program.labels)
    } else if (op === 'ret') {
      requireArgCount(instruction, 0)
      nextPc = readReg(1)
    } else if (op === 'li') {
      requireArgCount(instruction, 2)
      writeReg(parseRegister(args[0]), mustResolveImmediate(args[1], program.labels))
    } else if (op === 'la') {
      requireArgCount(instruction, 2)
      writeReg(parseRegister(args[0]), mustResolveImmediate(args[1], program.labels))
    } else if (op === 'mv') {
      requireArgCount(instruction, 2)
      writeReg(parseRegister(args[0]), readReg(parseRegister(args[1])))
    } else if (op === 'nop') {
      requireArgCount(instruction, 0)
    } else if (op === 'halt' || op === 'ecall') {
      requireArgCount(instruction, 0)
      halted = true
      trace.halted = true
    }
  } catch (error) {
    trap = error instanceof Error ? error.message : 'Execution trap.'
    halted = true
    trace.trap = trap
  }

  registers[0] = 0
  trace.regReads = Array.from(regReads)
  trace.pcAfter = nextPc

  if (!halted && !program.addressToIndex.has(nextPc)) {
    const endPc = program.instructions.at(-1)?.address ?? TEXT_BASE
    if (nextPc === endPc + 4) {
      halted = true
      trace.halted = true
    } else {
      trap = `PC ${formatHex(nextPc, 3)} does not point to an instruction.`
      halted = true
      trace.trap = trap
    }
  }

  return {
    state: {
      pc: nextPc,
      registers,
      memory,
      halted,
      stepCount: state.stepCount + 1,
      output: state.output + collectUartOutput(trace),
      trap,
    },
    trace,
  }
}

export function formatHex(value: number, width = 8): string {
  return `0x${(value >>> 0).toString(16).padStart(width, '0')}`
}

function stripComment(line: string): string {
  const hashIndex = line.indexOf('#')
  const slashIndex = line.indexOf('//')
  const indexes = [hashIndex, slashIndex].filter((index) => index >= 0)
  if (indexes.length === 0) {
    return line
  }
  return line.slice(0, Math.min(...indexes))
}

function splitValues(values: string): string[] {
  return values
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function parseStringBytes(value: string, lineNumber: number, errors: AssemblyIssue[], nulTerminated: boolean): number[] | null {
  const match = value.trim().match(/^"((?:\\.|[^"\\])*)"$/)
  if (!match) {
    errors.push({ lineNumber, message: 'Expected a quoted string for .asciz.' })
    return null
  }

  const bytes: number[] = []
  const text = match[1]
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0) & 0xff)
      continue
    }

    index += 1
    const escaped = text[index]
    if (escaped === 'n') {
      bytes.push(10)
    } else if (escaped === 'r') {
      bytes.push(13)
    } else if (escaped === 't') {
      bytes.push(9)
    } else if (escaped === '0') {
      bytes.push(0)
    } else if (escaped === '"' || escaped === '\\') {
      bytes.push(escaped.charCodeAt(0))
    } else {
      errors.push({ lineNumber, message: `Unsupported escape sequence "\\${escaped}".` })
      return null
    }
  }

  if (nulTerminated) {
    bytes.push(0)
  }
  return bytes
}

function tokenizeInstruction(line: string): string[] {
  return line
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function validateInstruction(instruction: Instruction, errors: AssemblyIssue[]) {
  try {
    const { op, args } = instruction
    if (isRType(op) || isIType(op) || isShiftIType(op) || isBranch(op)) {
      args.slice(0, op.startsWith('b') ? 2 : args.length - 1).forEach(parseRegister)
    } else if (isZeroBranch(op)) {
      parseRegister(args[0])
    } else if (isLoad(op) || isStore(op) || op === 'jalr') {
      parseRegister(args[0])
    } else if (op === 'lui' || op === 'auipc' || op === 'li' || op === 'la' || op === 'mv') {
      parseRegister(args[0])
    } else if (op === 'jal' && args.length === 2) {
      parseRegister(args[0])
    }
  } catch (error) {
    errors.push({
      lineNumber: instruction.lineNumber,
      message: error instanceof Error ? error.message : 'Invalid instruction.',
    })
  }
}

function parseRegister(token: string): number {
  const reg = REGISTER_ALIASES[token.toLowerCase()]
  if (reg === undefined) {
    throw new Error(`Unknown register "${token}".`)
  }
  return reg
}

function resolveImmediate(
  token: string,
  labels: Record<string, number>,
  lineNumber: number,
  errors: AssemblyIssue[],
): number | null {
  try {
    return mustResolveImmediate(token, labels)
  } catch (error) {
    errors.push({
      lineNumber,
      message: error instanceof Error ? error.message : `Invalid value "${token}".`,
    })
    return null
  }
}

function mustResolveImmediate(token: string, labels: Record<string, number>): number {
  const numeric = parseNumeric(token)
  if (numeric !== null) {
    return numeric
  }
  if (labels[token] !== undefined) {
    return labels[token]
  }
  throw new Error(`Unknown immediate or label "${token}".`)
}

function mustResolveTarget(token: string, labels: Record<string, number>): number {
  const target = mustResolveImmediate(token, labels)
  if (target < 0 || target >= MEMORY_SIZE) {
    throw new Error(`Target ${formatHex(target, 3)} is outside the 2KB memory space.`)
  }
  if (target % 4 !== 0) {
    throw new Error(`Target ${formatHex(target, 3)} is not 4-byte aligned.`)
  }
  return target
}

function parseNumeric(token: string): number | null {
  const sign = token.startsWith('-') ? -1 : 1
  const unsignedToken = token.startsWith('-') || token.startsWith('+') ? token.slice(1) : token

  if (/^0x[0-9a-f]+$/i.test(unsignedToken)) {
    return sign * parseInt(unsignedToken.slice(2), 16)
  }
  if (/^0b[01]+$/i.test(unsignedToken)) {
    return sign * parseInt(unsignedToken.slice(2), 2)
  }
  if (/^\d+$/.test(unsignedToken)) {
    return sign * Number(unsignedToken)
  }
  return null
}

function parseMemoryOperand(token: string, labels: Record<string, number>): {
  offset: number
  baseReg: number
} {
  const match = token.match(/^(.+)?\(([^()]+)\)$/)
  if (!match) {
    throw new Error(`Invalid memory operand "${token}". Use offset(base), for example 0(sp).`)
  }

  const offsetToken = match[1]?.trim() || '0'
  const baseToken = match[2].trim()
  return {
    offset: mustResolveImmediate(offsetToken, labels),
    baseReg: parseRegister(baseToken),
  }
}

function writeScalar(memory: Uint8Array, addr: number, size: 1 | 2 | 4, value: number) {
  memory[addr] = value & 0xff
  if (size >= 2) {
    memory[addr + 1] = (value >>> 8) & 0xff
  }
  if (size === 4) {
    memory[addr + 2] = (value >>> 16) & 0xff
    memory[addr + 3] = (value >>> 24) & 0xff
  }
}

function readMemory(memory: Uint8Array, addr: number, size: AccessSize, signed: boolean, trace: StepTrace): number {
  ensureMemoryAccess(addr, size)
  ensureAligned(addr, size)
  trace.memReads.push({ addr, size, kind: 'load' })

  if (size === 1) {
    const value = memory[addr]
    return signed && (value & 0x80) ? value | 0xffffff00 : value
  }
  if (size === 2) {
    const value = memory[addr] | (memory[addr + 1] << 8)
    return signed && (value & 0x8000) ? value | 0xffff0000 : value
  }
  return memory[addr] | (memory[addr + 1] << 8) | (memory[addr + 2] << 16) | (memory[addr + 3] << 24)
}

function writeMemory(memory: Uint8Array, addr: number, size: AccessSize, value: number, trace: StepTrace) {
  ensureMemoryAccess(addr, size)
  ensureAligned(addr, size)
  trace.memWrites.push({ addr, size, value, kind: 'store' })

  memory[addr] = value & 0xff
  if (size >= 2) {
    memory[addr + 1] = (value >>> 8) & 0xff
  }
  if (size === 4) {
    memory[addr + 2] = (value >>> 16) & 0xff
    memory[addr + 3] = (value >>> 24) & 0xff
  }
}

function collectUartOutput(trace: StepTrace): string {
  return trace.memWrites
    .filter((write) => write.addr === UART_TX_ADDR && write.size === 1)
    .map((write) => String.fromCharCode(write.value & 0xff))
    .join('')
}

function ensureMemoryAccess(addr: number, size: AccessSize) {
  if (!Number.isInteger(addr) || addr < 0 || addr + size > MEMORY_SIZE) {
    throw new Error(`Memory access ${formatHex(addr, 3)} + ${size} is outside 2KB memory.`)
  }
}

function ensureAligned(addr: number, size: AccessSize) {
  if (size > 1 && addr % size !== 0) {
    throw new Error(`${size}-byte access at ${formatHex(addr, 3)} is not aligned.`)
  }
}

function makeTrace(pcBefore: number, pcAfter: number, instrText: string, sourceLine: number | undefined): StepTrace {
  return {
    pcBefore,
    pcAfter,
    instrText,
    regReads: [],
    regWrites: [],
    memReads: [{ addr: pcBefore, size: 4, kind: 'fetch' }],
    memWrites: [],
    sourceLine,
  }
}

function requireArgCount(instruction: Instruction, expected: number) {
  if (instruction.args.length !== expected) {
    throw new Error(
      `${instruction.op} expects ${expected} operand${expected === 1 ? '' : 's'}, got ${instruction.args.length}.`,
    )
  }
}

function isRType(op: string): boolean {
  return ['add', 'sub', 'and', 'or', 'xor', 'sll', 'srl', 'sra', 'slt', 'sltu'].includes(op)
}

function isIType(op: string): boolean {
  return ['addi', 'andi', 'ori', 'xori', 'slti', 'sltiu'].includes(op)
}

function isShiftIType(op: string): boolean {
  return ['slli', 'srli', 'srai'].includes(op)
}

function isLoad(op: string): boolean {
  return ['lw', 'lh', 'lhu', 'lb', 'lbu'].includes(op)
}

function isStore(op: string): boolean {
  return ['sw', 'sh', 'sb'].includes(op)
}

function isBranch(op: string): boolean {
  return ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'bgt', 'ble', 'bgtu', 'bleu'].includes(op)
}

function isZeroBranch(op: string): boolean {
  return ['beqz', 'bnez', 'bltz', 'bgez', 'bgtz', 'blez'].includes(op)
}

function executeRType(op: string, left: number, right: number): number {
  switch (op) {
    case 'add':
      return left + right
    case 'sub':
      return left - right
    case 'and':
      return left & right
    case 'or':
      return left | right
    case 'xor':
      return left ^ right
    case 'sll':
      return left << (right & 31)
    case 'srl':
      return left >>> (right & 31)
    case 'sra':
      return left >> (right & 31)
    case 'slt':
      return left < right ? 1 : 0
    case 'sltu':
      return (left >>> 0) < (right >>> 0) ? 1 : 0
    default:
      throw new Error(`Unsupported R-type instruction "${op}".`)
  }
}

function executeIType(op: string, left: number, immediate: number): number {
  switch (op) {
    case 'addi':
      return left + immediate
    case 'andi':
      return left & immediate
    case 'ori':
      return left | immediate
    case 'xori':
      return left ^ immediate
    case 'slti':
      return left < immediate ? 1 : 0
    case 'sltiu':
      return (left >>> 0) < (immediate >>> 0) ? 1 : 0
    default:
      throw new Error(`Unsupported I-type instruction "${op}".`)
  }
}

function executeShiftIType(op: string, value: number, shift: number): number {
  switch (op) {
    case 'slli':
      return value << shift
    case 'srli':
      return value >>> shift
    case 'srai':
      return value >> shift
    default:
      throw new Error(`Unsupported shift instruction "${op}".`)
  }
}

function loadSize(op: string): AccessSize {
  return op === 'lw' ? 4 : op === 'lh' || op === 'lhu' ? 2 : 1
}

function storeSize(op: string): AccessSize {
  return op === 'sw' ? 4 : op === 'sh' ? 2 : 1
}

function branchTaken(op: string, left: number, right: number): boolean {
  switch (op) {
    case 'beq':
      return left === right
    case 'bne':
      return left !== right
    case 'blt':
      return left < right
    case 'bge':
      return left >= right
    case 'bltu':
      return (left >>> 0) < (right >>> 0)
    case 'bgeu':
      return (left >>> 0) >= (right >>> 0)
    case 'bgt':
      return left > right
    case 'ble':
      return left <= right
    case 'bgtu':
      return (left >>> 0) > (right >>> 0)
    case 'bleu':
      return (left >>> 0) <= (right >>> 0)
    default:
      throw new Error(`Unsupported branch instruction "${op}".`)
  }
}

function zeroBranchTaken(op: string, value: number): boolean {
  switch (op) {
    case 'beqz':
      return value === 0
    case 'bnez':
      return value !== 0
    case 'bltz':
      return value < 0
    case 'bgez':
      return value >= 0
    case 'bgtz':
      return value > 0
    case 'blez':
      return value <= 0
    default:
      throw new Error(`Unsupported zero branch instruction "${op}".`)
  }
}

export function readWordForDisplay(memory: Uint8Array, addr: number): number {
  if (addr < 0 || addr + 4 > memory.length) {
    return 0
  }
  return memory[addr] | (memory[addr + 1] << 8) | (memory[addr + 2] << 16) | (memory[addr + 3] << 24)
}
