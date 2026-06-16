import type { AssemblyIssue } from '../sim/riscv'

export type CCompileResult = {
  assembly: string | null
  errors: AssemblyIssue[]
}

type IntVariable = {
  name: string
  initialValue: number
}

type IntArray = {
  name: string
  values: number[]
}

type ForLoop = {
  iterator: string
  start: number
  limit: number
  arrayName: string
  accumulator: string
}

type MiniCProgram = {
  arrays: IntArray[]
  variables: IntVariable[]
  loop: ForLoop
  returnVariable: string
}

const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*'

export function compileMiniC(source: string): CCompileResult {
  const errors: AssemblyIssue[] = []
  const body = extractMainBody(source, errors)
  if (body === null) {
    return { assembly: null, errors }
  }

  const program = parseProgram(body, source, errors)
  if (!program) {
    return { assembly: null, errors }
  }

  if (!program.variables.some((variable) => variable.name === program.loop.accumulator)) {
    errors.push({
      lineNumber: findLine(source, program.loop.accumulator),
      message: `Unknown accumulator "${program.loop.accumulator}". Declare it as int before the loop.`,
    })
  }
  if (!program.arrays.some((array) => array.name === program.loop.arrayName)) {
    errors.push({
      lineNumber: findLine(source, program.loop.arrayName),
      message: `Unknown array "${program.loop.arrayName}". Declare it before the loop.`,
    })
  }
  if (program.returnVariable !== program.loop.accumulator) {
    errors.push({
      lineNumber: findLine(source, `return ${program.returnVariable}`),
      message: `This mini-C compiler currently returns the loop accumulator "${program.loop.accumulator}".`,
    })
  }

  if (errors.length > 0) {
    return { assembly: null, errors }
  }

  return {
    assembly: emitAssembly(program),
    errors: [],
  }
}

function extractMainBody(source: string, errors: AssemblyIssue[]): string | null {
  const mainMatch = source.match(/int\s+main\s*\(\s*\)\s*\{/)
  if (!mainMatch || mainMatch.index === undefined) {
    errors.push({ lineNumber: 1, message: 'Expected int main() { ... }.' })
    return null
  }

  const bodyStart = mainMatch.index + mainMatch[0].length
  let depth = 1
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(bodyStart, index)
      }
    }
  }

  errors.push({ lineNumber: source.split(/\r?\n/).length, message: 'Missing closing brace for main().' })
  return null
}

function parseProgram(body: string, source: string, errors: AssemblyIssue[]): MiniCProgram | null {
  const withoutComments = stripComments(body)
  const forMatch = withoutComments.match(
    new RegExp(
      `for\\s*\\(\\s*int\\s+(${IDENTIFIER})\\s*=\\s*(-?\\d+)\\s*;\\s*\\1\\s*<\\s*(-?\\d+)\\s*;\\s*\\1\\+\\+\\s*\\)\\s*\\{\\s*(${IDENTIFIER})\\s*\\+=\\s*(${IDENTIFIER})\\s*\\[\\s*\\1\\s*\\]\\s*;\\s*\\}`,
      'm',
    ),
  )
  if (!forMatch) {
    errors.push({
      lineNumber: findLine(source, 'for'),
      message: 'Expected loop form: for (int i = 0; i < N; i++) { sum += data[i]; }',
    })
    return null
  }

  const [loopText, iterator, startText, limitText, accumulator, arrayName] = forMatch
  const beforeLoop = withoutComments.slice(0, forMatch.index)
  const afterLoop = withoutComments.slice((forMatch.index ?? 0) + loopText.length)

  const arrays = parseArrays(beforeLoop, source, errors)
  const variables = parseVariables(beforeLoop, source, errors)
  const returnMatch = afterLoop.match(new RegExp(`return\\s+(${IDENTIFIER})\\s*;`))
  if (!returnMatch) {
    errors.push({ lineNumber: findLine(source, 'return'), message: 'Expected return variable; after the loop.' })
    return null
  }

  return {
    arrays,
    variables,
    loop: {
      iterator,
      start: Number(startText),
      limit: Number(limitText),
      arrayName,
      accumulator,
    },
    returnVariable: returnMatch[1],
  }
}

function parseArrays(sourceBeforeLoop: string, fullSource: string, errors: AssemblyIssue[]): IntArray[] {
  const arrays: IntArray[] = []
  const pattern = new RegExp(`int\\s+(${IDENTIFIER})\\s*\\[\\s*(\\d+)\\s*\\]\\s*=\\s*\\{([^}]*)\\}\\s*;`, 'g')

  for (const match of sourceBeforeLoop.matchAll(pattern)) {
    const [, name, sizeText, valuesText] = match
    const values = valuesText
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number)
    const size = Number(sizeText)

    if (values.some((value) => !Number.isInteger(value))) {
      errors.push({ lineNumber: findLine(fullSource, name), message: `Array "${name}" contains a non-integer initializer.` })
      continue
    }
    if (values.length !== size) {
      errors.push({
        lineNumber: findLine(fullSource, name),
        message: `Array "${name}" declares ${size} values but initializes ${values.length}.`,
      })
      continue
    }
    arrays.push({ name, values })
  }

  if (arrays.length === 0) {
    errors.push({ lineNumber: 1, message: 'Expected at least one initialized int array, for example int data[4] = {3, 5, 7, 9};' })
  }

  return arrays
}

function parseVariables(sourceBeforeLoop: string, fullSource: string, errors: AssemblyIssue[]): IntVariable[] {
  const variables: IntVariable[] = []
  const arrayRanges = Array.from(
    sourceBeforeLoop.matchAll(new RegExp(`int\\s+${IDENTIFIER}\\s*\\[\\s*\\d+\\s*\\]\\s*=\\s*\\{[^}]*\\}\\s*;`, 'g')),
  ).map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length])
  const pattern = new RegExp(`int\\s+(${IDENTIFIER})\\s*=\\s*(-?\\d+)\\s*;`, 'g')

  for (const match of sourceBeforeLoop.matchAll(pattern)) {
    const matchStart = match.index ?? 0
    if (arrayRanges.some(([start, end]) => matchStart >= start && matchStart < end)) {
      continue
    }

    const [, name, valueText] = match
    const value = Number(valueText)
    if (!Number.isInteger(value)) {
      errors.push({ lineNumber: findLine(fullSource, name), message: `Variable "${name}" must be initialized with an integer.` })
      continue
    }
    variables.push({ name, initialValue: value })
  }

  return variables
}

function emitAssembly(program: MiniCProgram): string {
  const loop = program.loop
  const array = program.arrays.find((candidate) => candidate.name === loop.arrayName)!
  const accumulator = program.variables.find((candidate) => candidate.name === loop.accumulator)!
  const resultLabel = `${loop.accumulator}_result`

  return `.text
main:
  la   t0, ${array.name}
  li   t1, ${loop.limit}
  li   t2, ${loop.start}
  li   a0, ${accumulator.initialValue}

loop:
  lw   t3, 0(t0)
  add  a0, a0, t3
  addi t0, t0, 4
  addi t2, t2, 1
  blt  t2, t1, loop
  sw   a0, ${resultLabel}(zero)
  halt

.data
${array.name}:
  .word ${array.values.join(', ')}
${resultLabel}:
  .word 0
`
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function findLine(source: string, needle: string): number {
  const index = source.indexOf(needle)
  if (index < 0) {
    return 1
  }
  return source.slice(0, index).split(/\r?\n/).length
}
