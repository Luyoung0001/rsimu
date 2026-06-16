# RSimu

Pure frontend RV32I teaching simulator.

## Current MVP

- C-first workflow: edit C and compile it with Compiler Explorer/Godbolt `rv32-cclang`.
- The generated RISC-V assembly remains visible for stepping and inspection.
- Single-step execution with an explicit trace for register reads, register writes, instruction fetch, memory loads, and memory stores.
- 32 integer registers and 2KB byte-addressable memory.
- Fixed teaching layout:
  - `0x000..0x2ff`: instruction area
  - `0x300..0x7ff`: data and stack area

The main compile button uses the Godbolt API with flags constrained for the JS VM:

```bash
-O0 -S -march=rv32i -mabi=ilp32 -ffreestanding -fno-builtin -nostdlib -nostdinc -I.
```

RSimu injects a tiny `stdio.h`/`printf` runtime. `printf` writes characters to the UART MMIO byte at `0x7f0`, so stepping through output shows ordinary `sb` stores in memory and appends text to the UART panel.

The original local mini-C teaching subset is still useful for predictable simulator examples:

```c
int main() {
  int data[4] = {3, 5, 7, 9};
  int sum = 0;

  for (int i = 0; i < 4; i++) {
    sum += data[i];
  }

  return sum;
}
```

This keeps generated assembly stable enough for instruction-by-instruction learning.

## Commands

```bash
npm install
npm run dev
npm run test
npm run build
```

## Supported Assembly Subset

The simulator supports a practical teaching subset:

- Arithmetic/logical: `add`, `sub`, `and`, `or`, `xor`, `sll`, `srl`, `sra`, `slt`, `sltu`
- Immediate: `addi`, `andi`, `ori`, `xori`, `slti`, `sltiu`, `slli`, `srli`, `srai`
- Memory: `lw`, `lh`, `lhu`, `lb`, `lbu`, `sw`, `sh`, `sb`
- Branch/jump: `beq`, `bne`, `blt`, `bge`, `bltu`, `bgeu`, `jal`, `jalr`, `j`, `ret`
- Teaching pseudos: `li`, `la`, `mv`, `nop`, `halt`
- Sections: `.text`, `.data`, `.word`
