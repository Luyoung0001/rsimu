import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Cpu,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  TerminalSquare,
  Zap,
} from 'lucide-react'
import './App.css'
import {
  ABI_REGISTER_NAMES,
  DATA_BASE,
  MEMORY_SIZE,
  UART_TX_ADDR,
  type AssemblyIssue,
  type MachineState,
  type Program,
  type StepTrace,
  assemble,
  createMachine,
  formatHex,
  readWordForDisplay,
  stepProgram,
} from './sim/riscv'
import { GODBOLT_RISCV32_CLANG, GODBOLT_RISCV32_VM_FLAGS, compileWithGodbolt } from './compiler/godbolt'

const DEMO_C = `int main() {
  int data[4] = {3, 5, 7, 9};
  int sum = 0;

  for (int i = 0; i < 4; i++) {
    sum += data[i];
  }

  return sum;
}`

const C_EXAMPLES = [
  {
    id: 'array-sum',
    title: 'Array Sum',
    source: DEMO_C,
  },
  {
    id: 'printf',
    title: 'printf + UART',
    source: `#include <stdio.h>

int main() {
  int value = -42;
  printf("value=%d hex=%x text=%s char=%c\\n", value, 0x2a, "ok", 'A');
  return 0;
}`,
  },
  {
    id: 'bubble-sort',
    title: 'Bubble Sort',
    source: `int main() {
  int a[5] = {7, 2, 9, 1, 5};

  for (int i = 0; i < 5; i++) {
    for (int j = 0; j < 4 - i; j++) {
      if (a[j] > a[j + 1]) {
        int tmp = a[j];
        a[j] = a[j + 1];
        a[j + 1] = tmp;
      }
    }
  }

  return a[0] + a[4];
}`,
  },
  {
    id: 'recursive-fib',
    title: 'Recursive Fibonacci',
    source: `int fib(int n) {
  if (n <= 1) {
    return n;
  }
  return fib(n - 1) + fib(n - 2);
}

int main() {
  return fib(6);
}`,
  },
  {
    id: 'function-call',
    title: 'Function Call',
    source: `int max3(int a, int b, int c) {
  int best = a;
  if (b > best) {
    best = b;
  }
  if (c > best) {
    best = c;
  }
  return best;
}

int main() {
  return max3(12, 7, 19);
}`,
  },
] as const

const DEMO_ASM = `.text
main:
  la   t0, data      # t0 = &data[0]
  li   t1, 4         # loop count
  li   t2, 0         # i
  li   a0, 0         # sum

loop:
  lw   t3, 0(t0)     # load data[i]
  add  a0, a0, t3    # sum += data[i]
  addi t0, t0, 4     # next element
  addi t2, t2, 1     # i++
  blt  t2, t1, loop  # keep looping while i < 4
  sw   a0, result(zero)
  halt

.data
data:
  .word 3, 5, 7, 9
result:
  .word 0
`

type AppModel = {
  program: Program | null
  machine: MachineState | null
  trace: StepTrace | null
  errors: AssemblyIssue[]
}

type LayoutSizes = {
  leftPane: number
  centerPane: number
  leftTop: number
  centerTop: number
}

type MemoryCell = {
  addr: number
  section: 'text' | 'data'
  value: number
  label?: string
  instruction?: string
}

const EMPTY_MODEL: AppModel = {
  program: null,
  machine: null,
  trace: null,
  errors: [],
}

const DEFAULT_LAYOUT: LayoutSizes = {
  leftPane: 260,
  centerPane: 760,
  leftTop: 170,
  centerTop: 250,
}

const RUN_STEP_LIMIT = 2000

