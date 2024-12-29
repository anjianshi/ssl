import { runTask } from './task.js'

let inputWorkDirectory: string | undefined
const workDirectoryNamedArg = process.argv.find(arg => arg.startsWith('--work-directory='))
if (workDirectoryNamedArg) {
  inputWorkDirectory = workDirectoryNamedArg.split('=')[1]
} else {
  const workDirectoryArgIndex = process.argv.indexOf('-d') + 1
  if (workDirectoryArgIndex && process.argv[workDirectoryArgIndex]) {
    inputWorkDirectory = process.argv[workDirectoryArgIndex]
  }
}

const confirmOnly = process.argv.includes('confirm')

await runTask(inputWorkDirectory, confirmOnly)
