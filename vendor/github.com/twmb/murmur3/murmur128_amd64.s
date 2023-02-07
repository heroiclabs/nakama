// +build go1.5,amd64

// SeedSum128(seed1, seed2 uint64, data []byte) (h1 uint64, h2 uint64)
TEXT ·SeedSum128(SB), $0-56
	MOVQ seed1+0(FP), R12
	MOVQ seed2+8(FP), R13
	MOVQ data_base+16(FP), SI
	MOVQ data_len+24(FP), R9
	LEAQ h1+40(FP), BX
	JMP  sum128internal<>(SB)

// Sum128(data []byte) (h1 uint64, h2 uint64)
TEXT ·Sum128(SB), $0-40
	XORQ R12, R12
	XORQ R13, R13
	MOVQ data_base+0(FP), SI
	MOVQ data_len+8(FP), R9
	LEAQ h1+24(FP), BX
	JMP  sum128internal<>(SB)

// SeedStringSum128(seed1, seed2 uint64, data string) (h1 uint64, h2 uint64)
TEXT ·SeedStringSum128(SB), $0-48
	MOVQ seed1+0(FP), R12
	MOVQ seed2+8(FP), R13
	MOVQ data_base+16(FP), SI
	MOVQ data_len+24(FP), R9
	LEAQ h1+32(FP), BX
	JMP  sum128internal<>(SB)

// StringSum128(data string) (h1 uint64, h2 uint64)
TEXT ·StringSum128(SB), $0-32
	XORQ R12, R12
	XORQ R13, R13
	MOVQ data_base+0(FP), SI
	MOVQ data_len+8(FP), R9
	LEAQ h1+16(FP), BX
	JMP  sum128internal<>(SB)

// Expects:
// R12 == h1 uint64 seed
// R13 == h2 uint64 seed
// SI  == &data
// R9  == len(data)
// BX  == &[2]uint64 return
TEXT sum128internal<>(SB), $0
	MOVQ $0x87c37b91114253d5, R14 // c1
	MOVQ $0x4cf5ad432745937f, R15 // c2

	MOVQ R9, CX
	ANDQ $-16, CX // cx == data_len - (data_len % 16)

	// for r10 = 0; r10 < cx; r10 += 16 {...
	XORQ R10, R10

loop:
	CMPQ R10, CX
	JE   tail
	MOVQ (SI)(R10*1), AX
	MOVQ 8(SI)(R10*1), DX
	ADDQ $16, R10

	IMULQ R14, AX
	IMULQ R15, DX

	ROLQ  $31, AX
	ROLQ  $33, DX

	IMULQ R15, AX
	IMULQ R14, DX

	XORQ AX,  R12
	ROLQ $27, R12
	ADDQ R13, R12
	XORQ DX,  R13
	ROLQ $31, R13
	LEAQ 0x52dce729(R12)(R12*4), R12

	ADDQ R12, R13
	LEAQ 0x38495ab5(R13)(R13*4), R13

	JMP loop

tail:
	MOVQ R9, CX
	ANDQ $0xf, CX
	JZ   finalize // if len % 16 == 0

	XORQ AX, AX

	// poor man's binary tree jump table
	SUBQ $8, CX
	JZ   tail8
	JG   over8
	ADDQ $4, CX
	JZ   tail4
	JG   over4
	ADDQ $2, CX
	JL   tail1
	JZ   tail2
	JMP  tail3

over4:
	SUBQ $2, CX
	JL   tail5
	JZ   tail6
	JMP  tail7

over8:
	SUBQ $4, CX
	JZ   tail12
	JG   over12
	ADDQ $2, CX
	JL   tail9
	JZ   tail10
	JMP  tail11

over12:
	SUBQ $2, CX
	JL   tail13
	JZ   tail14

tail15:
	MOVBQZX 14(SI)(R10*1), AX
	SALQ    $16, AX

tail14:
	MOVW 12(SI)(R10*1), AX
	SALQ $32, AX
	JMP  tail12

tail13:
	MOVBQZX 12(SI)(R10*1), AX
	SALQ    $32, AX

tail12:
	MOVL 8(SI)(R10*1), DX
	ORQ  DX, AX
	JMP  fintailhigh

tail11:
	MOVBQZX 10(SI)(R10*1), AX
	SALQ    $16, AX

tail10:
	MOVW 8(SI)(R10*1), AX
	JMP  fintailhigh

tail9:
	MOVB 8(SI)(R10*1), AL

fintailhigh:
	IMULQ R15, AX
	ROLQ  $33, AX
	IMULQ R14, AX
	XORQ  AX, R13

tail8:
	MOVQ (SI)(R10*1), AX
	JMP  fintaillow

tail7:
	MOVBQZX 6(SI)(R10*1), AX
	SALQ    $16, AX

tail6:
	MOVW 4(SI)(R10*1), AX
	SALQ $32, AX
	JMP  tail4

tail5:
	MOVBQZX 4(SI)(R10*1), AX
	SALQ    $32, AX

tail4:
	MOVL (SI)(R10*1), DX
	ORQ  DX, AX
	JMP  fintaillow

tail3:
	MOVBQZX 2(SI)(R10*1), AX
	SALQ    $16, AX

tail2:
	MOVW (SI)(R10*1), AX
	JMP  fintaillow

tail1:
	MOVB (SI)(R10*1), AL

fintaillow:
	IMULQ R14, AX
	ROLQ  $31, AX
	IMULQ R15, AX
	XORQ  AX, R12

finalize:
	XORQ R9, R12
	XORQ R9, R13

	ADDQ R13, R12
	ADDQ R12, R13

	// fmix128 (both interleaved)
	MOVQ  R12, DX
	MOVQ  R13, AX

	SHRQ  $33, DX
	SHRQ  $33, AX

	XORQ  DX, R12
	XORQ  AX, R13

	MOVQ  $0xff51afd7ed558ccd, CX

	IMULQ CX, R12
	IMULQ CX, R13

	MOVQ  R12, DX
	MOVQ  R13, AX

	SHRQ  $33, DX
	SHRQ  $33, AX

	XORQ  DX, R12
	XORQ  AX, R13

	MOVQ  $0xc4ceb9fe1a85ec53, CX

	IMULQ CX, R12
	IMULQ CX, R13

	MOVQ  R12, DX
	MOVQ  R13, AX

	SHRQ  $33, DX
	SHRQ  $33, AX

	XORQ  DX, R12
	XORQ  AX, R13

	ADDQ R13, R12
	ADDQ R12, R13

	MOVQ R12, (BX)
	MOVQ R13, 8(BX)
	RET