function App() {
  const [cSource, setCSource] = useState(DEMO_C)
  const [asmSource, setAsmSource] = useState(DEMO_ASM)
  const [model, setModel] = useState<AppModel>(() => compileSource(DEMO_ASM))
  const [isCompiling, setIsCompiling] = useState(false)
  const [layout, setLayout] = useState<LayoutSizes>(DEFAULT_LAYOUT)
  const workspaceRef = useRef<HTMLElement>(null)
  const leftColumnRef = useRef<HTMLDivElement>(null)
  const rightColumnRef = useRef<HTMLDivElement>(null)

  const trace = model.trace
  const registerMarks = useMemo(() => buildRegisterMarks(trace), [trace])
  const memoryMarks = useMemo(() => buildMemoryMarks(trace), [trace])
  const memoryCells = useMemo(
    () => buildMemoryCells(model.machine?.memory, model.program, trace),
    [model.machine?.memory, model.program, trace],
  )
  const activeAsmLine = trace?.sourceLine
  const currentInstructionText =
    trace?.instrText ?? model.program?.instructions.find((instruction) => instruction.address === model.machine?.pc)?.source ?? '-'

  async function compile() {
    setIsCompiling(true)
    const cResult = await compileWithGodbolt(cSource)
    setIsCompiling(false)

    if (!cResult.assembly) {
      setModel({
        ...EMPTY_MODEL,
        errors: cResult.errors,
      })
      return
    }

    setAsmSource(cResult.assembly)
    const assembled = compileSource(cResult.assembly)
    setModel({
      ...assembled,
      errors:
        assembled.errors.length > 0
          ? [
              ...cResult.errors,
              {
                lineNumber: 0,
                message:
                  'Clang assembly was generated, but the teaching simulator only executes its RV32I subset. You can still inspect the generated assembly.',
              },
              ...assembled.errors,
            ]
          : cResult.errors,
    })
  }

  function reset() {
    if (!model.program) {
      setModel(compileSource(asmSource))
      return
    }
    setModel({
      program: model.program,
      machine: createMachine(model.program),
      trace: null,
      errors: [],
    })
  }

  function step() {
    if (!model.program || !model.machine) {
      void compile()
      return
    }

    const result = stepProgram(model.program, model.machine)
    setModel({
      program: model.program,
      machine: result.state,
      trace: result.trace,
      errors: [],
    })
  }

  function runUntilHalt() {
    if (!model.program || !model.machine) {
      void compile()
      return
    }

    let machine = model.machine
    let lastTrace = model.trace
    let guard = 0

    while (!machine.halted && guard < RUN_STEP_LIMIT) {
      const result = stepProgram(model.program, machine)
      machine = result.state
      lastTrace = result.trace
      guard += 1
    }

    setModel({
      program: model.program,
      machine,
      trace: lastTrace,
      errors:
        guard >= RUN_STEP_LIMIT
          ? [{ lineNumber: 0, message: `Run stopped after ${RUN_STEP_LIMIT} steps. Use Step to inspect the loop.` }]
          : [],
    })
  }

  const canStep = Boolean(model.program && model.machine && !model.machine.halted)
  const workspaceStyle = {
    '--left-pane': `${layout.leftPane}px`,
    '--center-pane': `${layout.centerPane}px`,
  } as React.CSSProperties
  const leftColumnStyle = { '--left-top': `${layout.leftTop}px` } as React.CSSProperties
  const centerColumnStyle = { '--center-top': `${layout.centerTop}px` } as React.CSSProperties

  function beginColumnResize(split: 'left-center' | 'center-right', event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const workspace = workspaceRef.current
    if (!workspace) {
      return
    }

    const startX = event.clientX
    const start = layout
    const workspaceWidth = workspace.getBoundingClientRect().width

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX

      setLayout((current) => {
        if (split === 'left-center') {
          const total = start.leftPane + start.centerPane
          const nextLeft = clamp(start.leftPane + delta, 210, total - 700)
          return {
            ...current,
            leftPane: nextLeft,
            centerPane: total - nextLeft,
          }
        }

        return {
          ...current,
          centerPane: clamp(start.centerPane + delta, 700, workspaceWidth - start.leftPane - 260),
        }
      })
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  function beginRowResize(target: 'left' | 'center', event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const column = target === 'left' ? leftColumnRef.current : rightColumnRef.current
    if (!column) {
      return
    }

    const startY = event.clientY
    const startTop = target === 'left' ? layout.leftTop : layout.centerTop
    const columnHeight = column.getBoundingClientRect().height
    const minTop = target === 'left' ? 120 : 170
    const minBottom = target === 'left' ? 220 : 300

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY
      const nextTop = clamp(startTop + delta, minTop, columnHeight - minBottom)

      setLayout((current) => ({
        ...current,
        [target === 'left' ? 'leftTop' : 'centerTop']: nextTop,
      }))
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Cpu size={24} strokeWidth={2.2} />
          <div>
            <h1>RSimu</h1>
          </div>
        </div>

        <div className="runtime-status" aria-label="Machine status">
          <StatusItem
            label="PC"
            value={formatHex(model.machine?.pc ?? 0, 3)}
            tone={trace?.memReads.some((read) => read.kind === 'fetch') ? 'fetch' : undefined}
          />
          <StatusItem label="Steps" value={String(model.machine?.stepCount ?? 0)} />
          <StatusItem
            label="State"
            value={model.machine?.halted ? 'halted' : model.program ? 'ready' : 'not compiled'}
            tone={model.machine?.halted ? 'write' : undefined}
          />
          <StatusItem label="Instruction" value={currentInstructionText} wide />
        </div>

        <div className="toolbar" aria-label="Simulator controls">
          <label className="example-picker">
            <span>Example</span>
            <select
              value=""
              onChange={(event) => {
                const example = C_EXAMPLES.find((item) => item.id === event.target.value)
                if (example) {
                  setCSource(example.source)
                  setModel({ ...EMPTY_MODEL })
                }
              }}
              title="Load a C example"
            >
              <option value="" disabled>
                Load example
              </option>
              {C_EXAMPLES.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="tool-button primary"
            onClick={() => void compile()}
            disabled={isCompiling}
            title="Compile C with Godbolt rv32 clang"
          >
            <TerminalSquare size={18} />
            {isCompiling ? 'Compiling' : 'Compile'}
          </button>
          <button type="button" className="tool-button" onClick={step} disabled={!canStep} title="Execute one instruction">
            <SkipForward size={18} />
            Step
          </button>
          <button
            type="button"
            className="tool-button"
            onClick={runUntilHalt}
            disabled={!canStep}
            title="Run until halt or 256 steps"
          >
            <Play size={18} />
            Run
          </button>
          <button type="button" className="icon-button" onClick={reset} title="Reset machine state">
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <section ref={workspaceRef} className="workspace" style={workspaceStyle}>
        <div ref={leftColumnRef} className="left-column" style={leftColumnStyle}>
          <Panel title="main.c" icon={<BookOpen size={16} />} className="c-panel">
            <CodeEditor value={cSource} onChange={setCSource} ariaLabel="C source" />
          </Panel>

          <ResizeHandle axis="row" label="Resize source panes" onPointerDown={(event) => beginRowResize('left', event)} />

          <Panel title={`${GODBOLT_RISCV32_CLANG} output`} icon={<TerminalSquare size={16} />} className="asm-panel">
            <div className="compiler-flags">{GODBOLT_RISCV32_VM_FLAGS}</div>
            <AssemblyListing source={asmSource} activeLine={activeAsmLine} />
          </Panel>
        </div>

        <ResizeHandle
          axis="column"
          label="Resize source and state panes"
          onPointerDown={(event) => beginColumnResize('left-center', event)}
          variant="left-center"
        />

        <div ref={rightColumnRef} className="center-column" style={centerColumnStyle}>
          <Panel title="Registers" icon={<Cpu size={16} />} className="registers-panel">
            <div className="register-grid">
              {Array.from({ length: 32 }, (_, index) => {
                const mark = registerMarks.get(index)
                const value = model.machine?.registers[index] ?? 0
                return (
                  <div key={index} className={`register-cell ${mark ? `mark-${mark}` : ''}`}>
                    <div>
                      <strong>x{index}</strong>
                      <span>{ABI_REGISTER_NAMES[index]}</span>
                    </div>
                    <code>{formatHex(value)}</code>
                  </div>
                )
              })}
            </div>
          </Panel>

          <ResizeHandle axis="row" label="Resize registers and memory" onPointerDown={(event) => beginRowResize('center', event)} />

          <Panel title="Memory 2KB" icon={<TerminalSquare size={16} />} className="memory-panel">
            <div className="memory-legend">
              <span><i className="swatch fetch" />fetch</span>
              <span><i className="swatch load" />load</span>
              <span><i className="swatch store" />store</span>
              <span><i className="swatch text" />text</span>
            </div>
            <div className="memory-grid" aria-label="2KB memory words">
              {memoryCells.map((cell) => {
                const mark = memoryMarks.get(cell.addr)
                return (
                  <div key={cell.addr} className={`memory-cell ${cell.section} ${mark ? `mark-${mark}` : ''}`}>
                    <div className="memory-meta">
                      <span>{formatHex(cell.addr, 3)}</span>
                      {cell.label ? <b>{cell.label}</b> : null}
                    </div>
                    {cell.instruction ? (
                      <code className="instruction-memory">{cell.instruction}</code>
                    ) : (
                      <code>{formatHex(cell.value)}</code>
                    )}
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>

        <ResizeHandle
          axis="column"
          label="Resize state and trace panes"
          onPointerDown={(event) => beginColumnResize('center-right', event)}
          variant="center-right"
        />

        <div className="right-column">
          <Panel title="Trace" icon={model.machine?.halted ? <Pause size={16} /> : <Zap size={16} />} className="trace-panel">
            <TraceView trace={trace} />
          </Panel>

          <Panel title="UART" icon={<TerminalSquare size={16} />} className="uart-panel">
            <pre className="uart-output">{model.machine?.output || ''}</pre>
          </Panel>

          {model.errors.length > 0 ? (
            <Panel title="Diagnostics" icon={<TerminalSquare size={16} />} className="diagnostics-panel">
              <div className="diagnostics">
                {model.errors.map((error, index) => (
                  <p key={`${error.lineNumber}-${index}`}>
                    {error.lineNumber > 0 ? `Line ${error.lineNumber}: ` : ''}
                    {error.message}
                  </p>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function clamp(value: number, min: number, max: number): number {
  const effectiveMax = Math.max(min, max)
  return Math.min(Math.max(value, min), effectiveMax)
}

function compileSource(source: string): AppModel {
  const result = assemble(source)
  if (!result.program) {
    return {
      ...EMPTY_MODEL,
      errors: result.errors,
    }
  }

  return {
    program: result.program,
    machine: createMachine(result.program),
    trace: null,
    errors: [],
  }
}

function Panel({
  title,
  icon,
  children,
  className,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className ?? ''}`}>
      <div className="panel-header">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function CodeEditor({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}) {
  const lineCount = Math.max(1, value.split(/\r?\n/).length)

  return (
    <div className="code-editor">
      <div className="code-gutter" aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <textarea
        className="code-input"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
      />
    </div>
  )
}

function AssemblyListing({ source, activeLine }: { source: string; activeLine?: number }) {
  const lines = source.length > 0 ? source.split(/\r?\n/) : ['']
  const activeLineRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeLine])

  return (
    <div className="asm-listing" aria-label="Generated RISC-V assembly">
      {lines.map((line, index) => {
        const lineNumber = index + 1
        const isActive = activeLine === lineNumber
        return (
          <div
            key={`${index}-${line}`}
            ref={isActive ? activeLineRef : null}
            className={`asm-line ${classifyAsmLine(line)} ${isActive ? 'active' : ''}`}
          >
            <span className="asm-line-number">{lineNumber}</span>
            <code>{line || ' '}</code>
          </div>
        )
      })}
    </div>
  )
}

function classifyAsmLine(line: string): string {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return 'blank'
  }
  if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
    return 'comment'
  }
  if (/^[A-Za-z_.$][\w.$]*:$/.test(trimmed)) {
    return 'label'
  }
  if (trimmed.startsWith('.')) {
    return 'directive'
  }
  return 'instruction'
}

function ResizeHandle({
  axis,
  label,
  onPointerDown,
  variant,
}: {
  axis: 'column' | 'row'
  label: string
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  variant?: 'left-center' | 'center-right'
}) {
  return (
    <div
      className={`resize-handle ${axis} ${variant ?? ''}`}
      role="separator"
      aria-label={label}
      onPointerDown={onPointerDown}
    />
  )
}

function StatusItem({
  label,
  value,
  tone,
  wide = false,
}: {
  label: string
  value: string
  tone?: 'fetch' | 'read' | 'write'
  wide?: boolean
}) {
  return (
    <div className={`status-item ${tone ? `tone-${tone}` : ''} ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function TraceView({ trace }: { trace: StepTrace | null }) {
  if (!trace) {
    return <EmptyState text="Step once to show register and memory activity." />
  }

  return (
    <div className="trace-grid">
      <TraceLine label="Fetch" value={`${formatHex(trace.pcBefore, 3)} -> ${trace.instrText}`} tone="fetch" />
      <TraceLine label="Reg read" value={trace.regReads.length > 0 ? trace.regReads.map((reg) => `x${reg}`).join(', ') : '-'} tone="read" />
      <TraceLine
        label="Reg write"
        value={trace.regWrites.length > 0 ? trace.regWrites.map((write) => `x${write.reg} = ${formatHex(write.value)}`).join(', ') : '-'}
        tone="write"
      />
      <TraceLine
        label="Memory"
        value={[
          ...trace.memReads.filter((read) => read.kind === 'load').map((read) => `load ${formatHex(read.addr, 3)}:${read.size}`),
          ...trace.memWrites.map((write) => `store ${formatHex(write.addr, 3)}:${write.size}`),
        ].join(', ') || '-'}
        tone={trace.memWrites.length > 0 ? 'store' : 'load'}
      />
      {trace.trap ? <TraceLine label="Trap" value={trace.trap} tone="store" /> : null}
    </div>
  )
}

function TraceLine({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'fetch' | 'read' | 'write' | 'load' | 'store'
}) {
  return (
    <div className={`trace-line trace-${tone}`}>
      <span>{label}</span>
      <code>{value}</code>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}

function buildRegisterMarks(trace: StepTrace | null): Map<number, 'read' | 'write'> {
  const marks = new Map<number, 'read' | 'write'>()
  trace?.regReads.forEach((reg) => marks.set(reg, 'read'))
  trace?.regWrites.forEach((write) => marks.set(write.reg, 'write'))
  return marks
}

function buildMemoryMarks(trace: StepTrace | null): Map<number, 'fetch' | 'load' | 'store'> {
  const marks = new Map<number, 'fetch' | 'load' | 'store'>()
  trace?.memReads.forEach((read) => {
    const mark = read.kind === 'fetch' ? 'fetch' : 'load'
    for (let addr = read.addr; addr < read.addr + read.size; addr += 4) {
      marks.set(Math.floor(addr / 4) * 4, mark)
    }
  })
  trace?.memWrites.forEach((write) => {
    for (let addr = write.addr; addr < write.addr + write.size; addr += 4) {
      marks.set(Math.floor(addr / 4) * 4, 'store')
    }
  })
  return marks
}

function buildMemoryCells(
  memory: Uint8Array | undefined,
  program: Program | null,
  trace: StepTrace | null,
): MemoryCell[] {
  const bytes = memory ?? new Uint8Array(MEMORY_SIZE)
  const labels = program?.labels
  const instructionByAddress = new Map<number, string>()
  program?.instructions.forEach((instruction) => {
    instructionByAddress.set(instruction.address, instruction.source)
  })

  const labelByAddress = new Map<number, string>()
  Object.entries(labels ?? {}).forEach(([label, addr]) => {
    if (addr >= 0 && addr < MEMORY_SIZE && addr % 4 === 0) {
      labelByAddress.set(addr, label)
    }
  })

  const included = new Set<number>()
  const includeRange = (start: number, end: number, min = 0) => {
    const first = Math.max(min, Math.floor(start / 4) * 4)
    const last = Math.min(MEMORY_SIZE, Math.ceil(end / 4) * 4)
    for (let addr = first; addr < last; addr += 4) {
      included.add(addr)
    }
  }

  instructionByAddress.forEach((_, addr) => included.add(addr))
  trace?.memReads.forEach((read) => {
    if (read.kind === 'fetch') {
      included.add(Math.floor(read.addr / 4) * 4)
    }
  })

  const interestingAddrs = new Set<number>()
  for (let addr = DATA_BASE; addr < MEMORY_SIZE; addr += 4) {
    if (readWordForDisplay(bytes, addr) !== 0) {
      interestingAddrs.add(addr)
    }
  }
  labelByAddress.forEach((_, addr) => interestingAddrs.add(addr))
  trace?.memReads.forEach((read) => {
    if (read.addr >= DATA_BASE) {
      interestingAddrs.add(Math.floor(read.addr / 4) * 4)
    }
  })
  trace?.memWrites.forEach((write) => {
    if (write.addr >= DATA_BASE) {
      interestingAddrs.add(Math.floor(write.addr / 4) * 4)
    }
  })

  const highestDataAddr = Math.max(DATA_BASE + 7 * 4, ...interestingAddrs)
  includeRange(DATA_BASE, highestDataAddr + 8 * 4, DATA_BASE)

  interestingAddrs.forEach((addr) => includeRange(addr - 8, addr + 12, DATA_BASE))
  includeRange(MEMORY_SIZE - 64, MEMORY_SIZE, DATA_BASE)
  includeRange(UART_TX_ADDR - 12, UART_TX_ADDR + 16, DATA_BASE)

  return Array.from(included)
    .sort((left, right) => left - right)
    .map((addr) => ({
      addr,
      section: instructionByAddress.has(addr) ? 'text' : 'data',
      value: readWordForDisplay(bytes, addr),
      label: labelByAddress.get(addr),
      instruction: instructionByAddress.get(addr),
    }))
}

export default App
