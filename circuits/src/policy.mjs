export const CANONICAL_NETLIST =
  '0x0000000400000400000002000008000000090000090000000a0000060000000b00000b00000003000005000000070000070000000e00000d0000000f00000f0000000c00000f0000000c0000100000001100001100000012000012'

export const EXPECTED_HASH =
  '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269'

const GATES = [
  [4, 4],
  [2, 8],
  [9, 9],
  [10, 6],
  [11, 11],
  [3, 5],
  [7, 7],
  [14, 13],
  [15, 15],
  [12, 15],
  [12, 16],
  [17, 17],
  [18, 18],
]

const nand = (a, b) => 1 - (a & b)

const u24 = (value) => [
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
]

export function compilePolicy() {
  const bytes = GATES.flatMap(([a, b]) => [0, ...u24(a), ...u24(b)])
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function evaluateGraph(inputByte) {
  const signals = Array(21).fill(0)
  signals[1] = 1

  for (let bit = 0; bit < 6; bit += 1) {
    signals[bit + 2] = (inputByte >> bit) & 1
  }

  GATES.forEach(([a, b], index) => {
    signals[index + 8] = nand(signals[a], signals[b])
  })

  return signals[19] | (signals[20] << 1)
}

export function evaluateReference(inputByte) {
  const active = (inputByte >> 0) & 1
  const trusted = (inputByte >> 1) & 1
  const blocked = (inputByte >> 2) & 1
  const low = (inputByte >> 3) & 1
  const within = (inputByte >> 4) & 1
  const approved = (inputByte >> 5) & 1
  const hardOk = active && !blocked && within
  const allow = Number(hardOk && (approved || (trusted && low)))
  const review = Number(hardOk && !allow)

  return allow | (review << 1)
}
