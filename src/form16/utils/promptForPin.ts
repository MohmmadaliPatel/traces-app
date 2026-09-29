/**
 * Ask for a token PIN on the terminal without echoing it.
 *
 * Deliberately not a --pin=… flag: anything on the command line is visible in the process list
 * and lands in shell history, and a token PIN should be neither.
 */
import readline from "readline"

export async function promptForPin(prompt = "Token PIN (leave blank to use the driver dialog): "): Promise<string> {
  if (!process.stdin.isTTY) return ""

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })

  // readline echoes as it goes; swallow the characters instead of printing them.
  const output = rl as unknown as { output?: NodeJS.WriteStream; _writeToOutput?: (s: string) => void }
  const originalWrite = output._writeToOutput?.bind(rl)
  output._writeToOutput = (chunk: string) => {
    if (chunk.includes(prompt)) originalWrite?.(chunk)
  }

  try {
    return await new Promise<string>((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim()))
    })
  } finally {
    rl.close()
    process.stdout.write("\n")
  }
}
